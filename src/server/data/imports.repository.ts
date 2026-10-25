import { createClient } from "@/lib/supabase/server";
import type { DirectoryAccount } from "@/lib/domain/coordinator-match";
import type { ImportRow } from "@/lib/domain/import";
import type { ImportOutcome } from "@/lib/domain/import-results";

/**
 * Data access for the bulk import: the team's accounts (to resolve who each
 * coordinator cell names) and the `import_projects` RPC. Both run with the
 * signed-in admin's own session — the database checks `is_admin()` itself and
 * records that admin on every payment, cancellation and incentive — so no
 * service-role key is involved.
 *
 * Imported by path, not through `index.ts`: only the onboarding action uses it.
 */

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
