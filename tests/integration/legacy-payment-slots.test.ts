import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { describe, it, expect, afterAll } from "vitest";
import { serviceClient, USERS, withDb } from "./helpers";
import { createFixtures } from "./fixtures";

/**
 * The two fixed payment slots work_orders once had (first/second payment).
 * Migration 20261010120200 copied them into the payments ledger, each copy
 * marked by `legacy_slot`; migration 20261010130000 then dropped them, with
 * the temporary trigger that mirrored the old build's writes.
 */
const svc = serviceClient();
const fx = createFixtures(svc);

afterAll(() => fx.cleanup());

const MIGRATION = fileURLToPath(
  new URL(
    "../../supabase/migrations/20261010130000_drop_legacy_payment_slots.sql",
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

const SLOT_COLUMNS = [
  "first_payment_amount",
  "first_payment_date",
  "second_payment_amount",
  "second_payment_date",
];

/** Puts the slots back as the database had them before the drop. */
const RESTORE_SLOTS = `
  alter table public.work_orders
    add column first_payment_date date,
    add column first_payment_amount numeric(12,2),
    add column second_payment_date date,
    add column second_payment_amount numeric(12,2)`;

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack(fn: (db: pg.Client) => Promise<void>): Promise<void> {
  await withDb(async (db) => {
    await db.query("begin");
    try {
      await fn(db);
    } finally {
      await db.query("rollback");
    }
  });
}

async function slotColumns(db: pg.Client): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'work_orders'
        and column_name = any ($1)
      order by column_name`,
    [SLOT_COLUMNS],
  );
  return rows.map((r) => r.column_name);
}

async function workOrderWithSlots(
  db: pg.Client,
  first: number | null,
  second: number | null,
): Promise<string> {
  const {
    rows: [{ id }],
  } = await db.query<{ id: string }>(
    `insert into public.work_orders
       (coordinator_id, client_name, plant_capacity, total_cost, status,
        first_payment_amount, second_payment_amount)
     values ($1, 'Slot fixture', '5kW', 300000, 'approved', $2, $3)
     returning id`,
    [USERS.rahul.id, first, second],
  );
  return id;
}

/** The ledger row the backfill (or the mirror) made for a slot. */
async function carriedOver(db: pg.Client, workOrderId: string, slot: 1 | 2) {
  await db.query(
    `insert into public.payments (work_order_id, amount, paid_on, method, notes, legacy_slot)
     values ($1, 1000, '2026-01-20', 'other', 'Migrated', $2)`,
    [workOrderId, slot],
  );
}

describe("the migrated database", () => {
  it("has neither the slots nor their mirror", async () => {
    await withDb(async (db) => {
      expect(await slotColumns(db)).toEqual([]);
      const { rows } = await db.query(
        `select proname from pg_proc where proname = 'mirror_legacy_payment_slots'
         union all
         select tgname from pg_trigger where tgname = 't_wo_mirror_legacy_payments'`,
      );
      expect(rows).toEqual([]);
    });
  });
});

describe("dropping the slots", () => {
  it("drops them once every filled slot is in the ledger, and a re-run changes nothing", async () => {
    await rolledBack(async (db) => {
      await db.query(RESTORE_SLOTS);
      const workOrderId = await workOrderWithSlots(db, 80000, 40000);
      await carriedOver(db, workOrderId, 1);
      await carriedOver(db, workOrderId, 2);
      // An empty or zero slot was never copied, and holds nothing to lose.
      await workOrderWithSlots(db, 0, null);

      await db.query(migrationBody());
      expect(await slotColumns(db)).toEqual([]);
      const { rows } = await db.query(
        `select legacy_slot from public.payments
          where work_order_id = $1 order by legacy_slot`,
        [workOrderId],
      );
      expect(rows).toEqual([{ legacy_slot: 1 }, { legacy_slot: 2 }]);

      await db.query(migrationBody());
      expect(await slotColumns(db)).toEqual([]);
    });
  });

  it("refuses while a filled slot is missing from the ledger, naming it", async () => {
    await rolledBack(async (db) => {
      await db.query(RESTORE_SLOTS);
      const complete = await workOrderWithSlots(db, 80000, null);
      await carriedOver(db, complete, 1);
      const incomplete = await workOrderWithSlots(db, 50000, 25000);
      await carriedOver(db, incomplete, 1);

      await db.query("savepoint drop_slots");
      await expect(db.query(migrationBody())).rejects.toThrow(
        new RegExp(`not in the payments ledger: ${incomplete} \\(slot 2\\)$`),
      );
      await db.query("rollback to savepoint drop_slots");
      expect(await slotColumns(db)).toEqual(SLOT_COLUMNS);
    });
  });
});

describe("the legacy_slot key", () => {
  it("holds one row per slot of a work order, and only slots 1 and 2", async () => {
    const workOrderId = await fx.workOrder();
    await fx.payment(workOrderId, { legacy_slot: 1 });

    const twice = await svc.from("payments").insert({
      work_order_id: workOrderId,
      amount: 1,
      paid_on: "2026-01-01",
      legacy_slot: 1,
    });
    expect(twice.error?.code).toBe("23505");

    const third = await svc.from("payments").insert({
      work_order_id: workOrderId,
      amount: 1,
      paid_on: "2026-01-01",
      legacy_slot: 3,
    });
    expect(third.error?.code).toBe("23514");
    expect(third.error?.message).toMatch(/payments_legacy_slot_valid/);
  });
});
