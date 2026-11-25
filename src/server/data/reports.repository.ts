import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/domain/dates";
import type {
  ProjectState,
  ReportData,
  ReportIncentivePayment,
  ReportPayment,
  ReportProject,
  ReportSale,
  ReportTicket,
} from "@/lib/domain/reports";
import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  PlanType,
  ProjectCancellation,
  TicketStatus,
  WorkOrderStatus,
} from "@/lib/types";
import { ROWS_PER_PAGE, readAllPages, type PageReply } from "./read-all";

/**
 * Reads for the monthly management report (/reports). It only fetches and maps
 * rows; every count and sum is in `lib/domain/reports.ts`.
 *
 * PostgREST answers at most 1000 rows a request, so every read pages through
 * with `.range()` on a unique order (`id`) until a short page. A failed read
 * throws: a report of zeros would be read as a bad month, not a broken page.
 *
 * Imported by path, not through `index.ts`: only the Reports page uses it.
 */

export const REPORT_PAGE_SIZE = ROWS_PER_PAGE;

/** Every row of a query, page by page. `page` builds the query for one range. */
function readAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<PageReply>,
): Promise<T[]> {
  return readAllPages<T>(
    page,
    (message) => new Error(`Could not read ${what} for the report: ${message}`),
  );
}

/** numeric/bigint columns may arrive as strings; null means 0. */
function num(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numOrNull(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : num(value);
}

interface SaleRow {
  id: string;
  client_name: string | null;
  order_date: string | null;
  status: WorkOrderStatus | null;
  total_cost: number | string | null;
  plant_capacity: string | null;
  plant_capacity_kw: number | string | null;
  plan_type: PlanType | null;
  advance_amount: number | string | null;
  amount_received: number | string | null;
  balance_due: number | string | null;
  coordinator_ids: string[] | null;
  coordinator_names: string[] | null;
  project_id: string | null;
  is_completed: boolean | null;
  cancellation: ProjectCancellation | null;
  financing_type: FinancingType | null;
  loan_bank_name: string | null;
}

const SALE_COLUMNS = [
  "id",
  "client_name",
  "order_date",
  "status",
  "total_cost",
  "plant_capacity",
  "plant_capacity_kw",
  "plan_type",
  "advance_amount",
  "amount_received",
  "balance_due",
  "coordinator_ids",
  "coordinator_names",
  "project_id",
  "is_completed",
  "cancellation",
  "financing_type",
  "loan_bank_name",
].join(", ");

/** The advance's details live on the table only (the list view has no column for them). */
interface AdvanceRow {
  id: string;
  advance_paid_on: string | null;
  advance_method: PaymentMethod | null;
  advance_reference: string | null;
}

const ADVANCE_COLUMNS = "id, advance_paid_on, advance_method, advance_reference";

interface PaymentRow {
  work_order_id: string;
  paid_on: string;
  amount: number | string;
  purpose: PaymentPurpose;
  paid_by_office: boolean | null;
  method: PaymentMethod;
  reference: string | null;
}

const PAYMENT_COLUMNS =
  "id, work_order_id, paid_on, amount, purpose, paid_by_office, method, reference";

interface ProjectRow {
  work_order_id: string;
  is_completed: boolean;
  completed_at: string | null;
  cancellation: ProjectCancellation | null;
  cancelled_on: string | null;
}

const PROJECT_COLUMNS = "id, work_order_id, is_completed, completed_at, cancellation, cancelled_on";

interface TicketRow {
  status: TicketStatus;
  service_date: string | null;
  updated_at: string;
}

const TICKET_COLUMNS = "id, status, service_date, updated_at";

interface IncentivePaymentRow {
  amount: number | string;
  paid_on: string;
}

const INCENTIVE_PAYMENT_COLUMNS = "id, amount, paid_on";

function projectState(row: SaleRow): ProjectState {
  if (!row.project_id) return "none";
  if (row.cancellation) return row.cancellation;
  return row.is_completed ? "commissioned" : "active";
}

function toSale(row: SaleRow, advance: AdvanceRow | undefined): ReportSale {
  return {
    id: row.id,
    clientName: row.client_name ?? "",
    orderDate: row.order_date ?? "",
    status: row.status ?? "pending",
    totalCost: num(row.total_cost),
    capacityKw: numOrNull(row.plant_capacity_kw),
    plan: row.plant_capacity ?? "",
    planType: row.plan_type ?? "solar",
    advanceAmount: num(row.advance_amount),
    advancePaidOn: advance?.advance_paid_on ?? null,
    advanceMethod: advance?.advance_method ?? null,
    advanceReference: advance?.advance_reference ?? null,
    receivedToDate: num(row.amount_received),
    balanceDue: num(row.balance_due),
    coordinatorIds: row.coordinator_ids ?? [],
    coordinatorNames: row.coordinator_names ?? [],
    projectState: projectState(row),
    financing: row.financing_type ?? "self",
    loanBank: row.loan_bank_name,
  };
}

export const reportsRepository = {
  /**
   * Everything the report counts. Sales and projects are read whole (a payment
   * or a commissioning in the window can belong to a sale from any year); the
   * ledger and incentive instalments only for `range` (their own dates); service
   * tickets only once completed, from roughly the start of `range` (a superset —
   * the domain applies the exact IST day).
   */
  async load(range: { from: string; to: string }): Promise<ReportData> {
    const db = await createClient();
    // Visited in the range, or no visit date and last changed around its start
    // or later (a day early covers India being ahead of UTC).
    const visitedInRange = `service_date.gte.${range.from},and(service_date.is.null,updated_at.gte.${addDays(range.from, -1)})`;

    const [saleRows, advanceRows, paymentRows, projectRows, ticketRows, incentiveRows] =
      await Promise.all([
        readAll<SaleRow>("sales", (from, to) =>
          db
            .from("work_orders_list")
            .select(SALE_COLUMNS)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAll<AdvanceRow>("advances", (from, to) =>
          db
            .from("work_orders")
            .select(ADVANCE_COLUMNS)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAll<PaymentRow>("payments", (from, to) =>
          db
            .from("payments")
            .select(PAYMENT_COLUMNS)
            .gte("paid_on", range.from)
            .lte("paid_on", range.to)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAll<ProjectRow>("projects", (from, to) =>
          db
            .from("projects")
            .select(PROJECT_COLUMNS)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAll<TicketRow>("service visits", (from, to) =>
          db
            .from("service_tickets")
            .select(TICKET_COLUMNS)
            .eq("status", "completed")
            .or(visitedInRange)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        readAll<IncentivePaymentRow>("incentive payments", (from, to) =>
          db
            .from("coordinator_incentive_payments")
            .select(INCENTIVE_PAYMENT_COLUMNS)
            .gte("paid_on", range.from)
            .lte("paid_on", range.to)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);

    const advances = new Map(advanceRows.map((a) => [a.id, a]));
    // A row added between two pages can push another into the next page twice.
    const seen = new Set<string>();
    const sales: ReportSale[] = [];
    for (const row of saleRows) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      sales.push(toSale(row, advances.get(row.id)));
    }

    return {
      sales,
      payments: paymentRows.map(
        (p): ReportPayment => ({
          workOrderId: p.work_order_id,
          paidOn: p.paid_on,
          amount: num(p.amount),
          purpose: p.purpose,
          paidByOffice: p.paid_by_office ?? false,
          method: p.method,
          reference: p.reference,
        }),
      ),
      projects: projectRows.map(
        (p): ReportProject => ({
          workOrderId: p.work_order_id,
          isCompleted: p.is_completed,
          completedAt: p.completed_at,
          cancellation: p.cancellation,
          cancelledOn: p.cancelled_on,
        }),
      ),
      tickets: ticketRows.map(
        (t): ReportTicket => ({
          status: t.status,
          serviceDate: t.service_date,
          updatedAt: t.updated_at,
        }),
      ),
      incentivePayments: incentiveRows.map(
        (p): ReportIncentivePayment => ({ amount: num(p.amount), paidOn: p.paid_on }),
      ),
    };
  },
};
