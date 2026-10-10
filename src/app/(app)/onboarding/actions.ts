"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/format";
import { planImport, type ImportRow } from "@/lib/domain/import";
import {
  chunk,
  importError,
  summarizeImport,
  type ImportOutcome,
  type ImportState,
} from "@/lib/domain/import-results";

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

interface SendResult {
  outcomes: Map<number, ImportOutcome>;
  /** Set when a batch did not complete; later batches are not sent. */
  stopped?: { atRow: number; reason: string };
}

/** What the office should read for an error from the RPC call as a whole. */
function describeRpcError(error: { code?: string; message: string }): string {
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
  if (rows.length === 0) return { outcomes };

  const supabase = await createClient();
  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const atRow = batch[0].row_no;
    const reply = await supabase
      .rpc("import_projects", {
        p_rows: batch,
        p_default_coordinator: defaultCoordinator,
        p_skip_existing: skipExisting,
      })
      // A thrown network failure, as opposed to an error reply.
      .then((r) => r, () => null);
    if (!reply) return { outcomes, stopped: { atRow, reason: CONNECTION_LOST } };
    if (reply.error) {
      return { outcomes, stopped: { atRow, reason: describeRpcError(reply.error) } };
    }
    for (const outcome of reply.data ?? []) outcomes.set(outcome.row_no, outcome);
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
 * Bulk-import existing projects from CSV. Validates every row first (all
 * problems per row), imports the valid ones, and reports each row's outcome.
 *
 * Deliberately emits no notifications: an onboarding load of hundreds of
 * historical projects is not news to anyone, and would bury real alerts.
 */
export async function importProjects(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await requireAdmin();

  const defaultCoordinator = String(formData.get("default_coordinator_id") ?? "").trim();
  if (!UUID.test(defaultCoordinator)) {
    return importError("Select a default coordinator.");
  }
  // The form always posts "true" or "false"; anything else keeps the safe default.
  const skipExisting = formData.get("skip_existing") !== "false";

  const plan = planImport(String(formData.get("csv") ?? ""), todayISO());
  if (!plan.ok) return importError(plan.error);

  const valid = plan.data.rows.flatMap((r) => (r.parsed.ok ? [r.parsed.data] : []));
  const { outcomes, stopped } = await sendRows(valid, defaultCoordinator, skipExisting);
  const state = summarizeImport(
    plan.data,
    outcomes,
    stopped ? stoppedMessages(stopped, outcomes.size > 0) : {},
  );

  if (state.counts.imported > 0) {
    revalidatePath("/projects");
    revalidatePath("/work-orders");
    revalidatePath("/");
  }
  return state;
}
