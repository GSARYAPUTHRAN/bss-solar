import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import {
  fetchCountedPage,
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import {
  UNASSIGNED_ENGINEER_FILTER,
  isTicketStatus,
} from "@/lib/domain/ticket-workflow";
import type {
  EngineerTicketRow,
  MpptReading,
  ServiceTicket,
  SpvStringReading,
  TicketListRow,
  TicketStatus,
  TicketType,
} from "@/lib/types";

// The jsonb reading columns are typed as `Json` by the generated schema; the
// app models them as structured arrays, so cast explicitly at this boundary.
type TicketRowUpdate = Database["public"]["Tables"]["service_tickets"]["Update"];

const TICKET_SORT_COLUMNS = new Set([
  "created_at",
  "scheduled_date",
  "total",
  "client_name",
  "ticket_no",
]);

const ENGINEER_SORT_COLUMNS = new Set([
  "created_at",
  "scheduled_date",
  "service_date",
  "client_name",
  "ticket_no",
]);

const SELECT_DETAIL = `*,
  project:projects!service_tickets_project_id_fkey(
    id, work_order_id,
    work_order:work_orders!projects_work_order_id_fkey(client_name, address, client_phone)
  ),
  assignee:profiles!service_tickets_assigned_to_fkey(id, full_name)`;

/** What actions need to know about a ticket before changing it. */
export type TicketSummary = Pick<
  TicketListRow,
  | "id"
  | "ticket_no"
  | "status"
  | "scheduled_date"
  | "client_name"
  | "assigned_to"
  | "assignee_name"
>;

const NOT_FOUND = "This ticket no longer exists, or you no longer have access to it.";

export interface TicketCreateInput {
  project_id: string | null;
  /** Optional — assigned by a DB sequence/trigger when omitted. */
  ticket_no?: string;
  ticket_type: TicketType;
  status: TicketStatus;
  /** Always a service engineer (the DB rejects anyone else). */
  assigned_to: string;
  scheduled_date: string | null;
  nature_of_complaint: string | null;
  created_by: string;
}

export interface TicketUpdateInput {
  ticket_type: TicketType;
  status: TicketStatus;
  assigned_to: string | null;
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
  /**
   * Office list: server-side paginated/filtered/sorted page from the flattened
   * view. `filters.engineer` is an engineer id, or "unassigned". A page past
   * the end comes back empty with the real total; a failed read throws.
   */
  async page(params: PageParams): Promise<PageResult<TicketListRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);

    const filtered = (head: boolean) => {
      let query = supabase
        .from("service_tickets_list")
        .select("*", { count: "exact", head });

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
      const engineer = params.filters.engineer;
      if (engineer === UNASSIGNED_ENGINEER_FILTER) {
        query = query.is("assigned_to", null);
      } else if (engineer) {
        query = query.eq("assigned_to", engineer);
      }
      return query;
    };

    const sortCol = TICKET_SORT_COLUMNS.has(params.sort ?? "")
      ? (params.sort as "created_at")
      : "created_at";
    const { rows, total } = await fetchCountedPage(
      {
        rows: () =>
          filtered(false)
            .order(sortCol, { ascending: params.dir === "asc" })
            .range(from, to),
        countOnly: () => filtered(true),
      },
      "service tickets",
    );
    return {
      rows: rows as TicketListRow[],
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  /**
   * The signed-in engineer's own worklist, via `engineer_tickets()` — the only
   * route by which an engineer sees site details (never the work order itself).
   * `statuses` narrows to a scope (e.g. active work); `filters.status` /
   * `filters.type` narrow further. A page past the end comes back empty with
   * the real total (so the list can offer a way back rather than "all caught
   * up"); a failed read throws.
   */
  async pageForEngineer(
    params: PageParams,
    statuses: readonly TicketStatus[] | null = null,
  ): Promise<PageResult<EngineerTicketRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);

    const filtered = (head: boolean) => {
      let query = supabase.rpc("engineer_tickets", {}, { count: "exact", head });

      const q = sanitizeSearch(params.q);
      if (q) {
        const like = `%${q}%`;
        query = query.or(`ticket_no.ilike.${like},client_name.ilike.${like}`);
      }
      if (statuses) query = query.in("status", statuses);
      if (isTicketStatus(params.filters.status)) {
        query = query.eq("status", params.filters.status);
      }
      if (params.filters.type) {
        query = query.eq("ticket_type", params.filters.type as TicketType);
      }
      return query;
    };

    const sortCol = ENGINEER_SORT_COLUMNS.has(params.sort ?? "")
      ? (params.sort as "scheduled_date")
      : "scheduled_date";
    const { rows, total } = await fetchCountedPage(
      {
        rows: () =>
          filtered(false)
            // Undated tickets sink to the end whichever way the list is sorted.
            .order(sortCol, { ascending: params.dir === "asc", nullsFirst: false })
            .order("created_at", { ascending: false })
            .range(from, to),
        countOnly: () => filtered(true),
      },
      "your service tickets",
    );
    return {
      rows: rows as EngineerTicketRow[],
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  /** One of the signed-in engineer's tickets with its site details, or null. */
  async engineerTicket(id: string): Promise<EngineerTicketRow | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .rpc("engineer_tickets")
      .eq("id", id)
      .maybeSingle();
    return (data as EngineerTicketRow | null) ?? null;
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

  /** Status, assignee and client of a ticket, as the caller may see them. */
  async summary(id: string): Promise<TicketSummary | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("service_tickets_list")
      .select(
        "id, ticket_no, status, scheduled_date, client_name, assigned_to, assignee_name",
      )
      .eq("id", id)
      .maybeSingle();
    return (data as TicketSummary | null) ?? null;
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
    const { data, error } = await supabase
      .from("service_tickets")
      .update(patch as unknown as TicketRowUpdate)
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    return { error: data && data.length > 0 ? null : NOT_FOUND };
  },

  /**
   * Move a ticket's status. RLS lets an engineer update only their own tickets
   * and the guard trigger only their status, so a refused update affects no
   * rows rather than erroring — report that instead of claiming success.
   */
  async setStatus(
    id: string,
    status: TicketStatus,
  ): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("service_tickets")
      .update({ status })
      .eq("id", id)
      .select("id");
    if (error) return { error: error.message };
    return { error: data && data.length > 0 ? null : NOT_FOUND };
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
