import { createClient } from "@/lib/supabase/server";
import {
  LIST_QUERY_LIMIT,
  PROJECT_PICKER_LIMIT,
  STAGE_LABELS,
} from "@/lib/constants";
import {
  fetchCountedPage,
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import { normalizeCoordinatorIds } from "@/lib/domain/coordinators";
import { FEASIBILITY_WARNING_DAYS } from "@/lib/domain/kseb";
import { incentivePaid } from "@/lib/domain/incentives";
import { amount, isFinancingType } from "@/lib/domain/payment";
import {
  incentiveWriteMessage,
  type IncentiveSetting,
} from "@/lib/domain/project-settings";
import {
  isFeasibilityFilter,
  isIncentiveFilter,
  isPlanFilter,
  isProjectSortColumn,
  isProjectStatusFilter,
  type ProjectSortColumn,
} from "@/lib/domain/project-list";
import { oneToOne } from "./embeds";
import type {
  CoordinatorIncentive,
  IncentivePayment,
  MilestoneStatus,
  PlanType,
  Project,
  ProjectCancellation,
  ProjectListRow,
  ProjectMilestone,
  ProjectStage,
  SaleCoordinator,
  WorkOrder,
} from "@/lib/types";

function isProjectStage(value: string | undefined): value is ProjectStage {
  return value !== undefined && Object.hasOwn(STAGE_LABELS, value);
}

// Explicit columns (no SELECT *). The legacy single-incentive columns and the
// deprecated projects.coordinator_id copy are deliberately NOT read: a sale's
// coordinators are its work order's, and each person's incentive is their own
// coordinator_incentives row.
const PROJECT_COLUMNS = `id, work_order_id, current_stage, is_completed,
  started_at, completed_at, created_at, updated_at, feasibility_date,
  cancellation, cancelled_on, cancelled_by, cancellation_remarks`;

const WORK_ORDER_COLUMNS = `id, coordinator_id, client_name, client_phone, address,
  plant_capacity, plan_type, plant_capacity_kw, advance_amount, total_cost, order_date, status,
  consumer_number, notes, kseb_section, financing_type, loan_bank_name,
  created_at, updated_at`;

/**
 * Everyone on the sale with the incentive the caller may read: the office gets
 * every row, a coordinator only their own (RLS) — the others' come back null,
 * and so do their instalments (a partner's are never read, whoever recorded
 * them). Every embed names its foreign key: `coordinator_incentives` has none of
 * its own towards `work_orders`/`profiles` precisely so these stay unambiguous,
 * and the instalments hang off it by the composite key.
 *
 * The recorder's name is only worth a join where it is shown (the project
 * page); a partner cannot read the office's profiles, so there it is null.
 */
function coordinatorsEmbed(withRecorder: boolean): string {
  const recorder = withRecorder
    ? ",\n        recorder:profiles!coordinator_incentive_payments_recorded_by_fkey(full_name)"
    : "";
  return `coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(
    coordinator_id, sort_order, created_at,
    profile:profiles!work_order_coordinators_coordinator_id_fkey(id, full_name),
    incentive:coordinator_incentives(amount, paid_on,
      payments:coordinator_incentive_payments!coordinator_incentive_payments_incentive_fkey(
        id, amount, paid_on, note, recorded_by, created_at${recorder})))`;
}

const SELECT_DETAIL = `${PROJECT_COLUMNS},
  work_order:work_orders!projects_work_order_id_fkey(${WORK_ORDER_COLUMNS},
    ${coordinatorsEmbed(true)}),
  cancelled_by_profile:profiles!projects_cancelled_by_fkey(full_name),
  milestones:project_milestones(id, project_id, stage, sort_order, status, notes, completed_at)`;

const SELECT_BRIEF = `id, work_order_id, is_completed, completed_at, feasibility_date,
  cancellation, cancelled_on, cancellation_remarks,
  work_order:work_orders!projects_work_order_id_fkey(client_name, plan_type, order_date,
    ${coordinatorsEmbed(false)})`;

/** The work order as the project page shows it (its coordinators are on the project). */
export type ProjectWorkOrder = Omit<WorkOrder, "coordinators" | "coordinator" | "project">;

/** One instalment, and who recorded it where the viewer may read profiles. */
export interface IncentiveInstalment extends IncentivePayment {
  /** Null (or absent) when the recorder is gone, or the viewer cannot read profiles. */
  recorded_by_name?: string | null;
}

/** A coordinator's incentive with its instalments' recorders named. */
export type DetailIncentive = Omit<CoordinatorIncentive, "payments"> & {
  payments: IncentiveInstalment[];
};

/** A `SaleCoordinator` whose instalments say who recorded them. */
export type ProjectCoordinator = Omit<SaleCoordinator, "incentive"> & {
  incentive: DetailIncentive | null;
};

/**
 * A project with everything its detail page shows. `coordinators` are the
 * sale's (its work order's), in order, each with the incentive the viewer may
 * see.
 */
export type ProjectDetail = Omit<
  Project,
  | "work_order"
  | "coordinator"
  | "coordinators"
  | "coordinator_id"
  | "coordinator_incentive"
  | "incentive_paid_on"
  | "milestones"
> & {
  work_order: ProjectWorkOrder | null;
  coordinators: ProjectCoordinator[];
  /** Who recorded the cancellation, as far as the viewer may read profiles. */
  cancelled_by_name: string | null;
  milestones: ProjectMilestone[];
};

/** The slice of a project the server actions decide and notify with (office callers). */
export interface ProjectBrief
  extends Pick<
    Project,
    | "id"
    | "work_order_id"
    | "is_completed"
    | "completed_at"
    | "feasibility_date"
    | "cancellation"
    | "cancelled_on"
    | "cancellation_remarks"
  > {
  client_name: string;
  plan_type: PlanType;
  order_date: string;
  coordinators: SaleCoordinator[];
}

export interface ProjectOption {
  id: string;
  client_name: string;
  plant_capacity: string;
  /** Set when the project was cancelled or refunded (so a picker can say so). */
  cancellation: ProjectCancellation | null;
}

export type MilestoneSlice = Pick<
  ProjectMilestone,
  "id" | "stage" | "sort_order" | "status" | "completed_at"
>;

/**
 * Coordinator incentive totals (rupees) over projects with an incentive set:
 * what was agreed, what instalments have paid of it, and what is left.
 */
export interface IncentiveSummary {
  projects: number;
  /** Projects on which some incentive is still to pay (instalments short of the agreed amount). */
  pendingProjects: number;
  /** Σ agreed amounts. */
  total: number;
  /** Σ instalments paid. */
  paid: number;
  /** total − paid. */
  pending: number;
}

type WriteResult = { error: string | null };

/** What an instalment's writable columns take (who recorded it is the database's). */
export interface IncentivePaymentInput {
  amount: number;
  paid_on: string;
  note: string | null;
}

type Money = number | string;
type Embedded<T> = T | T[] | null | undefined;

/** One `coordinator_incentive_payments` row as the embed returns it. */
interface InstalmentRow {
  id: string;
  amount: Money;
  paid_on: string;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
  /** Only embedded where the recorder is shown. */
  recorder?: Embedded<{ full_name: string }>;
}

/** One `coordinator_incentives` row as the embed returns it. */
interface IncentiveRow {
  amount: Money | null;
  paid_on: string | null;
  payments?: Embedded<InstalmentRow>;
}

/** One `work_order_coordinators` row as the embed returns it. */
interface MemberRow {
  coordinator_id: string;
  sort_order: number;
  created_at: string;
  profile: { id: string; full_name: string } | null;
  incentive: Embedded<IncentiveRow>;
}

/** A to-many embed is an array; tolerate the lone object a to-one reading would give. */
function manyOf<T>(embed: Embedded<T>): T[] {
  if (Array.isArray(embed)) return embed;
  return embed ? [embed] : [];
}

/** Oldest first: by the day paid, then the order they were recorded in. */
function byPaidDate(a: InstalmentRow, b: InstalmentRow): number {
  return (
    (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : 0) ||
    (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
    (a.id < b.id ? -1 : 1)
  );
}

function mapIncentive(row: IncentiveRow | null): DetailIncentive | null {
  if (!row) return null;
  const payments: IncentiveInstalment[] = manyOf(row.payments)
    .sort(byPaidDate)
    .map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      paid_on: p.paid_on,
      note: p.note,
      recorded_by: p.recorded_by,
      recorded_by_name: oneToOne(p.recorder)?.full_name ?? null,
    }));
  return {
    amount: row.amount === null ? null : Number(row.amount),
    // Derived by the database from the instalments; never written from here.
    paid_on: row.paid_on,
    payments,
    paid: incentivePaid(payments),
  };
}

