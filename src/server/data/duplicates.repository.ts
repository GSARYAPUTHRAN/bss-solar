import { createClient } from "@/lib/supabase/server";
import type { CleanupSale } from "@/lib/domain/duplicate-sales";
import type {
  PlanType,
  ProjectCancellation,
  ProjectStage,
  WorkOrderStatus,
} from "@/lib/types";
import { readAllPages, type PageReply } from "./read-all";

/**
 * Reads for the duplicate clean-up page (/work-orders/duplicates). Every sale
 * is read — every status, rejected included — because a copy can be anywhere;
 * the matching is `lib/domain/duplicate-sales.ts`. Pages past PostgREST's
 * 1000-row cap. A failed read throws: an empty list would say "no duplicates".
 *
 * A sale's ledger entries are counted here, row by row, rather than taken from
 * the list view's `payment_count`, which counts contract payments only: KSEB
 * fees, refunds and write-offs go with a deleted sale too, and the keeper
 * ranking and the confirm dialog must count them.
 */

interface SaleRow {
  id: string;
  client_name: string | null;
  order_date: string | null;
  created_at: string | null;
  consumer_number: string | null;
  status: WorkOrderStatus | null;
  cancellation: ProjectCancellation | null;
  coordinator_names: string[] | null;
  total_cost: number | string | null;
  amount_received: number | string | null;
  project_id: string | null;
  current_stage: ProjectStage | null;
  is_completed: boolean | null;
  plan_type: PlanType | null;
}

export const SALE_COLUMNS = [
  "id",
  "client_name",
  "order_date",
  "created_at",
  "consumer_number",
  "status",
  "cancellation",
  "coordinator_names",
  "total_cost",
  "amount_received",
  "project_id",
  "current_stage",
  "is_completed",
  "plan_type",
].join(", ");

interface TicketRow {
  project_id: string | null;
}

interface LedgerRow {
  work_order_id: string | null;
}

/** numeric/bigint columns may arrive as strings; null means 0. */
function num(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<PageReply>,
): Promise<T[]> {
  return readAllPages<T>(
    page,
    (message) => new Error(`Could not read ${what} for the duplicate check: ${message}`),
  );
}

/** How many rows name each key. */
function countBy<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function toSale(
  row: SaleRow,
  tickets: ReadonlyMap<string, number>,
  ledger: ReadonlyMap<string, number>,
): CleanupSale {
  return {
    id: row.id,
    clientName: row.client_name ?? "",
    orderDate: row.order_date ?? "",
    createdAt: row.created_at ?? "",
    consumerNumber: row.consumer_number,
    status: row.status ?? "pending",
    cancellation: row.cancellation,
    coordinatorNames: row.coordinator_names ?? [],
    totalCost: num(row.total_cost),
    amountReceived: num(row.amount_received),
    paymentCount: ledger.get(row.id) ?? 0,
    projectId: row.project_id,
    currentStage: row.current_stage,
    isCompleted: row.is_completed ?? false,
    ticketCount: row.project_id ? (tickets.get(row.project_id) ?? 0) : 0,
    planType: row.plan_type ?? "solar",
  };
}

export const duplicatesRepository = {
  /** Every sale, with its ledger entries and the service tickets on its project counted. */
  async sales(): Promise<CleanupSale[]> {
    const db = await createClient();
    const [saleRows, ticketRows, ledgerRows] = await Promise.all([
      readAll<SaleRow>("sales", (from, to) =>
        db
          .from("work_orders_list")
          .select(SALE_COLUMNS)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      readAll<TicketRow>("service tickets", (from, to) =>
        db
          .from("service_tickets")
          .select("project_id")
          .not("project_id", "is", null)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      // Every purpose: contract payments, KSEB fees, refunds and write-offs.
      readAll<LedgerRow>("ledger entries", (from, to) =>
        db
          .from("payments")
          .select("work_order_id")
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);

    const tickets = countBy(ticketRows, (row) => row.project_id);
    const ledger = countBy(ledgerRows, (row) => row.work_order_id);

    // A row added between two pages can push another into the next page twice.
    const seen = new Set<string>();
    const sales: CleanupSale[] = [];
    for (const row of saleRows) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      sales.push(toSale(row, tickets, ledger));
    }
    return sales;
  },
};
