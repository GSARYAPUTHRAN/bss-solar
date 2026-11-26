import { createClient } from "@/lib/supabase/server";
import type { DeletedRecord } from "@/lib/domain/deletion-log";
import { readAllPages } from "./read-all";

/**
 * The deletion log (`deleted_records`): one row per deleted record, written by
 * a trigger with a snapshot of the row (see lib/domain/deletion-log.ts). Only
 * deleters can read it (RLS `can_delete()`); nobody writes it from the app
 * except `deleteTeamMember`, which logs the account it removes through the
 * service role.
 */

interface LogRow {
  id: number | string;
  table_name: string;
  record_id: string;
  snapshot: unknown;
  deleted_by_name: string | null;
  deleted_at: string;
  tx: number | string;
}

const LOG_COLUMNS = "id, table_name, record_id, snapshot, deleted_by_name, deleted_at, tx";

/** Most deletes (transactions) one read names; `recent_deletion_txs` caps it too. */
export const MAX_RECENT_DELETES = 200;

function snapshotOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function failed(message: string): Error {
  return new Error(`Could not read the deletion log: ${message}`);
}

function toRecord(row: LogRow): DeletedRecord {
  return {
    id: Number(row.id),
    tableName: row.table_name,
    recordId: row.record_id,
    snapshot: snapshotOf(row.snapshot),
    deletedByName: row.deleted_by_name,
    deletedAt: row.deleted_at,
    tx: Number(row.tx),
  };
}

/** An instant's time for ordering; an unreadable one is the oldest. */
function timeOf(instant: string): number {
  const t = Date.parse(instant);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Newest first, the id breaking ties (rows of one delete share `deleted_at`). */
function newestFirst(a: DeletedRecord, b: DeletedRecord): number {
  const ta = timeOf(a.deletedAt);
  const tb = timeOf(b.deletedAt);
  if (ta !== tb) return ta > tb ? -1 : 1;
  return b.id - a.id;
}

export const deletionLogRepository = {
  /**
   * Every logged row of the latest `groups` deletes (transactions), newest
   * first. Whole deletes, never a fixed number of rows: one bulk clean-up can
   * log hundreds of rows (each sale with its project, ledger and incentives),
   * and a cut through it would show part of that delete and hide every older
   * one. So the deletes are chosen first (`recent_deletion_txs`), then all of
   * their rows read, past PostgREST's 1000-row cap. Throws when the log cannot
   * be read: an empty list would say nothing was deleted.
   */
  async recent(groups = 50): Promise<DeletedRecord[]> {
    const limit = Math.min(Math.max(Math.floor(groups) || 1, 1), MAX_RECENT_DELETES);
    const db = await createClient();
    const { data, error } = await db.rpc("recent_deletion_txs", { p_limit: limit });
    if (error) throw failed(error.message);
    // bigint, but a transaction id is far below 2^53.
    const txs = ((data ?? []) as unknown as (number | string)[]).map(Number);
    if (txs.length === 0) return [];

    const rows = await readAllPages<LogRow>(
      (from, to) =>
        db
          .from("deleted_records")
          .select(LOG_COLUMNS)
          .in("tx", txs)
          .order("id", { ascending: true })
          .range(from, to),
      failed,
    );
    return rows.map(toRecord).sort(newestFirst);
  },
};
