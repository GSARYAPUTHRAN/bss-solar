import { createClient } from "@/lib/supabase/server";
import type { DirectoryAccount } from "@/lib/domain/coordinator-match";
import type { ImportRow } from "@/lib/domain/import";
import type { ExistingSale } from "@/lib/domain/import-duplicates";
import type { ImportOutcome } from "@/lib/domain/import-results";

/**
 * Data access for the bulk import: the team's accounts (to resolve who each
 * coordinator cell names), the sales already in the system (to catch a sheet
 * uploaded twice) and the `import_projects` RPC.
 * All run with the signed-in admin's own session — the database checks
 * `is_admin()` itself and records that admin on every payment, cancellation
 * and incentive — so no service-role key is involved.
 *
 * Imported by path, not through `index.ts`: only the onboarding action uses it.
 */

/** PostgREST returns at most this many rows per request (`max_rows`, supabase/config.toml). */
const ROWS_PER_PAGE = 1000;

const EXISTING_SALE_COLUMNS = "id, client_name, order_date, created_at, coordinator_names, total_cost";

interface ExistingSaleRow {
  id: string | null;
  client_name: string | null;
  order_date: string | null;
  created_at: string | null;
  coordinator_names: string[] | null;
  total_cost: number | string | null;
}

/** A view row as the duplicate check reads it; null for one missing its identity. */
function toExistingSale(row: ExistingSaleRow): ExistingSale | null {
  if (!row.id || !row.client_name || !row.order_date) return null;
  const total = Number(row.total_cost ?? 0);
  return {
    id: row.id,
    clientName: row.client_name,
    orderDate: row.order_date,
    createdAt: row.created_at ?? "",
    coordinatorNames: (row.coordinator_names ?? []).filter(Boolean),
    totalCost: Number.isFinite(total) ? total : 0,
  };
}

/** What the RPC call as a whole answered, apart from per-row outcomes. */
export interface RpcFailure {
  /** Postgres / PostgREST code; absent when the request itself did not complete. */
  code?: string;
  message: string;
}

export const importsRepository = {
  /**
   * Every account with its login e-mail (`account_directory()`, office only).
   * Engineers are included so a sheet naming one can be told why it is refused.
   */
  async directory(): Promise<{ accounts: DirectoryAccount[]; error: string | null }> {
    const supabase = await createClient();
    const reply = await supabase.rpc("account_directory").then(
      (r) => r,
      () => null,
    );
    if (!reply || reply.error) {
      return { accounts: [], error: reply?.error.message ?? "The request did not complete" };
    }
    return {
      accounts: (reply.data ?? []).map((a) => ({
        id: a.id,
        fullName: a.full_name,
        email: a.email,
        role: a.role,
      })),
      error: null,
    };
  },

  /**
   * Every work order in the system (`work_orders_list`) for `findDuplicates`,
   * whatever its order date: a row with none is matched by name against all
   * of them. Rejected ones are left out — a sale the office turned down is
   * not "already in", and skipping a row because of it would drop the real
   * sale. Read 1,000 rows at a time by id, so a page boundary never repeats
   * one sale or skips another. A failed read is an error, never an empty
   * list: "no duplicates" must not be a guess.
   */
  async existingSales(): Promise<{ sales: ExistingSale[]; error: string | null }> {
    const supabase = await createClient();
    const sales: ExistingSale[] = [];
    for (let from = 0; ; from += ROWS_PER_PAGE) {
      const reply = await supabase
        .from("work_orders_list")
        .select(EXISTING_SALE_COLUMNS)
        .neq("status", "rejected")
        .order("id", { ascending: true })
        .range(from, from + ROWS_PER_PAGE - 1)
        .then(
          (r) => r,
          () => null,
        );
      if (!reply || reply.error) {
        return { sales: [], error: reply?.error.message ?? "The request did not complete" };
      }
      const rows = (reply.data ?? []) as ExistingSaleRow[];
      for (const row of rows) {
        const sale = toExistingSale(row);
        if (sale) sales.push(sale);
      }
      if (rows.length < ROWS_PER_PAGE) break;
    }
    return { sales, error: null };
  },

  /**
   * One `import_projects` call: a batch of validated rows. The RPC is atomic
   * per row and reports each row's outcome; a refused call rolls the whole
   * batch back (one statement). `failure.code` is absent when the request
   * itself failed — it may or may not have reached the database.
   */
  async run(
    batch: ImportRow[],
    defaultCoordinatorId: string,
    skipExisting: boolean,
  ): Promise<{ outcomes: ImportOutcome[]; failure: RpcFailure | null }> {
    const supabase = await createClient();
    const reply = await supabase
      .rpc("import_projects", {
        p_rows: batch,
        p_default_coordinator: defaultCoordinatorId,
        p_skip_existing: skipExisting,
      })
      // A thrown network failure, as opposed to an error reply.
      .then(
        (r) => r,
        () => null,
      );
    if (!reply) {
      return { outcomes: [], failure: { message: "The request did not complete" } };
    }
    if (reply.error) {
      return {
        outcomes: [],
        failure: { code: reply.error.code, message: reply.error.message },
      };
    }
    return { outcomes: reply.data ?? [], failure: null };
  },
};
