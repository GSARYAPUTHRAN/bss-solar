"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import { CoordinatorDirectory } from "@/lib/domain/coordinator-match";
import { planImport, type ImportRow } from "@/lib/domain/import";
import {
  duplicateChoiceOf,
  findDuplicates,
  repeatOfSkippedMessage,
  repeatsOfSkipped,
  undatedRows,
} from "@/lib/domain/import-duplicates";
import {
  checkedState,
  chunk,
  duplicateChoiceState,
  importError,
  summarizeImport,
  type ImportMode,
  type ImportOutcome,
  type ImportState,
} from "@/lib/domain/import-results";
import { importsRepository, type RpcFailure } from "@/server/data/imports.repository";

/**
 * Rows per `import_projects` call. Each row is a handful of statements, so a
 * batch stays well inside the statement timeout while 1,000 rows still take
 * only five round trips.
 */
const CHUNK_SIZE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The request may have reached the database before the connection failed, so
// the batch's fate is unknown — say so rather than invite a duplicate upload.
const CONNECTION_LOST =
  "The connection to the database failed, so whether these rows went in is unknown. Check the projects list before uploading them again.";

const TEAM_UNREADABLE = "Could not read the team's accounts — please try again.";

const SALES_UNREADABLE =
  "Could not check which of these sales are already in the system — please try again.";

/**
 * Which button was pressed. The form posts it explicitly (a hand-built
 * FormData has no submitter), and anything else — missing included — is NOT
 * an import: a request that does not say what it wants never writes.
 */
function modeOf(intent: FormDataEntryValue | null): ImportMode | null {
  return intent === "check" || intent === "import" ? intent : null;
}

/**
 * The default coordinator for blank cells. "none" (the form's first option) or
 * nothing is no default; otherwise it must be an account id. Whether that
 * account may own a sale is `planImport`'s to say, against the directory.
 */
function defaultCoordinatorOf(
  value: FormDataEntryValue | null,
): { ok: true; id: string | null } | { ok: false } {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "" || raw === "none") return { ok: true, id: null };
  return UUID.test(raw) ? { ok: true, id: raw.toLowerCase() } : { ok: false };
}

interface SendResult {
  outcomes: Map<number, ImportOutcome>;
  /** Set when a batch did not complete; later batches are not sent. */
  stopped?: { atRow: number; reason: string };
}

/** What the office should read for an error from the RPC call as a whole. */
function describeRpcError(error: RpcFailure): string {
  switch (error.code) {
    case undefined:
    case "":
      return CONNECTION_LOST;
    case "42501":
      return "Only office staff can import projects.";
    case "22023":
      // Raised by import_projects itself and worded for people.
      return `${error.message}.`;
    case "57014":
      return "The database took too long. Upload the remaining rows in a smaller file.";
    default:
      return `The database could not run the import (${error.message}).`;
  }
}

/**
 * Send validated rows in batches with the admin's own session: the RPC checks
 * `is_admin()` itself and records the admin as each payment's recorder, so no
 * service-role key is involved. A refused batch is rolled back whole (one
 * statement); batches run in order so a consumer number repeated in the file
 * is skipped the second time.
 */
async function sendRows(
  rows: readonly ImportRow[],
  defaultCoordinator: string,
  skipExisting: boolean,
): Promise<SendResult> {
  const outcomes = new Map<number, ImportOutcome>();
  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const atRow = batch[0].row_no;
    const reply = await importsRepository.run(batch, defaultCoordinator, skipExisting);
    if (reply.failure) {
      return { outcomes, stopped: { atRow, reason: describeRpcError(reply.failure) } };
    }
    for (const outcome of reply.outcomes) outcomes.set(outcome.row_no, outcome);
  }
  return { outcomes };
}

/** Messages for a run that stopped part-way. */
function stoppedMessages(
  stopped: NonNullable<SendResult["stopped"]>,
  anyProcessed: boolean,
): { notRunReason: string; error: string } {
  return {
    notRunReason: `Not imported — the import stopped before this row. ${stopped.reason}`,
    error: anyProcessed
      ? `The import stopped at row ${stopped.atRow}. ${stopped.reason} Earlier rows were processed; download the rows that did not go in to retry them.`
      : `Nothing was imported. ${stopped.reason}`,
  };
}