/**
 * The embed's rows as the sale's ordered coordinators — the order the database
 * keeps its first coordinator by (sort_order, then who joined first, then id).
 */
function mapCoordinators(members: readonly MemberRow[] | null | undefined): ProjectCoordinator[] {
  return [...(members ?? [])]
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
        (a.coordinator_id < b.coordinator_id ? -1 : 1),
    )
    .map((member) => ({
      id: member.coordinator_id,
      full_name: member.profile?.full_name ?? "Unknown",
      sort_order: member.sort_order,
      incentive: mapIncentive(oneToOne(member.incentive)),
    }));
}

type DetailRow = Omit<ProjectDetail, "work_order" | "coordinators" | "cancelled_by_name"> & {
  work_order: (ProjectWorkOrder & { coordinators: MemberRow[] | null }) | null;
  cancelled_by_profile: { full_name: string } | { full_name: string }[] | null;
};

type BriefRow = Omit<ProjectBrief, "client_name" | "plan_type" | "order_date" | "coordinators"> & {
  work_order: {
    client_name: string;
    plan_type: PlanType;
    order_date: string;
    coordinators: MemberRow[] | null;
  } | null;
};

/**
 * Projects. RLS decides visibility (a coordinator reads the projects of sales
 * they share) and makes every write office-only. A write that RLS filters out
 * affects zero rows WITHOUT raising, so writes check the affected rows instead
 * of claiming a success that never happened.
 */
