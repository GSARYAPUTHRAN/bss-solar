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
import { FEASIBILITY_WARNING_DAYS } from "@/lib/domain/kseb";
import { amount, isFinancingType } from "@/lib/domain/payment";
import {
  isFeasibilityFilter,
  isIncentiveFilter,
  isProjectStatusFilter,
} from "@/lib/domain/project-list";
import type { ProjectSettings } from "@/lib/domain/project-settings";
import type {
  MilestoneStatus,
  Profile,
  Project,
  ProjectListRow,
  ProjectMilestone,
  ProjectStage,
  WorkOrder,
} from "@/lib/types";

const PROJECT_SORT_COLUMNS = [
  "created_at",
  "client_name",
  "coordinator_name",
  "current_stage",
  "balance_due",
  "feasibility_days_left",
  "coordinator_incentive",
] as const;
type ProjectSortColumn = (typeof PROJECT_SORT_COLUMNS)[number];

function isSortColumn(value: string | null): value is ProjectSortColumn {
  return (PROJECT_SORT_COLUMNS as readonly (string | null)[]).includes(value);
}

function isProjectStage(value: string | undefined): value is ProjectStage {
  return value !== undefined && Object.hasOwn(STAGE_LABELS, value);
}

// Explicit columns (no SELECT *): the selection doubles as the type the
// Supabase client infers, which is what lets byId return without a cast.
const PROJECT_COLUMNS = `id, work_order_id, coordinator_id, current_stage, is_completed,
  started_at, completed_at, created_at, updated_at,
  feasibility_date, coordinator_incentive, incentive_paid_on`;

const WORK_ORDER_COLUMNS = `id, coordinator_id, client_name, client_phone, address,
  plant_capacity, plant_capacity_kw, advance_amount, total_cost, order_date, status,
  consumer_number, notes, kseb_section, financing_type, loan_bank_name,
  created_at, updated_at`;

const SELECT_DETAIL = `${PROJECT_COLUMNS},
  work_order:work_orders!projects_work_order_id_fkey(${WORK_ORDER_COLUMNS}),
  coordinator:profiles!projects_coordinator_id_fkey(id, full_name),
  milestones:project_milestones(id, project_id, stage, sort_order, status, notes, completed_at)`;

const SELECT_BRIEF = `id, work_order_id, coordinator_id, is_completed, completed_at,
  feasibility_date, coordinator_incentive, incentive_paid_on,
  work_order:work_orders!projects_work_order_id_fkey(client_name)`;

/** A project with everything its detail page shows. */
export type ProjectDetail = Omit<Project, "work_order" | "coordinator" | "milestones"> & {
  work_order: WorkOrder | null;
  coordinator: Pick<Profile, "id" | "full_name"> | null;
  milestones: ProjectMilestone[];
};

/** The slice of a project the server actions decide and notify with. */
export interface ProjectBrief
  extends Pick<
    Project,
    | "id"
    | "work_order_id"
    | "coordinator_id"
    | "is_completed"
    | "completed_at"
    | "feasibility_date"
    | "coordinator_incentive"
    | "incentive_paid_on"
  > {
  client_name: string;
}

export interface ProjectOption {
  id: string;
  client_name: string;
  plant_capacity: string;
}

export type MilestoneSlice = Pick<
  ProjectMilestone,
  "id" | "stage" | "sort_order" | "status" | "completed_at"
>;

/** Coordinator incentive totals (rupees) over projects with an incentive set. */
export interface IncentiveSummary {
  projects: number;
  /** Projects whose incentive is set but not yet paid. */
  pendingProjects: number;
  total: number;
  paid: number;
  pending: number;
}

type WriteResult = { error: string | null };

/**
 * Projects. RLS decides visibility (a coordinator reads only their own) and
 * makes every write office-only. A write that RLS filters out affects zero rows
 * WITHOUT raising, so writes check the affected rows instead of claiming a
 * success that never happened.
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
   */
  async page(params: PageParams): Promise<PageResult<ProjectListRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);
    const { status, stage, coordinator, financing, feasibility, incentive } =
      params.filters;

    const filtered = (head: boolean) => {
      let query = supabase
        .from("projects_list")
        .select("*", { count: "exact", head });

      const q = sanitizeSearch(params.q);
      if (q) {
        const like = `%${q}%`;
        query = query.or(
          `client_name.ilike.${like},coordinator_name.ilike.${like},consumer_number.ilike.${like}`,
        );
      }

      if (isProjectStatusFilter(status)) {
        if (status === "active") query = query.eq("is_completed", false);
        if (status === "completed") query = query.eq("is_completed", true);
        // Commissioned, but the contract value is not fully collected.
        if (status === "payment_pending") query = query.eq("payment_pending", true);
      }
      if (isProjectStage(stage)) query = query.eq("current_stage", stage);
      if (coordinator) query = query.eq("coordinator_id", coordinator);
      if (financing && isFinancingType(financing)) {
        query = query.eq("financing_type", financing);
      }

      // Mirrors matchesFeasibilityFilter in lib/domain/project-list.ts. Only an
      // active project has a running clock to expire or to be missing; renewal
      // fees BSS has borne stay with a project after it is commissioned, so
      // "extended" includes those (it drills down from the dashboard's
      // extension-cost total, which counts every project).
      if (isFeasibilityFilter(feasibility)) {
        if (feasibility === "expiring") {
          query = query
            .eq("is_completed", false)
            .gte("feasibility_days_left", 0)
            .lte("feasibility_days_left", FEASIBILITY_WARNING_DAYS);
        }
        if (feasibility === "extended") query = query.gt("feasibility_renewals", 0);
        if (feasibility === "not_set") {
          query = query.eq("is_completed", false).is("feasibility_date", null);
        }
      }

      if (isIncentiveFilter(incentive)) {
        query =
          incentive === "paid"
            ? query.not("incentive_paid_on", "is", null)
            : query.not("coordinator_incentive", "is", null).is("incentive_paid_on", null);
      }
      return query;
    };

    const sortCol: ProjectSortColumn = isSortColumn(params.sort)
      ? params.sort
      : "created_at";
    const { rows, total } = await fetchCountedPage(
      {
        // Rows without a value (no feasibility clock, no incentive) sort last in
        // either direction, so "most urgent first" never opens on blanks.
        rows: () =>
          filtered(false)
            .order(sortCol, { ascending: params.dir === "asc", nullsFirst: false })
            .range(from, to),
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
    return data;
  },

  /** Just enough of a project to authorise, decide and notify a change. */
  async brief(id: string): Promise<ProjectBrief | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(SELECT_BRIEF)
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const { work_order, ...project } = data;
    return { ...project, client_name: work_order?.client_name ?? "Project" };
  },

  async options(): Promise<ProjectOption[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(
        `id,
         work_order:work_orders!projects_work_order_id_fkey(client_name, plant_capacity)`,
      )
      .order("created_at", { ascending: false })
      .limit(PROJECT_PICKER_LIMIT);

    return (data ?? []).map((p) => ({
      id: p.id,
      client_name: p.work_order?.client_name ?? "Project",
      plant_capacity: p.work_order?.plant_capacity ?? "",
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

  /** Office-maintained facts: feasibility date and the coordinator incentive. */
  async updateSettings(id: string, settings: ProjectSettings): Promise<WriteResult> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update(settings)
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
   * sums their own projects; the office may narrow to one coordinator. Null
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
