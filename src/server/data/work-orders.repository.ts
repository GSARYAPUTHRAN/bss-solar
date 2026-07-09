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
  "client_name",
  "coordinator_name",
  "status",
  "created_at",
]);

/** Explicit columns + joins needed to render a work order (no SELECT *). */
const SELECT = `id, coordinator_id, client_name, client_phone, address,
  plant_capacity, advance_amount, total_cost, order_date, status,
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

export interface WorkOrderInput {
  coordinator_id: string;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  plant_capacity: string;
  advance_amount: number;
  total_cost: number;
  order_date: string;
}

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
        `client_name.ilike.${like},client_phone.ilike.${like},address.ilike.${like},coordinator_name.ilike.${like}`,
      );
    }
    if (params.filters.status) {
      query = query.eq("status", params.filters.status as WorkOrderStatus);
    }
    if (params.filters.coordinator) {
      query = query.eq("coordinator_id", params.filters.coordinator);
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

  async remove(id: string): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase.from("work_orders").delete().eq("id", id);
    return { error: error?.message ?? null };
  },
};
