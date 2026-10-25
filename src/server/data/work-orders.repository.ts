import { createClient } from "@/lib/supabase/server";
import { LIST_QUERY_LIMIT } from "@/lib/constants";
import {
  fetchCountedPage,
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import { normalizeCoordinatorIds } from "@/lib/domain/coordinators";
import { isFinancingType } from "@/lib/domain/payment";
import { isPlanFilter } from "@/lib/domain/project-list";
import { isWorkOrderStatusFilter } from "@/lib/domain/work-order-list";
import { oneToOne } from "./embeds";
import type {
  FinancingType,
  PlanType,
  Project,
  SaleCoordinator,
  WorkOrder,
  WorkOrderListRow,
  WorkOrderStatus,
} from "@/lib/types";

const WO_SORT_COLUMNS = new Set([
  "order_date",
  "total_cost",
  "advance_amount",
  "balance_due",
  "client_name",
  "coordinator_name",
  "status",
  "created_at",
]);

/**
 * Explicit columns + joins needed to render a work order (no SELECT *). Every
 * embed is FK-hinted: `profiles` is reachable from the membership table through
 * more than one foreign key (`coordinator_id`, `added_by`), and an unhinted
 * embed would be ambiguous (PGRST201).
 */
const SELECT = `id, coordinator_id, client_name, client_phone, address,
  plan_type, plant_capacity, plant_capacity_kw, advance_amount, total_cost, order_date,
  status, consumer_number, notes, kseb_section, financing_type, loan_bank_name,
  created_at, updated_at,
  coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(
    coordinator_id, sort_order, created_at,
    profile:profiles!work_order_coordinators_coordinator_id_fkey(id, full_name)
  ),
  projects(id, current_stage, is_completed, cancellation, cancelled_on, cancellation_remarks)`;

/**
 * The linked project as the work order's page sees it: where it is, and — once
 * it has left the pipeline — when and why (a cancelled or refunded sale says so
 * on the order it came from).
 */
export type WorkOrderProject = NonNullable<WorkOrder["project"]> &
  Partial<Pick<Project, "cancelled_on" | "cancellation_remarks">>;

/** A work order with its coordinators and (richer) project. A `WorkOrder` still. */
export type WorkOrderDetail = Omit<WorkOrder, "project"> & {
  project?: WorkOrderProject | null;
};

/** One membership row as PostgREST embeds it. */
interface CoordinatorEmbed {
  coordinator_id: string;
  sort_order: number;
  created_at: string;
  profile?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
}

/** Sale order: the database's own `order by sort_order, created_at, coordinator_id`. */
function bySaleOrder(a: CoordinatorEmbed, b: CoordinatorEmbed): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  return a.coordinator_id < b.coordinator_id ? -1 : a.coordinator_id > b.coordinator_id ? 1 : 0;
}

/**
 * The sale's coordinators in order, first first. Incentives are not loaded here
 * (`incentive: null`): the work order never shows anyone's pay, and a
 * coordinator may only read their own row anyway.
 */
function mapCoordinators(embed: CoordinatorEmbed[] | null | undefined): SaleCoordinator[] {
  return [...(embed ?? [])].sort(bySaleOrder).map((member) => ({
    id: member.coordinator_id,
    full_name: oneToOne(member.profile)?.full_name ?? "Unknown",
    sort_order: member.sort_order,
    incentive: null,
  }));
}

/**
 * Flatten the one-to-one `projects` embed into a single `project`, and the
 * membership embed into the ordered `coordinators`.
 */
export function mapWorkOrder(row: Record<string, unknown>): WorkOrderDetail {
  const { projects, coordinators, ...rest } = row as {
    projects?: WorkOrderProject | WorkOrderProject[] | null;
    coordinators?: CoordinatorEmbed[] | null;
  } & Record<string, unknown>;
  return {
    ...(rest as unknown as Omit<WorkOrder, "project" | "coordinators">),
    coordinators: mapCoordinators(coordinators),
    project: oneToOne(projects),
  };
}

/**
 * The office/field detail fields, shared by create and update. Collections after
 * the booking advance live in the payments ledger, never on the work order.
 */
export interface WorkOrderDetailsInput {
  consumer_number: string | null;
  notes: string | null;
  kseb_section: string | null;
  financing_type: FinancingType;
  /** Null unless `financing_type` is "loan". */
  loan_bank_name: string | null;
}

export interface WorkOrderInput extends WorkOrderDetailsInput {
  /** The first coordinator; the rest are added with `setCoordinators`. */
  coordinator_id: string;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  /** Fixed once the work order has a project (the database refuses a change). */
  plan_type: PlanType;
  /** The plan label: a solar plant's capacity, or what a custom plan sold. */
  plant_capacity: string;
  advance_amount: number;
  total_cost: number;
  order_date: string;
}

/**
 * Editable columns. `status` and `coordinator_id` are deliberately absent — the
 * status is an admin-only transition with its own action, and who shares a sale
 * changes only through `setCoordinators` (a DB trigger rejects both from a
 * coordinator, and a direct change of `coordinator_id` from anyone).
 */
export type WorkOrderPatch = Omit<WorkOrderInput, "coordinator_id">;

/** What `set_work_order_coordinators` did: who joined and who left. */
export interface SetCoordinatorsResult {
  added: string[];
  removed: string[];
  error: string | null;
  /** The database's error code (42501, 22023, 23514, P0002 …), when there is one. */
  code?: string;
}

