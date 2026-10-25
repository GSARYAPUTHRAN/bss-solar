"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { todayISO } from "@/lib/format";
import { CoordinatorDirectory } from "@/lib/domain/coordinator-match";
import { planImport, type ImportRow } from "@/lib/domain/import";
import {
  checkedState,
  chunk,
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
 * accounts); `intent=check` stops there and writes nothing, `intent=import`
 * sends the valid rows and reports each row's outcome.
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

  if (mode === "check") return checkedState(plan.data, { skipExisting });

  const valid = plan.data.rows.flatMap((r) => (r.parsed.ok ? [r.parsed.data] : []));
  // Every row carries its resolved coordinator_ids; the RPC's default only
  // serves the legacy coordinator_email shape, so with none chosen it is the
  // admin running the import.
  const { outcomes, stopped } = await sendRows(valid, defaultCoordinator.id ?? me.id, skipExisting);
  const state = summarizeImport(plan.data, outcomes, {
    skipExisting,
    ...(stopped ? stoppedMessages(stopped, outcomes.size > 0) : {}),
  });

  if (state.counts.imported > 0) {
    revalidatePath("/projects");
    revalidatePath("/work-orders");
    revalidatePath("/");
  }
  return state;
}
