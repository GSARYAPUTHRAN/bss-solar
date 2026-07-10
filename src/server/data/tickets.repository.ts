import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { LIST_QUERY_LIMIT } from "@/lib/constants";
import {
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";

const TICKET_SORT_COLUMNS = new Set([
  "created_at",
  "scheduled_date",
  "total",
  "client_name",
  "ticket_no",
]);

// The jsonb reading columns are typed as `Json` by the generated schema; the
// app models them as structured arrays, so cast explicitly at this boundary.
type TicketRowUpdate = Database["public"]["Tables"]["service_tickets"]["Update"];
import type {
  MpptReading,
  ServiceTicket,
  SpvStringReading,
  TicketListRow,
  TicketStatus,
  TicketType,
} from "@/lib/types";

// List projection: only what the tickets table renders/searches. Deliberately
// excludes the ~30 detail columns and the JSONB reading arrays (fetched only in
// the detail view) to keep list payloads small.
const SELECT_LIST = `id, ticket_no, ticket_type, status, scheduled_date, total,
  project:projects!service_tickets_project_id_fkey(
    id,
    work_order:work_orders!projects_work_order_id_fkey(client_name)
  )`;

const SELECT_DETAIL = `*,
  project:projects!service_tickets_project_id_fkey(
    id, work_order_id,
    work_order:work_orders!projects_work_order_id_fkey(client_name, address, client_phone)
  )`;

export interface TicketCreateInput {
  project_id: string | null;
  /** Optional — assigned by a DB sequence/trigger when omitted. */
  ticket_no?: string;
  ticket_type: TicketType;
  status: TicketStatus;
  assigned_to: string | null;
  scheduled_date: string | null;
  nature_of_complaint: string | null;
  created_by: string;
}

export interface TicketUpdateInput {
  ticket_type: TicketType;
  status: TicketStatus;
  scheduled_date: string | null;
  service_date: string | null;
  sys_capacity: string | null;
  sys_loading_capacity: string | null;
  sys_make: string | null;
  sys_model: string | null;
  sys_serial_no: string | null;
  bat_capacity_ah: string | null;
  bat_make: string | null;
  bat_model: string | null;
  bat_qty: number | null;
  bat_bank_nos: number | null;
  spv_module_capacity: string | null;
  spv_make: string | null;
  spv_voc: string | null;
  spv_total_nos: number | null;
  spv_total_watts: number | null;
  spv_no_of_strings: number | null;
  spv_string_readings: SpvStringReading[];
  mppt_readings: MpptReading[];
  battery_voltage: string | null;
  charging_current: string | null;
  battery_water_level: string | null;
  nature_of_complaint: string | null;
  defects_found: string | null;
  action_taken: string | null;
  service_charge: number;
  cost_of_spares: number;
  amc_charge: number;
  total: number;
}

export const ticketsRepository = {
  async list(limit: number = LIST_QUERY_LIMIT): Promise<ServiceTicket[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("service_tickets")
      .select(SELECT_LIST)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as unknown as ServiceTicket[]) ?? [];
  },

  /** Server-side paginated/filtered/sorted page from the flattened view. */
  async page(params: PageParams): Promise<PageResult<TicketListRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);

    let query = supabase
      .from("service_tickets_list")
      .select("*", { count: "exact" });

    const q = sanitizeSearch(params.q);
    if (q) {
      const like = `%${q}%`;
      query = query.or(`ticket_no.ilike.${like},client_name.ilike.${like}`);
    }
    if (params.filters.type) {
      query = query.eq("ticket_type", params.filters.type as TicketType);
    }
    if (params.filters.status) {
      query = query.eq("status", params.filters.status as TicketStatus);
    }

    const sortCol = TICKET_SORT_COLUMNS.has(params.sort ?? "")
      ? (params.sort as "created_at")
      : "created_at";
    query = query
      .order(sortCol, { ascending: params.dir === "asc" })
      .range(from, to);

    const { data, count } = await query;
    return {
      rows: (data as TicketListRow[]) ?? [],
      total: count ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  async byId(id: string): Promise<ServiceTicket | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("service_tickets")
      .select(SELECT_DETAIL)
      .eq("id", id)
      .maybeSingle();
    return (data as unknown as ServiceTicket) ?? null;
  },

  async listByProject(projectId: string): Promise<ServiceTicket[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("service_tickets")
      .select("id, ticket_no, ticket_type, status, scheduled_date, total")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    return (data as ServiceTicket[]) ?? [];
  },

  async create(
    input: TicketCreateInput,
  ): Promise<{ id: string | null; error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("service_tickets")
      .insert(input)
      .select("id")
      .single();
    return { id: data?.id ?? null, error: error?.message ?? null };
  },

  async update(
    id: string,
    patch: TicketUpdateInput,
  ): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("service_tickets")
      .update(patch as unknown as TicketRowUpdate)
      .eq("id", id);
    return { error: error?.message ?? null };
  },

  async remove(id: string): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("service_tickets")
      .delete()
      .eq("id", id);
    return { error: error?.message ?? null };
  },
};
