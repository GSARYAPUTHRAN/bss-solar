import { STAGE_LABELS } from "@/lib/constants";
import { toCsv } from "@/lib/csv";
import { formatCurrency } from "@/lib/format";
import { IMPORT_ERROR_COLUMN, type ImportPlan, type ImportRow } from "./import";
import { ledgerTotals, paymentSummary } from "./payment";

/**
 * Turning an import run into what the admin sees: per-row status and message,
 * the counts, and a CSV of the rows that did not go in so they can be fixed
 * and re-uploaded. Pure — the server action supplies the RPC outcomes.
 *
 * Lives outside the "use server" action module because such a module may only
 * export async functions.
 */

export const IMPORT_ROW_STATUSES = ["imported", "skipped", "failed"] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export function isImportRowStatus(value: string): value is ImportRowStatus {
  return (IMPORT_ROW_STATUSES as readonly string[]).includes(value);
}

export interface ImportRowResult {
  /** Line in the sheet (the header is line 1). */
  row: number;
  client: string;
  status: ImportRowStatus;
  message: string;
}

export interface ImportState {
  ran: boolean;
  counts: Record<ImportRowStatus, number>;
  results: ImportRowResult[];
  /** The skipped + failed rows as uploaded, plus an `import_error` column. */
  retryCsv: string | null;
  error?: string;
}

const NO_COUNTS: Record<ImportRowStatus, number> = { imported: 0, skipped: 0, failed: 0 };

export const IMPORT_INITIAL: ImportState = {
  ran: false,
  counts: NO_COUNTS,
  results: [],
  retryCsv: null,
};

/** A run that stopped before any row was attempted. */
export function importError(error: string): ImportState {
  return { ...IMPORT_INITIAL, ran: true, error };
}

/** One row's outcome as `import_projects` reports it. */
export interface ImportOutcome {
  row_no: number;
  status: string;
  message: string | null;
}

/** Split into consecutive batches of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** What an imported row turned into, in the office's terms. */
export function importedMessage(row: ImportRow): string {
  const ledger = ledgerTotals(row.payments);
  const { balanceDue } = paymentSummary({
    total_cost: row.total_cost,
    advance_amount: row.advance_amount,
    payments_total: ledger.contract,
  });
  const n = row.payments.length;
  const payments = n ? ` · ${n} payment${n === 1 ? "" : "s"} recorded` : "";

  if (!row.is_completed) return `Imported at ${STAGE_LABELS[row.current_stage]}${payments}`;
  return balanceDue > 0
    ? `Commissioned · ${formatCurrency(balanceDue)} outstanding${payments}`
    : `Commissioned · paid in full${payments}`;
}

/**
 * Merge validation and RPC outcomes into the results, in sheet order. A valid
 * row with no outcome was never sent (the run stopped early) — `notRunReason`
 * says why.
 */
export function summarizeImport(
  plan: ImportPlan,
  outcomes: ReadonlyMap<number, ImportOutcome>,
  { notRunReason, error }: { notRunReason?: string; error?: string } = {},
): ImportState {
  const results = plan.rows.map(({ rowNo, client, parsed }): ImportRowResult => {
    const base = { row: rowNo, client };
    if (!parsed.ok) return { ...base, status: "failed", message: parsed.error };

    const outcome = outcomes.get(rowNo);
    if (!outcome) {
      return {
        ...base,
        status: "failed",
        message: notRunReason ?? "No result came back for this row — it was not imported",
      };
    }
    const status = isImportRowStatus(outcome.status) ? outcome.status : "failed";
    if (status === "imported") return { ...base, status, message: importedMessage(parsed.data) };
    return {
      ...base,
      status,
      message: outcome.message ?? (status === "skipped" ? "Skipped" : "Not imported"),
    };
  });

  const counts = { ...NO_COUNTS };
  for (const r of results) counts[r.status] += 1;

  return {
    ran: true,
    counts,
    results,
    retryCsv: retryCsv(plan, results),
    error,
  };
}

/**
 * The rows that did not go in, with their cells exactly as uploaded and the
 * reason in `import_error` — fix, then upload the same file again. Null when
 * every row was imported.
 */
export function retryCsv(plan: ImportPlan, results: readonly ImportRowResult[]): string | null {
  const reasons = new Map(
    results.filter((r) => r.status !== "imported").map((r) => [r.row, r.message]),
  );
  if (reasons.size === 0) return null;

  const columns = plan.headers.filter((h) => h && h !== IMPORT_ERROR_COLUMN);
  const rows = plan.rows
    .filter((r) => reasons.has(r.rowNo))
    .map((r) => [...columns.map((c) => r.cells[c] ?? ""), reasons.get(r.rowNo) ?? ""]);
  return toCsv([[...columns, IMPORT_ERROR_COLUMN], ...rows]);
}