export const projectsRepository = {
  /**
   * Rows for the board (bounded, newest first). The board reads the flattened
   * view: payment state comes from the payments ledger and the feasibility
   * clock from SQL, neither of which a plain projects select can provide.
   */
  async board(limit: number = LIST_QUERY_LIMIT): Promise<ProjectListRow[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects_list")
      .select("*")
      .order("created_at", { ascending: false })
      // Unique last (an import's rows share one created_at): the same rows make
      // the cut every time.
      .order("id", { ascending: true })
      .limit(limit);
    return (data as ProjectListRow[] | null) ?? [];
  },

  /** Most-recent slice (flattened rows) for dashboard/overview contexts. */
  async recent(limit: number): Promise<ProjectListRow[]> {
    const { rows } = await this.page({
      page: 1,
      pageSize: limit,
      q: "",
      sort: null,
      dir: "desc",
      filters: {},
    });
    return rows;
  },

  /**
   * Server-side paginated/filtered/sorted page from the flattened view. Unknown
   * filter values are ignored rather than trusted — they arrive from the URL.
   * A page past the end comes back empty with the real total; a failed read
   * throws.
   *
   * The filters mirror the row predicates in lib/domain/project-list.ts
   * (matchesProjectStatus, matchesFeasibilityFilter, matchesCoordinator,
   * matchesSaleIncentiveFilter), which the board and client-mode tables apply to
   * the same rows; projects.repository.test.ts pins the two together.
   */
  async page(params: PageParams): Promise<PageResult<ProjectListRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);
    const { status, stage, coordinator, financing, feasibility, incentive, plan } =
      params.filters;
    // A person from the URL: anything that is not a uuid would only make
    // Postgres reject the whole query.
    const [coordinatorId] = normalizeCoordinatorIds([coordinator]);

    const filtered = (head: boolean) => {
      let query = supabase
        .from("projects_list")
        .select("*", { count: "exact", head });

      const q = sanitizeSearch(params.q);
      if (q) {
        const like = `%${q}%`;
        // coordinator_name lists every coordinator of the sale.
        query = query.or(
          `client_name.ilike.${like},coordinator_name.ilike.${like},consumer_number.ilike.${like}`,
        );
      }

      if (isProjectStatusFilter(status)) {
        switch (status) {
          // Cancelled and refunded projects leave the pipeline and the
          // commissioned count.
          case "active":
            query = query.eq("is_completed", false).is("cancellation", null);
            break;
          case "completed":
            query = query.eq("is_completed", true).is("cancellation", null);
            break;
          // Commissioned, but the contract value is not fully collected (the
          // view already leaves cancelled projects out).
          case "payment_pending":
            query = query.eq("payment_pending", true);
            break;
          case "cancelled":
          case "refunded":
            query = query.eq("cancellation", status);
            break;
          case "closed":
            query = query.not("cancellation", "is", null);
            break;
        }
      }
      if (isPlanFilter(plan)) query = query.eq("plan_type", plan);
      if (isProjectStage(stage)) query = query.eq("current_stage", stage);
      // Any coordinator of the sale, not only the first.
      if (coordinatorId) query = query.contains("coordinator_ids", [coordinatorId]);
      if (financing && isFinancingType(financing)) {
        query = query.eq("financing_type", financing);
      }

      // Only an active project has a running clock to expire or to be missing,
      // and a custom plan has no feasibility date to miss; renewal fees BSS has
      // borne stay with a project after it is commissioned or cancelled, so
      // "extended" includes those (it drills down from the dashboard's
      // extension-cost total, which counts every project).
      if (isFeasibilityFilter(feasibility)) {
        if (feasibility === "expiring") {
          query = query
            .eq("is_completed", false)
            .is("cancellation", null)
            .gte("feasibility_days_left", 0)
            .lte("feasibility_days_left", FEASIBILITY_WARNING_DAYS);
        }
        if (feasibility === "extended") query = query.gt("feasibility_renewals", 0);
        if (feasibility === "not_set") {
          query = query
            .eq("is_completed", false)
            .is("feasibility_date", null)
            .is("cancellation", null)
            .eq("plan_type", "solar");
        }
      }

      // The incentive columns are the caller's own (RLS): the office sees every
      // coordinator's, so it may narrow to one person; a coordinator only ever
      // sees theirs. "Unpaid" is instalments short of the agreed amount.
      if (isIncentiveFilter(incentive)) {
        const owed = () =>
          coordinatorId
            ? query.contains("incentive_unpaid_coordinator_ids", [coordinatorId])
            : query.gt("incentive_unpaid_count", 0);
        switch (incentive) {
          case "pending":
            query = owed();
            break;
          // Something is still owed AND money has been paid on the sale.
          case "partly_paid":
            query = owed().gt("incentive_paid", 0);
            break;
          case "paid":
            query = coordinatorId
              ? query.contains("incentive_paid_coordinator_ids", [coordinatorId])
              : query.gt("incentive_count", 0).eq("incentive_unpaid_count", 0);
            break;
        }
      }
      return query;
    };

    const sortCol: ProjectSortColumn = isProjectSortColumn(params.sort)
      ? params.sort
      : "created_at";
    const { rows, total } = await fetchCountedPage(
      {
        // Rows without a value (no feasibility clock, no incentive) sort last in
        // either direction, so "most urgent first" never opens on blanks.
        rows: () => {
          const sorted = filtered(false).order(sortCol, {
            ascending: params.dir === "asc",
            nullsFirst: false,
          });
          // Ties show the newest project first. A bulk import creates every row in
          // one transaction with the same created_at, so `id` goes last: a unique
          // key, without which the same project can land on two pages while
          // another lands on none.
          return (sortCol === "created_at"
            ? sorted
            : sorted.order("created_at", { ascending: false })
          )
            .order("id", { ascending: true })
            .range(from, to);
        },
        countOnly: () => filtered(true),
      },
      "projects",
    );
    return {
      rows: rows as ProjectListRow[],
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  async byId(id: string): Promise<ProjectDetail | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(SELECT_DETAIL)
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;

    const { work_order, cancelled_by_profile, ...project } = data as unknown as DetailRow;
    const { coordinators, ...workOrder } = work_order ?? { coordinators: null };
    return {
      ...project,
      work_order: work_order ? (workOrder as ProjectWorkOrder) : null,
      coordinators: mapCoordinators(coordinators),
      cancelled_by_name: oneToOne(cancelled_by_profile)?.full_name ?? null,
    };
  },

  /**
   * Just enough of a project to authorise, decide and notify a change. For the
   * office: it carries every coordinator and every incentive. A project whose
   * work order cannot be read is "not found" — nothing can be decided without
   * its order date and team.
   */
  async brief(id: string): Promise<ProjectBrief | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(SELECT_BRIEF)
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;

    const { work_order, ...project } = data as unknown as BriefRow;
    if (!work_order) return null;
    return {
      ...project,
      client_name: work_order.client_name,
      plan_type: work_order.plan_type,
      order_date: work_order.order_date,
      coordinators: mapCoordinators(work_order.coordinators),
    };
  },

  async options(): Promise<ProjectOption[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(
        `id, cancellation,
         work_order:work_orders!projects_work_order_id_fkey(client_name, plant_capacity)`,
      )
      .order("created_at", { ascending: false })
      .limit(PROJECT_PICKER_LIMIT);

    return (data ?? []).map((p) => ({
      id: p.id,
      client_name: p.work_order?.client_name ?? "Project",
      plant_capacity: p.work_order?.plant_capacity ?? "",
      cancellation: p.cancellation ?? null,
    }));
  },

  async existsForWorkOrder(workOrderId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select("id")
      .eq("work_order_id", workOrderId)
      .maybeSingle();
    return Boolean(data);
  },

  /** The project's coordinator is its work order's (the database derives it). */
  async createForWorkOrder(
    workOrderId: string,
    coordinatorId: string,
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { error } = await supabase.from("projects").insert({
      work_order_id: workOrderId,
      coordinator_id: coordinatorId,
    });
    return { error: error?.message ?? null };
  },

  /**
   * Hard-delete a project (cascades to its milestones; service tickets keep
   * their history with a null project).
   */
  async remove(id: string): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Nothing was deleted — only the SuperAdmin can delete." };
    }
    return { error: null };
  },

  async setProgress(
    id: string,
    patch: {
      current_stage: ProjectStage;
      is_completed: boolean;
      completed_at: string | null;
    },
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Project progress was not saved — office staff only." };
    }
    return { error: null };
  },

  /** The KSEB feasibility date (null clears it). Incentives have their own write. */
  async setFeasibilityDate(id: string, date: string | null): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update({ feasibility_date: date })
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Project not found, or you cannot edit it." };
    }
    return { error: null };
  },

  /**
   * One person's agreed incentive on a sale (null removes it). The amount is
   * the only column written: the paid date is derived by the database from the
   * instalments, and the column grant says the same. The row exists for every
   * coordinator of the sale — the database opens it with the membership — so no
   * row means that person is not on the sale (any more), or the caller is not
   * office staff. The database refuses an amount below what has been paid.
   */
  async setCoordinatorIncentive(
    workOrderId: string,
    coordinatorId: string,
    incentive: IncentiveSetting,
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("coordinator_incentives")
      .update({ amount: incentive.amount })
      .eq("work_order_id", workOrderId)
      .eq("coordinator_id", coordinatorId)
      .select("coordinator_id");
    if (error) return { error: incentiveWriteMessage(error.message) };
    if (!data || data.length === 0) {
      return { error: "The incentive was not saved — that person may no longer be on this sale." };
    }
    return { error: null };
  },

  /**
   * Record one instalment against a person's incentive. Who recorded it is
   * stamped by the database from the session. The database refuses one that
   * would take the instalments past the agreed amount, or one on an incentive
   * with no amount.
   */
  async recordIncentivePayment(
    workOrderId: string,
    coordinatorId: string,
    payment: IncentivePaymentInput,
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("coordinator_incentive_payments")
      .insert({ work_order_id: workOrderId, coordinator_id: coordinatorId, ...payment })
      .select("id");
    if (error) {
      return {
        error:
          // The incentive row went with the person when they left the sale.
          error.code === "23503"
            ? "That person no longer has an incentive on this sale."
            : incentiveWriteMessage(error.message),
      };
    }
    if (!data || data.length === 0) {
      return { error: "The payment was not saved — office staff only." };
    }
    return { error: null };
  },

  /** Correct an instalment's amount, date or note (never which incentive it belongs to). */
  async updateIncentivePayment(
    id: string,
    payment: IncentivePaymentInput,
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("coordinator_incentive_payments")
      .update(payment)
      .eq("id", id)
      .select("id");
    if (error) return { error: incentiveWriteMessage(error.message) };
    if (!data || data.length === 0) {
      return { error: "That payment was not found, or you cannot change it." };
    }
    return { error: null };
  },

  /** Remove an instalment (a mistaken one): the incentive is owed again. */
  async deleteIncentivePayment(id: string): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("coordinator_incentive_payments")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return { error: incentiveWriteMessage(error.message) };
    if (!data || data.length === 0) {
      return { error: "That payment was not found, or you cannot remove it." };
    }
    return { error: null };
  },

  /**
   * Mark a project cancelled or refunded (or change the remarks/date of an
   * existing one). Who recorded it is stamped by the database from the session.
   */
  async setCancellation(
    id: string,
    patch: {
      cancellation: ProjectCancellation;
      cancelled_on: string | null;
      cancellation_remarks: string | null;
    },
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Project not found, or you cannot edit it." };
    }
    return { error: null };
  },

  /**
   * Bring a cancelled or refunded project back, keeping the (editable) remarks
   * as the history note. ONE update, with the new feasibility date when there is
   * one: the clock must never run on the old date in between.
   */
  async reinstate(
    id: string,
    input: { remarks: string | null; feasibility_date?: string },
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update({
        cancellation: null,
        cancelled_on: null,
        cancellation_remarks: input.remarks,
        ...(input.feasibility_date !== undefined
          ? { feasibility_date: input.feasibility_date }
          : {}),
      })
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Project not found, or you cannot edit it." };
    }
    return { error: null };
  },

  /**
   * Stamp the feasibility date unless one is already recorded. The null check
   * is part of the UPDATE, so a date the office entered meanwhile always wins.
   */
  async captureFeasibilityDate(id: string, date: string): Promise<WriteResult> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({ feasibility_date: date })
      .eq("id", id)
      .is("feasibility_date", null);
    return { error: error?.message ?? null };
  },

  /**
   * Incentive totals. The RPC is SECURITY INVOKER, so a coordinator only ever
   * sums their own incentives; the office may narrow to one coordinator. Null
   * when the totals could not be read (the caller hides them).
   */
  async incentiveSummary(coordinatorId?: string | null): Promise<IncentiveSummary | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc(
        "incentive_summary",
        coordinatorId ? { p_coordinator: coordinatorId } : {},
      )
      .maybeSingle();
    if (error) return null;
    return {
      projects: amount(data?.projects),
      pendingProjects: amount(data?.pending_projects),
      total: amount(data?.total),
      paid: amount(data?.paid),
      pending: amount(data?.pending),
    };
  },

  /** Ordered milestone slices for stage recomputation / advancement. */
  async milestones(projectId: string): Promise<MilestoneSlice[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_milestones")
      .select("id, stage, sort_order, status, completed_at")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });
    return data ?? [];
  },

  async updateMilestone(
    milestoneId: string,
    patch: {
      status: MilestoneStatus;
      notes?: string | null;
      completed_at: string | null;
    },
  ): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_milestones")
      .update(patch)
      .eq("id", milestoneId)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Milestone not found, or you cannot edit it." };
    }
    return { error: null };
  },
};
