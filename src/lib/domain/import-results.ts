import { toCsv } from "@/lib/csv";
import { formatCurrency } from "@/lib/format";
import { CANCELLATION } from "./cancellation";
import type { CoordinatorMatch } from "./coordinator-match";
import { coordinatorsLabel } from "./coordinators";
import { IMPORT_ERROR_COLUMN, type ImportPlan, type ImportRow } from "./import";
import { ledgerTotals, paymentSummary } from "./payment";
import { completionLabel, stageLabel } from "./plan";

/**
 * Turning an import run into what the admin sees: per-row status and message,
 * the counts, the coordinator matches and warnings, and a CSV of the rows that
 * did not go in so they can be fixed and re-uploaded. Pure — the server action
 * supplies the RPC outcomes.
 *
 * Lives outside the "use server" action module because such a module may only
 * export async functions.
 */

/** `ready` is a checked row that would import; the rest are what a run reports. */
export const IMPORT_ROW_STATUSES = ["ready", "imported", "skipped", "failed"] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export function isImportRowStatus(value: string): value is ImportRowStatus {
  return (IMPORT_ROW_STATUSES as readonly string[]).includes(value);
}

/** The statuses `import_projects` reports for a row. */
export type ImportOutcomeStatus = "imported" | "skipped" | "failed";

export function isOutcomeStatus(value: string): value is ImportOutcomeStatus {
  return value === "imported" || value === "skipped" || value === "failed";
}

/** Check file validates and writes nothing; Import projects writes. */
export type ImportMode = "check" | "import";

/** The counts each mode shows, in order — a check can neither import nor skip. */
export const IMPORT_COUNT_STATUSES: Record<ImportMode, readonly ImportRowStatus[]> = {
  check: ["ready", "failed"],
  import: ["imported", "skipped", "failed"],
};

export interface ImportRowResult {
  /** The line of the sheet the row starts on (the first line is 1; blank lines count). */
  row: number;
  client: string;
  status: ImportRowStatus;
  message: string;
  /** Worth a look, shown under the message; only on rows that are ready or in. */
  warnings: string[];
}

export interface ImportState {
  ran: boolean;
  mode: ImportMode;
  counts: Record<ImportRowStatus, number>;
  results: ImportRowResult[];
  /** The skipped + failed rows as uploaded, plus an `import_error` column. */
  retryCsv: string | null;
  /** Who each coordinator cell entry became; problems first. */
  coordinatorMatches: CoordinatorMatch[];
  /** File-level notes: legal, but probably not what was meant. */
  warnings: string[];
  /** Whether "skip rows whose consumer number exists" was on for the run. */
  skipExisting: boolean;
  error?: string;
}

const NO_COUNTS: Record<ImportRowStatus, number> = {
  ready: 0,
  imported: 0,
  skipped: 0,
  failed: 0,
};

export const IMPORT_INITIAL: ImportState = {
  ran: false,
  mode: "import",
  counts: NO_COUNTS,
  results: [],
  retryCsv: null,
  coordinatorMatches: [],
  warnings: [],
  skipExisting: true,
};

