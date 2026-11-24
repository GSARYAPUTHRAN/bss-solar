import { createClient } from "@/lib/supabase/server";
import { RANGE_NOT_SATISFIABLE } from "@/lib/pagination";
import type { ServiceEngineerRef, ServiceTicketFact } from "@/lib/domain/service-report";
import type { TicketStatus, TicketType } from "@/lib/types";
import { oneToOne } from "./embeds";

/**
 * Data access for the Services report: every service ticket (with its
 * customer and assignee names) and every service engineer. It fetches and maps
 * types only — the counting lives in lib/domain/service-report.ts.
 *
 * Runs as the signed-in admin (the page is office only), who reads every
 * ticket. A failed read throws: a report with some tickets missing would show
 * wrong numbers as if they were right.
 *
 * Imported by path, not through `index.ts`: only the Services report uses it.
 */

/** PostgREST answers at most this many rows per request (`max_rows`). */
export const PAGE_SIZE = 1000;

/** Only what the report reads; the customer comes through the project's sale. */
const TICKET_COLUMNS = `id, ticket_no, ticket_type, status, assigned_to, scheduled_date,
  service_date, total, created_at, updated_at,
  project:projects!service_tickets_project_id_fkey(
    work_order:work_orders!projects_work_order_id_fkey(client_name)
  ),
  assignee:profiles!service_tickets_assigned_to_fkey(full_name)`;

type Embed<T> = T | T[] | null;

interface TicketRow {
  id: string;
  ticket_no: string | null;
  ticket_type: TicketType;
  status: TicketStatus;
  assigned_to: string | null;
  scheduled_date: string | null;
  service_date: string | null;
  total: number | string | null;
  created_at: string;
  updated_at: string;
  project: Embed<{ work_order: Embed<{ client_name: string | null }> }>;
  assignee: Embed<{ full_name: string | null }>;
}

interface PageReply<T> {
  data: T[] | null;
  error: { code?: string; message: string } | null;
}

/**
 * Every row of a query, a page at a time. `page(from, to)` must order by a
 * unique column, or rows could repeat or go missing between pages. A short page
 * is the last; so is a range past the end (PostgREST may answer that with 416
 * instead of an empty page when the rows run out exactly at a page boundary).
 */
export async function fetchAllPages<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<PageReply<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      if (from > 0 && error.code === RANGE_NOT_SATISFIABLE) return rows;
      throw new Error(`Could not load ${what}: ${error.message}`);
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

/** numeric may arrive as a string; anything unreadable is no amount. */
function amount(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toTicketFact(row: TicketRow): ServiceTicketFact {
  const workOrder = oneToOne(oneToOne(row.project)?.work_order);
  return {
    id: row.id,
    ticketNo: row.ticket_no,
    ticketType: row.ticket_type,
    status: row.status,
    engineerId: row.assigned_to,
    engineerName: oneToOne(row.assignee)?.full_name ?? null,
    clientName: workOrder?.client_name ?? null,
    scheduledDate: row.scheduled_date,
    serviceDate: row.service_date,
    total: amount(row.total),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const serviceReportRepository = {
  /** Every service ticket, whatever its status or date. */
  async tickets(): Promise<ServiceTicketFact[]> {
    const supabase = await createClient();
    const rows = await fetchAllPages<TicketRow>("service tickets", async (from, to) => {
      const { data, error } = await supabase
        .from("service_tickets")
        .select(TICKET_COLUMNS)
        .order("id", { ascending: true })
        .range(from, to);
      return { data: data as unknown as TicketRow[] | null, error };
    });
    return rows.map(toTicketFact);
  },

  /** Every account that is a service engineer now. */
  async engineers(): Promise<ServiceEngineerRef[]> {
    const supabase = await createClient();
    const rows = await fetchAllPages<{ id: string; full_name: string }>(
      "service engineers",
      async (from, to) => {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("role", "service_engineer")
          .order("id", { ascending: true })
          .range(from, to);
        return { data, error };
      },
    );
    return rows.map((row) => ({ id: row.id, name: row.full_name }));
  },
};
