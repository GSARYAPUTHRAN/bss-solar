import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { describe, it, expect, afterAll } from "vitest";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import {
  serviceClient,
  signedInAs,
  USERS,
  withDb,
  type SeedUser,
} from "./helpers";
import { createFixtures, must } from "./fixtures";

/**
 * The two deprecated payment slots on work_orders (first/second payment) and
 * the payments ledger that supersedes them (migration 20261010120200).
 *
 * CI migrates production before the new build deploys, and the old build keeps
 * writing the slots until then. So the migration copies each slot into the
 * ledger keyed by `legacy_slot` (never by the editable note), and a temporary
 * trigger mirrors every later write to a slot into that slot's ledger row.
 */
const svc = serviceClient();
const fx = createFixtures(svc);

afterAll(() => fx.cleanup());

const MIGRATION = fileURLToPath(
  new URL(
    "../../supabase/migrations/20261010120200_payments_ledger.sql",
    import.meta.url,
  ),
);

/**
 * The migration exactly as shipped, minus its own BEGIN/COMMIT so that a test
 * can run it inside a transaction it then rolls back.
 */
function migrationBody(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const statements = sql.match(/^(begin|commit);\r?$/gm) ?? [];
  expect(statements, "the migration's own transaction lines").toEqual([
    "begin;",
    "commit;",
  ]);
  return sql.replace(/^(begin|commit);\r?$/gm, "");
}

type LedgerRow = {
  id: string;
  legacy_slot: number | null;
  amount: string;
  paid_on: string;
  method: string;
  purpose: string;
  notes: string | null;
};

async function ledgerOf(
  db: pg.Client,
  workOrderId: string,
): Promise<LedgerRow[]> {
  const { rows } = await db.query<LedgerRow>(
    `select id, legacy_slot, amount::text, paid_on::text, method::text, purpose::text, notes
       from public.payments
      where work_order_id = $1
      order by legacy_slot nulls last, amount`,
    [workOrderId],
  );
  return rows;
}

/** Ledger rows through PostgREST, for the tests that write as a signed-in user. */
async function ledger(workOrderId: string) {
  return must(
    await svc
      .from("payments")
      .select("id, legacy_slot, amount, paid_on, method, purpose, notes")
      .eq("work_order_id", workOrderId)
      .order("legacy_slot", { nullsFirst: false })
      .order("amount"),
    "ledger",
  ).map((p) => ({ ...p, amount: Number(p.amount) }));
}

/** A write the old build makes: its work-order form posts the slot columns. */
async function oldBuildWrites(
  user: SeedUser,
  workOrderId: string,
  values: TablesUpdate<"work_orders">,
) {
  const client = await signedInAs(user);
  return client.from("work_orders").update(values).eq("id", workOrderId);
}

describe("the backfill", () => {
  it("copies each slot once, and a re-run never adds a second copy — even after the office edited the note", async () => {
    await withDb(async (db) => {
      await db.query("begin");
      try {
        // A work order as the old build left it: slots filled, nothing in the
        // ledger yet (the mirror is off, as before this migration ran).
        await db.query(
          "alter table public.work_orders disable trigger t_wo_mirror_legacy_payments",
        );
        const {
          rows: [{ id: workOrderId }],
        } = await db.query<{ id: string }>(
          `insert into public.work_orders
             (coordinator_id, client_name, plant_capacity, total_cost, status, order_date,
              first_payment_amount, first_payment_date, second_payment_amount)
           values ($1, 'Backfill fixture', '5kW', 300000, 'approved', '2026-01-05',
                   80000, '2026-01-20', 40000)
           returning id`,
          [USERS.rahul.id],
        );
        // A normal ledger payment on the same order is never a slot.
        await db.query(
          `insert into public.payments (work_order_id, amount, paid_on)
           values ($1, 15000, '2026-02-01')`,
          [workOrderId],
        );

        await db.query(migrationBody());
        const migrated = await ledgerOf(db, workOrderId);
        expect(migrated).toEqual([
          expect.objectContaining({
            legacy_slot: 1,
            amount: "80000.00",
            paid_on: "2026-01-20",
            method: "other",
            purpose: "contract",
            notes: "Migrated: first payment",
          }),
          // No date on the slot: the order date stands in.
          expect.objectContaining({
            legacy_slot: 2,
            amount: "40000.00",
            paid_on: "2026-01-05",
            notes: "Migrated: second payment",
          }),
          expect.objectContaining({ legacy_slot: null, amount: "15000.00" }),
        ]);

        // The office annotates and corrects the migrated payment...
        await db.query(
          `update public.payments set notes = 'Cheque 0045', amount = 85000
            where work_order_id = $1 and legacy_slot = 1`,
          [workOrderId],
        );
        const corrected = await ledgerOf(db, workOrderId);

        // ...and someone re-runs the migration, as DEPLOY.md allows.
        await db.query(migrationBody());
        expect(await ledgerOf(db, workOrderId)).toEqual(corrected);
        expect(corrected[0]).toMatchObject({
          notes: "Cheque 0045",
          amount: "85000.00",
        });
      } finally {
        await db.query("rollback");
      }
    });
  });
});

