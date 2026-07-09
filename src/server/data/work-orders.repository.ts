import { createClient } from "@/lib/supabase/server";
import { LIST_QUERY_LIMIT } from "@/lib/constants";
import type { WorkOrder, WorkOrderStatus } from "@/lib/types";

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

  /** Most-recent slice for dashboard/overview contexts. */
  async recent(limit: number): Promise<WorkOrder[]> {
    return this.list(limit);
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
