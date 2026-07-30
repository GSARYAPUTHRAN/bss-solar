import { createClient } from "@/lib/supabase/server";
import { LIST_QUERY_LIMIT } from "@/lib/constants";
import {
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import type {
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

/** Explicit columns + joins needed to render a work order (no SELECT *). */
const SELECT = `id, coordinator_id, client_name, client_phone, address,
  plant_capacity, advance_amount, total_cost, order_date, status,
  consumer_number, notes, kseb_section, loan_bank_name,
  first_payment_date, first_payment_amount,
  second_payment_date, second_payment_amount,
  created_at, updated_at,
  coordinator:profiles!work_orders_coordinator_id_fkey(id, full_name),
  projects(id, current_stage, is_completed)`;

/** Flatten the one-to-one `projects[]` join into a single `project`. */
function mapWorkOrder(row: Record<string, unknown>): WorkOrder {
  const { projects, ...rest } = row as {
    projects?: WorkOrder["project"][] | null;
  } & Record<string, unknown>;
  return {
    ...(rest as unknown as WorkOrder),
    project: projects && projects.length > 0 ? projects[0] : null,
  };
}

/** The office/field detail fields, shared by create and update. */
export interface WorkOrderDetailsInput {
  consumer_number: string | null;
  notes: string | null;
  kseb_section: string | null;
  loan_bank_name: string | null;
  first_payment_date: string | null;
  first_payment_amount: number | null;
  second_payment_date: string | null;
  second_payment_amount: number | null;
}

export interface WorkOrderInput extends WorkOrderDetailsInput {
  coordinator_id: string;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  plant_capacity: string;
  advance_amount: number;
  total_cost: number;
  order_date: string;
}

/**
 * Editable columns. `status` and `coordinator_id` are deliberately absent — they
 * are admin-only transitions with their own actions, and a DB trigger rejects a
 * coordinator that tries to change them anyway.
 */
export type WorkOrderPatch = Omit<WorkOrderInput, "coordinator_id">;

export const workOrdersRepository = {
  async list(limit: number = LIST_QUERY_LIMIT): Promise<WorkOrder[]> {
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

  /** Server-side paginated/filtered/sorted page from the flattened view. */
  async page(params: PageParams): Promise<PageResult<WorkOrderListRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);

    let query = supabase.from("work_orders_list").select("*", { count: "exact" });

    const q = sanitizeSearch(params.q);
    if (q) {
      const like = `%${q}%`;
      query = query.or(
        `client_name.ilike.${like},client_phone.ilike.${like},address.ilike.${like},coordinator_name.ilike.${like},consumer_number.ilike.${like}`,
      );
    }
    if (params.filters.status) {
      query = query.eq("status", params.filters.status as WorkOrderStatus);
    }
    if (params.filters.coordinator) {
      query = query.eq("coordinator_id", params.filters.coordinator);
    }
    // "Money still to collect" across the CRM, regardless of project stage.
    if (params.filters.payment === "pending") {
      query = query.gt("balance_due", 0);
    } else if (params.filters.payment === "settled") {
      query = query.lte("balance_due", 0);
    }

    const sortCol = WO_SORT_COLUMNS.has(params.sort ?? "")
      ? (params.sort as "order_date")
      : "order_date";
    query = query
      .order(sortCol, { ascending: params.dir === "asc" })
      .range(from, to);

    const { data, count } = await query;
    return {
      rows: (data as WorkOrderListRow[]) ?? [],
      total: count ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  async byId(id: string): Promise<WorkOrder | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("work_orders")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();
    return data ? mapWorkOrder(data as Record<string, unknown>) : null;
  },

  async create(input: WorkOrderInput): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase.from("work_orders").insert(input);
    return { error: error?.message ?? null };
  },

  /**
   * Update the editable detail columns. RLS scopes the row to its owning
   * coordinator (or an admin), so an unmatched id yields "not found" rather than
   * a silent no-op.
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
   * Hard-delete (cascades to the project + milestones). A DELETE blocked by RLS
   * removes zero rows *without* raising, so the affected rows are checked
   * explicitly — otherwise a non-SuperAdmin would see a false success.
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