/**
 * Check or bulk-import existing projects from CSV. Both validate every row
 * first (all problems per row, coordinators resolved against the team's
 * accounts) and look up the valid rows that match a sale already in the system
 * (same order date, same customer; by name alone for a row with no order date
 * — `findDuplicates`); `intent=check` stops there and writes nothing,
 * `intent=import` sends the valid rows and reports each row's outcome.
 *
 * Rows already in the system are never written by accident: an import that
 * has them writes NOTHING unless the form posts what to do with them —
 * `duplicates=skip` (they are not sent, nor — skipping by consumer number —
 * the later rows repeating their number) or `duplicates=include` (everything
 * is, as before). Without either it returns the choice for the form's dialog.
 * A file with no such rows imports exactly as it always did.
 *
 * Deliberately emits no notifications: an onboarding load of hundreds of
 * historical projects is not news to anyone, and would bury real alerts.
 */
export async function importProjects(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const me = await requireAdmin();

  const mode = modeOf(formData.get("intent"));
  if (!mode) return importError("Choose Check file or Import projects.");

  const defaultCoordinator = defaultCoordinatorOf(formData.get("default_coordinator_id"));
  if (!defaultCoordinator.ok) return importError("Select a default coordinator.", mode);
  // The form always posts "true" or "false"; anything else keeps the safe default.
  const skipExisting = formData.get("skip_existing") !== "false";

  const team = await importsRepository.directory();
  if (team.error) return importError(TEAM_UNREADABLE, mode);

  const plan = planImport(String(formData.get("csv") ?? ""), {
    today: todayISO(),
    directory: new CoordinatorDirectory(team.accounts),
    defaultCoordinatorId: defaultCoordinator.id,
    skipExisting,
  });
  if (!plan.ok) return importError(plan.error, mode);

  const valid = plan.data.rows.flatMap((r) => (r.parsed.ok ? [r.parsed.data] : []));
  // Only meaningful to an import; a check ignores it.
  const choice = mode === "import" ? duplicateChoiceOf(formData.get("duplicates")) : null;
  const existing =
    valid.length > 0 ? await importsRepository.existingSales() : { sales: [], error: null };
  // Unknown is not "none". Only "import them all anyway" does not need to know.
  if (existing.error && choice !== "include") return importError(SALES_UNREADABLE, mode);
  const duplicates = findDuplicates(valid, existing.sales, undatedRows(plan.data));

  if (mode === "check") return checkedState(plan.data, { skipExisting, duplicates });
  if (duplicates.size > 0 && !choice) {
    return duplicateChoiceState(plan.data, { skipExisting, duplicates });
  }

  // A skipped row must not let in a later one sharing its consumer number,
  // which the RPC would have skipped as a repeat (Check file said so).
  const repeats =
    choice === "skip" && skipExisting
      ? repeatsOfSkipped(valid, duplicates)
      : new Map<number, ImportRow>();
  const toSend =
    choice === "skip"
      ? valid.filter((r) => !duplicates.has(r.row_no) && !repeats.has(r.row_no))
      : valid;
  // Every row carries its resolved coordinator_ids; the RPC's default only
  // serves the legacy coordinator_email shape, so with none chosen it is the
  // admin running the import.
  const { outcomes, stopped } = await sendRows(toSend, defaultCoordinator.id ?? me.id, skipExisting);
  // The rows held back are reported as the RPC reports its own skips.
  const reported = new Map(outcomes);
  for (const row of valid) {
    const first = repeats.get(row.row_no);
    if (first) {
      reported.set(row.row_no, {
        row_no: row.row_no,
        status: "skipped",
        message: repeatOfSkippedMessage(row, first),
      });
    }
  }
  const state = summarizeImport(plan.data, reported, {
    skipExisting,
    ...(choice && duplicates.size > 0 ? { duplicates: { matches: duplicates, choice } } : {}),
    ...(stopped ? stoppedMessages(stopped, outcomes.size > 0) : {}),
  });

  if (state.counts.imported > 0) {
    revalidatePath("/projects");
    revalidatePath("/work-orders");
    revalidatePath("/");
  }
  return state;
}