/** A run that stopped before any row was attempted. */
export function importError(error: string, mode: ImportMode = "import"): ImportState {
  return { ...IMPORT_INITIAL, ran: true, mode, error };
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

/** The row as the office thinks of it: where it is, what was sold, who has it. */
function describeRow(
  row: ImportRow,
  names: readonly string[],
  defaulted: boolean,
  checking: boolean,
): string {
  const ledger = ledgerTotals(row.payments);
  const { balanceDue } = paymentSummary({
    total_cost: row.total_cost,
    advance_amount: row.advance_amount,
    payments_total: ledger.contract,
  });
  const stage = stageLabel(row.current_stage, row.plan_type);
  const parts: string[] = [];

  if (!row.is_completed) {
    parts.push(checking ? `At ${stage}` : `Imported at ${stage}`);
  } else if (row.cancellation) {
    // Nothing is collectable on a cancelled sale; the status says why instead.
    parts.push(completionLabel(row.plan_type));
  } else {
    parts.push(
      balanceDue > 0
        ? `${completionLabel(row.plan_type)} · ${formatCurrency(balanceDue)} outstanding`
        : `${completionLabel(row.plan_type)} · paid in full`,
    );
  }
  if (row.plan_type === "custom") parts.push(`Custom plan "${row.plant_capacity}"`);
  if (row.cancellation) parts.push(CANCELLATION[row.cancellation].label);
  const n = row.payments.length;
  if (n) {
    parts.push(`${n} payment${n === 1 ? "" : "s"} ${checking ? "to record" : "recorded"}`);
  }
  parts.push(`${coordinatorsLabel(names)}${defaulted ? " (default coordinator)" : ""}`);
  return parts.join(" · ");
}

/** What an imported row turned into, in the office's terms. */
export function importedMessage(
  row: ImportRow,
  names: readonly string[],
  defaulted: boolean,
): string {
  return describeRow(row, names, defaulted, false);
}

/** What a checked row would become. */
export function readyMessage(
  row: ImportRow,
  names: readonly string[],
  defaulted: boolean,
): string {
  return `Ready · ${describeRow(row, names, defaulted, true)}`;
}

/**
 * Merge validation and RPC outcomes into the results, in sheet order. A valid
 * row with no outcome was never sent (the run stopped early) — `notRunReason`
 * says why.
 */
export function summarizeImport(
  plan: ImportPlan,
  outcomes: ReadonlyMap<number, ImportOutcome>,
  {
    notRunReason,
    error,
    skipExisting = true,
  }: { notRunReason?: string; error?: string; skipExisting?: boolean } = {},
): ImportState {
  const results = plan.rows.map((row): ImportRowResult => {
    const { rowNo, client, parsed } = row;
    const base = { row: rowNo, client, warnings: [] as string[] };
    if (!parsed.ok) return { ...base, status: "failed", message: parsed.error };

    const outcome = outcomes.get(rowNo);
    if (!outcome) {
      return {
        ...base,
        status: "failed",
        message: notRunReason ?? "No result came back for this row — it was not imported",
      };
    }
    const status: ImportOutcomeStatus = isOutcomeStatus(outcome.status)
      ? outcome.status
      : "failed";
    if (status === "imported") {
      return {
        ...base,
        status,
        message: importedMessage(parsed.data, row.coordinators, row.defaulted),
        warnings: row.warnings,
      };
    }
    return {
      ...base,
      status,
      message: outcome.message ?? (status === "skipped" ? "Skipped" : "Not imported"),
    };
  });

  return stateOf("import", plan, results, { error, skipExisting });
}

/**
 * The outcome of Check file: every row validated, nothing written. Valid rows
 * are `ready`; the failed rows' download works exactly as after an import.
 */
export function checkedState(
  plan: ImportPlan,
  { skipExisting = true }: { skipExisting?: boolean } = {},
): ImportState {
  const results = plan.rows.map((row): ImportRowResult => {
    const { rowNo, client, parsed } = row;
    if (!parsed.ok) {
      return { row: rowNo, client, status: "failed", message: parsed.error, warnings: [] };
    }
    return {
      row: rowNo,
      client,
      status: "ready",
      message: readyMessage(parsed.data, row.coordinators, row.defaulted),
      warnings: row.warnings,
    };
  });
  return stateOf("check", plan, results, { skipExisting });
}

function stateOf(
  mode: ImportMode,
  plan: ImportPlan,
  results: ImportRowResult[],
  { error, skipExisting }: { error?: string; skipExisting: boolean },
): ImportState {
  const counts = { ...NO_COUNTS };
  for (const r of results) counts[r.status] += 1;

  return {
    ran: true,
    mode,
    counts,
    results,
    retryCsv: retryCsv(plan, results),
    coordinatorMatches: plan.coordinatorMatches,
    warnings: plan.warnings,
    skipExisting,
    error,
  };
}

/**
 * The rows that did not go in, with their cells exactly as uploaded and the
 * reason in `import_error` — fix, then upload the same file again. Null when
 * every row was imported (or, in a check, is ready).
 */
export function retryCsv(plan: ImportPlan, results: readonly ImportRowResult[]): string | null {
  const reasons = new Map(
    results
      .filter((r) => r.status === "failed" || r.status === "skipped")
      .map((r) => [r.row, r.message]),
  );
  if (reasons.size === 0) return null;

  const columns = plan.headers.filter((h) => h && h !== IMPORT_ERROR_COLUMN);
  const rows = plan.rows
    .filter((r) => reasons.has(r.rowNo))
    .map((r) => [...columns.map((c) => r.cells[c] ?? ""), reasons.get(r.rowNo) ?? ""]);
  return toCsv([[...columns, IMPORT_ERROR_COLUMN], ...rows]);
}