export const workOrdersRepository = {
  async list(limit: number = LIST_QUERY_LIMIT): Promise<WorkOrderDetail[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("work_orders")
      .select(SELECT)
      .order("order_date", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) =>
      mapWorkOrder(row as Record<string, unknown>),
    );
  },

  /** Most-recent slice (flattened rows) for dashboard/overview contexts. */
  async recent(limit: number): Promise<WorkOrderListRow[]> {
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
   * Server-side paginated/filtered/sorted page from the flattened view. The
   * coordinator filter matches anyone on the sale; the payment filter leaves
   * out cancelled and refunded projects (lib/domain/work-order-list.ts holds
   * the same rules for the client-side table).
   */
  async page(params: PageParams): Promise<PageResult<WorkOrderListRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);

    const filtered = (head: boolean) => {
      let query = supabase
        .from("work_orders_list")
        .select("*", { count: "exact", head });

      const q = sanitizeSearch(params.q);
      if (q) {
        const like = `%${q}%`;
        query = query.or(
          `client_name.ilike.${like},client_phone.ilike.${like},address.ilike.${like},coordinator_name.ilike.${like},consumer_number.ilike.${like}`,
        );
      }

      // An unknown value is ignored rather than handed to Postgres as a bad
      // enum (or a bad uuid).
      const status = params.filters.status;
      if (isWorkOrderStatusFilter(status)) {
        switch (status) {
          case "pending":
          case "rejected":
            query = query.eq("status", status);
            break;
          case "approved":
            // The active pipeline: a cancelled or refunded project leaves it.
            query = query.eq("status", "approved").is("cancellation", null);
            break;
          case "cancelled":
          case "refunded":
            query = query.eq("cancellation", status);
            break;
        }
      }
      // Anyone on the sale — not only the coordinator who logged it.
      const [coordinator] = normalizeCoordinatorIds([params.filters.coordinator]);
      if (coordinator) query = query.contains("coordinator_ids", [coordinator]);
      const financing = params.filters.financing;
      if (financing && isFinancingType(financing)) {
        query = query.eq("financing_type", financing);
      }
      const plan = params.filters.plan;
      if (isPlanFilter(plan)) query = query.eq("plan_type", plan);
      // "Money still to collect" across the CRM, regardless of project stage. A
      // cancelled or refunded project's balance is no longer receivable.
      if (params.filters.payment === "pending") {
        query = query.gt("balance_due", 0).is("cancellation", null);
      } else if (params.filters.payment === "settled") {
        query = query.lte("balance_due", 0);
      }
      return query;
    };

    const sortCol = WO_SORT_COLUMNS.has(params.sort ?? "")
      ? (params.sort as "order_date")
      : "order_date";
    const { rows, total } = await fetchCountedPage(
      {
        rows: () =>
          filtered(false)
            .order(sortCol, { ascending: params.dir === "asc" })
            // Unique last: an import's rows share one created_at, so the sort key
            // alone ties and pages overlap or skip rows.
            .order("id", { ascending: true })
            .range(from, to),
        countOnly: () => filtered(true),
      },
      "work orders",
    );
    return {
      rows: rows as WorkOrderListRow[],
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  async byId(id: string): Promise<WorkOrderDetail | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("work_orders")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();
    return data ? mapWorkOrder(data as Record<string, unknown>) : null;
  },

  /** Insert and return the new id (notifications link to it). */
  async create(
    input: WorkOrderInput,
  ): Promise<{ id: string | null; error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("work_orders")
      .insert(input)
      .select("id")
      .maybeSingle();
    if (error) return { id: null, error: error.message };
    if (!data) return { id: null, error: "Work order was not created." };
    return { id: data.id, error: null };
  },

  /**
   * Update the editable detail columns. RLS scopes the row to the sale's
   * coordinators (or an admin), so an unmatched id yields "not found" rather
   * than a silent no-op.
   */
  async update(
    id: string,
    patch: WorkOrderPatch,
  ): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("work_orders")
      .update(patch)
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Work order not found, or you cannot edit it." };
    }
    return { error: null };
  },

  /**
   * Replace who shares the sale (`set_work_order_coordinators`): the office any
   * list, the coordinator who logged a pending order only more partners. Every
   * rule is the database's; its refusals come back as `error` with their `code`.
   * `added` / `removed` are what actually changed (`added` in the order asked).
   */
  async setCoordinators(id: string, ids: string[]): Promise<SetCoordinatorsResult> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_work_order_coordinators", {
      p_work_order_id: id,
      p_coordinator_ids: ids,
    });
    if (error) {
      return { added: [], removed: [], error: error.message, code: error.code };
    }
    const changes = data ?? [];
    const rank = (member: string) => ids.indexOf(member);
    return {
      added: changes
        .filter((c) => c.change === "added")
        .map((c) => c.coordinator_id)
        .sort((a, b) => rank(a) - rank(b)),
      removed: changes.filter((c) => c.change === "removed").map((c) => c.coordinator_id),
      error: null,
    };
  },

  async setStatus(
    id: string,
    status: WorkOrderStatus,
  ): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("work_orders")
      .update({ status })
      .eq("id", id);
    return { error: error?.message ?? null };
  },

  /**
   * Hard-delete (cascades to the project + milestones, the coordinators and
   * their incentives). A DELETE blocked by RLS removes zero rows *without*
   * raising, so the affected rows are checked explicitly — otherwise a
   * non-SuperAdmin would see a false success.
   */
  async remove(id: string): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("work_orders")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) {
      return { error: "Nothing was deleted — only the SuperAdmin can delete." };
    }
    return { error: null };
  },
};
