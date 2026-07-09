import { createClient } from "@/lib/supabase/server";
import { LIST_QUERY_LIMIT } from "@/lib/constants";
import type {
  MpptReading,
  ServiceTicket,
  SpvStringReading,
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

  async byId(id: string): Promise<ServiceTicket | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("service_tickets")
      .select(SELECT_DETAIL)
      .eq("id", id)
      .maybeSingle();
    return (data as ServiceTicket) ?? null;
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
      .update(patch)
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
