import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { describe, it, expect, afterAll } from "vitest";
import { rolledBack, serviceClient, USERS } from "./helpers";
import { createFixtures, uniqueTag } from "./fixtures";

/**
 * The three 2026-11-04 migrations are idempotent and keep their promises when
 * replayed over a database that already has them (CI re-applies migrations; a
 * hand-run must be safe too). Each is replayed twice inside a transaction that
 * is rolled back, so the stored database is never touched.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

afterAll(() => fx.cleanup());

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../supabase/migrations/", import.meta.url),
);

function migrationFile(prefix: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith(prefix));
  expect(files, `exactly one migration ${prefix}…`).toHaveLength(1);
  return files[0];
}

/**
 * The migration as shipped, minus its own BEGIN/COMMIT so that a test can run it
 * inside a transaction it then rolls back. Line endings are normalised first (a
 * Windows checkout has CRLF).
 */
function body(prefix: string): string {
  const sql = readFileSync(
    `${MIGRATIONS_DIR}${migrationFile(prefix)}`,
    "utf8",
  ).replace(/\r\n/g, "\n");
  const lines = sql.match(/^(begin|commit);$/gm) ?? [];
  // The enum migration has no transaction of its own (see its header).
  if (prefix === "20261104120000") {
    expect(lines).toEqual([]);
    return sql;
  }
  expect(lines, "the migration's own transaction lines").toEqual([
    "begin;",
    "commit;",
  ]);
  return sql.replace(/^(begin|commit);$/gm, "");
}

/** Everything a replay must leave exactly as it was. */
async function fingerprint(db: pg.Client): Promise<Record<string, string>> {
  const one = async (sql: string) =>
    (await db.query<{ v: string }>(sql)).rows[0].v;
  return {
    instalments: await one(
      `select coalesce(md5(string_agg(t::text, '|' order by t.id)), '') as v
         from public.coordinator_incentive_payments t`,
    ),
    incentives: await one(
      `select md5(string_agg(t::text, '|' order by t.work_order_id, t.coordinator_id)) as v
         from public.coordinator_incentives t`,
    ),
    payments: await one(
      `select md5(string_agg(t::text, '|' order by t.id)) as v from public.payments t`,
    ),
    columns: await one(
      `select md5(string_agg(c.table_name || '.' || c.column_name || ':' || c.data_type,
                             ',' order by c.table_name, c.ordinal_position)) as v
         from information_schema.columns c where c.table_schema = 'public'`,
    ),
    views: await one(
      `select md5(string_agg(pg_get_viewdef(c.oid), '|' order by c.relname)) as v
         from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'`,
    ),
    functions: await one(
      `select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname, p.oid)) as v
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`,
    ),
    triggers: await one(
      `select md5(string_agg(pg_get_triggerdef(t.oid), '|' order by t.tgname)) as v
         from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text like 'public.%'`,
    ),
    policies: await one(
      `select md5(string_agg(p.tablename || '.' || p.policyname || ':' || coalesce(p.qual, '') ||
                             coalesce(p.with_check, ''), '|' order by p.tablename, p.policyname)) as v
         from pg_policies p where p.schemaname = 'public'`,
    ),
    constraints: await one(
      `select md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid),
                             '|' order by conrelid::regclass::text, conname)) as v
         from pg_constraint where connamespace = 'public'::regnamespace`,
    ),
  };
}

describe.each([
  ["20261104120000", "the purposes migration"],
  ["20261104120100", "the ledger-adjustments and instalments migration"],
  ["20261104120200", "the import v4 migration"],
])("re-running %s", (prefix, what) => {
  it(`${what} changes nothing, twice over`, async () => {
    await fx.approvedProject({
      workOrder: { client_name: `Replay ${prefix} ${RUN}` },
    });
    await rolledBack(async (db) => {
      const before = await fingerprint(db);
      await db.query(body(prefix));
      expect(await fingerprint(db), "after one replay").toEqual(before);
      await db.query(body(prefix));
      expect(await fingerprint(db), "after two replays").toEqual(before);
    });
  });
});

describe("the instalments migration's backfill", () => {
  it("turns an incentive already marked paid into one instalment, once, and skips the rest", async () => {
    const paid = await fx.approvedProject({
      workOrder: { client_name: `Backfill Paid ${RUN}` },
    });
    const zero = await fx.approvedProject({
      workOrder: { client_name: `Backfill Zero ${RUN}` },
    });
    const partly = await fx.approvedProject({
      workOrder: { client_name: `Backfill Part ${RUN}` },
    });
    await fx.incentive(partly.workOrderId, USERS.rahul.id, { amount: 5000 });
    await fx.incentivePayment(partly.workOrderId, USERS.rahul.id, {
      amount: 1000,
      paid_on: "2026-09-01",
    });

    await rolledBack(async (db) => {
      // The database as it was before the migration: a paid date with no
      // instalment behind it (triggers off so nothing translates or derives it).
      const triggers = [
        ["coordinator_incentives", "t_ci_guard_paid"],
        ["coordinator_incentives", "t_ci_settle_paid"],
      ];
      for (const [table, trigger] of triggers) {
        await db.query(
          `alter table public.${table} disable trigger ${trigger}`,
        );
      }
      await db.query(
        `update public.coordinator_incentives set amount = 7000, paid_on = '2026-10-01'
          where work_order_id = $1 and coordinator_id = $2`,
        [paid.workOrderId, USERS.rahul.id],
      );
      // Who last set it (t_ci_touch stamps the session's user, none here).
      await db.query(
        `update public.coordinator_incentives set updated_by = $3
          where work_order_id = $1 and coordinator_id = $2`,
        [paid.workOrderId, USERS.rahul.id, USERS.admin.id],
      );
      await db.query(
        `update public.coordinator_incentives set amount = 0, paid_on = '2026-10-01'
          where work_order_id = $1 and coordinator_id = $2`,
        [zero.workOrderId, USERS.rahul.id],
      );
      for (const [table, trigger] of triggers) {
        await db.query(`alter table public.${table} enable trigger ${trigger}`);
      }

      const instalmentsOf = async (workOrderId: string) =>
        (
          await db.query(
            `select amount::float8 as amount, paid_on::text as paid_on, note, recorded_by
               from public.coordinator_incentive_payments
              where work_order_id = $1 order by paid_on, amount`,
            [workOrderId],
          )
        ).rows;
      expect(await instalmentsOf(paid.workOrderId)).toEqual([]);

      const migration = body("20261104120100");
      for (const run of ["first", "second"]) {
        await db.query(migration);
        // The whole amount, on the date it was marked paid, attributed to whoever
        // last set it; never a second copy.
        expect(
          await instalmentsOf(paid.workOrderId),
          `${run} run: paid`,
        ).toEqual([
          {
            amount: 7000,
            paid_on: "2026-10-01",
            note: "Migrated",
            recorded_by: USERS.admin.id,
          },
        ]);
        // A zero incentive has nothing to pay.
        expect(
          await instalmentsOf(zero.workOrderId),
          `${run} run: zero`,
        ).toEqual([]);
        // An incentive that already has instalments is left alone.
        expect(
          (await instalmentsOf(partly.workOrderId)).map((r) => r.amount),
          `${run} run: partly paid`,
        ).toEqual([1000]);
      }
      const row = (
        await db.query(
          `select amount::float8 as amount, paid_on::text as paid_on
             from public.coordinator_incentives where work_order_id = $1 and coordinator_id = $2`,
          [paid.workOrderId, USERS.rahul.id],
        )
      ).rows[0];
      expect(row).toEqual({ amount: 7000, paid_on: "2026-10-01" });
    });
  });
});