describe("the temporary mirror of old-build writes", () => {
  it("creates, updates and removes the slot's ledger row as the old build edits it", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { total_cost: 300000, advance_amount: 30000 },
    });
    const normal = await fx.payment(workOrderId, { amount: 50000 });

    expect(
      (
        await oldBuildWrites(USERS.admin, workOrderId, {
          second_payment_amount: 60000,
          second_payment_date: "2026-03-01",
        })
      ).error,
    ).toBeNull();
    const [created] = await ledger(workOrderId);
    expect(created).toMatchObject({
      legacy_slot: 2,
      amount: 60000,
      paid_on: "2026-03-01",
      method: "other",
      purpose: "contract",
      notes: "Migrated: second payment",
    });

    // The new build's balances count it straight away.
    const { data: project } = await svc
      .from("projects_list")
      .select("amount_received, balance_due")
      .eq("id", projectId)
      .single();
    expect(Number(project?.amount_received)).toBe(30000 + 50000 + 60000);
    expect(Number(project?.balance_due)).toBe(300000 - 140000);

    // A correction updates the same row in place.
    expect(
      (
        await oldBuildWrites(USERS.admin, workOrderId, {
          second_payment_amount: 65000,
        })
      ).error,
    ).toBeNull();
    const [updated] = await ledger(workOrderId);
    expect(updated).toMatchObject({
      id: created.id,
      amount: 65000,
      paid_on: "2026-03-01",
    });

    // The old edit form re-sends every column: an unchanged slot is left alone,
    // so an office note on its ledger row survives.
    must(
      await svc
        .from("payments")
        .update({ notes: "Cheque 0045" })
        .eq("id", created.id)
        .select("id"),
      "office note",
    );
    expect(
      (
        await oldBuildWrites(USERS.admin, workOrderId, {
          client_name: "Mirror Fixture (renamed)",
          second_payment_amount: 65000,
          second_payment_date: "2026-03-01",
        })
      ).error,
    ).toBeNull();
    expect((await ledger(workOrderId))[0]).toMatchObject({
      id: created.id,
      amount: 65000,
      notes: "Cheque 0045",
    });

    // Clearing the slot (or zeroing it) removes the row; the normal payment stays.
    expect(
      (
        await oldBuildWrites(USERS.admin, workOrderId, {
          second_payment_amount: null,
        })
      ).error,
    ).toBeNull();
    expect((await ledger(workOrderId)).map((p) => p.id)).toEqual([normal]);

    expect(
      (
        await oldBuildWrites(USERS.admin, workOrderId, {
          first_payment_amount: 20000,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await oldBuildWrites(USERS.admin, workOrderId, {
          first_payment_amount: 0,
        })
      ).error,
    ).toBeNull();
    expect((await ledger(workOrderId)).map((p) => p.id)).toEqual([normal]);
  });

  it("copies the slots of a work order the old build creates", async () => {
    // The old onboarding importer inserts with the service role; the work
    // order's own date stands in for a missing payment date.
    const workOrderId = await fx.workOrder({
      order_date: "2026-04-02",
      first_payment_amount: 70000,
      first_payment_date: "2026-04-10",
      second_payment_amount: 25000,
    });

    expect(await ledger(workOrderId)).toEqual([
      expect.objectContaining({
        legacy_slot: 1,
        amount: 70000,
        paid_on: "2026-04-10",
      }),
      expect.objectContaining({
        legacy_slot: 2,
        amount: 25000,
        paid_on: "2026-04-02",
      }),
    ]);
  });

  it("leaves a work order without slot values, and every normal payment, alone", async () => {
    const workOrderId = await fx.workOrder();
    const payments = [
      await fx.payment(workOrderId, { amount: 10000 }),
      await fx.payment(workOrderId, { amount: 20000 }),
    ];
    must(
      await svc
        .from("work_orders")
        .update({ client_name: "No slots", first_payment_amount: null })
        .eq("id", workOrderId)
        .select("id"),
      "edit",
    );

    const rows = await ledger(workOrderId);
    expect(rows.map((p) => p.id).sort()).toEqual([...payments].sort());
    for (const row of rows) expect(row.legacy_slot).toBeNull();
  });

  it("keeps the slots office-only once the order is approved", async () => {
    const { workOrderId } = await fx.approvedProject();

    const { error } = await oldBuildWrites(USERS.rahul, workOrderId, {
      first_payment_amount: 90000,
    });
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/Only the office can change the amounts/);
    expect(await ledger(workOrderId)).toEqual([]);

    const { data } = await svc
      .from("work_orders")
      .select("first_payment_amount")
      .eq("id", workOrderId)
      .single();
    expect(data?.first_payment_amount).toBeNull();
  });

  it("mirrors a coordinator's slot on their own pending order", async () => {
    const workOrderId = await fx.workOrder({ status: "pending" });

    expect(
      (
        await oldBuildWrites(USERS.rahul, workOrderId, {
          first_payment_amount: 15000,
          first_payment_date: "2026-05-01",
        })
      ).error,
    ).toBeNull();
    expect(await ledger(workOrderId)).toEqual([
      expect.objectContaining({
        legacy_slot: 1,
        amount: 15000,
        paid_on: "2026-05-01",
      }),
    ]);
  });
});

describe("the legacy_slot key", () => {
  it("holds one row per slot of a work order, and only slots 1 and 2", async () => {
    const workOrderId = await fx.workOrder();
    await fx.payment(workOrderId, { legacy_slot: 1 });

    const twice = await svc
      .from("payments")
      .insert({
        work_order_id: workOrderId,
        amount: 1,
        paid_on: "2026-01-01",
        legacy_slot: 1,
      });
    expect(twice.error?.code).toBe("23505");

    const third = await svc
      .from("payments")
      .insert({
        work_order_id: workOrderId,
        amount: 1,
        paid_on: "2026-01-01",
        legacy_slot: 3,
      });
    expect(third.error?.code).toBe("23514");
    expect(third.error?.message).toMatch(/payments_legacy_slot_valid/);
  });
});
