import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, signedInAs, USERS } from "./helpers";
import { createFixtures, must } from "./fixtures";

/**
 * Who may touch the payments ledger, enforced by RLS (migration
 * 20261010120200): the office records and corrects payments; only the
 * SuperAdmin deletes one (every destructive action is theirs); a coordinator
 * reads the payments on their own work orders and nothing else; a service
 * engineer sees no money at all.
 */
const svc = serviceClient();
const fx = createFixtures(svc);

/** Rahul's work order the RLS tests write against. */
let workOrderId: string;

beforeAll(async () => {
  ({ workOrderId } = await fx.approvedProject({
    workOrder: {
      client_name: "Ledger RLS Fixture",
      total_cost: 200000,
      advance_amount: 20000,
    },
  }));
});

afterAll(() => fx.cleanup());

async function paymentExists(id: string): Promise<boolean> {
  const rows = must(
    await svc.from("payments").select("id").eq("id", id),
    "payment lookup",
  );
  return rows.length === 1;
}

describe("the office", () => {
  it("records a payment against any work order", async () => {
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("payments")
      .insert({
        work_order_id: workOrderId,
        amount: 50000,
        paid_on: "2026-02-10",
        method: "upi",
        reference: "UPI 0001",
        recorded_by: USERS.admin.id,
      })
      .select("id, purpose, method, recorded_by")
      .single();
    expect(error).toBeNull();
    // Contract is the default purpose — a KSEB fee must be said explicitly.
    expect(data).toMatchObject({
      purpose: "contract",
      method: "upi",
      recorded_by: USERS.admin.id,
    });
  });

  it("corrects a payment, and updated_at moves with it", async () => {
    const id = await fx.payment(workOrderId, { amount: 12000 });
    const before = must(
      await svc.from("payments").select("updated_at").eq("id", id).single(),
      "payment before",
    );

    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("payments")
      .update({ amount: 15000, notes: "Corrected from the bank statement" })
      .eq("id", id)
      .select("amount, updated_at");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Number(data![0].amount)).toBe(15000);
    expect(Date.parse(data![0].updated_at)).toBeGreaterThan(
      Date.parse(before.updated_at),
    );
  });

  it("cannot delete a payment as a plain admin (RLS removes nothing)", async () => {
    const id = await fx.payment(workOrderId);
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("payments")
      .delete()
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(await paymentExists(id)).toBe(true);
  });

  it("deletes a payment as the SuperAdmin", async () => {
    const id = await fx.payment(workOrderId);
    const su = await signedInAs(USERS.superadmin);
    const { data, error } = await su
      .from("payments")
      .delete()
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(await paymentExists(id)).toBe(false);
  });
});

describe("a coordinator", () => {
  it("reads the payments on their own work orders, and only those", async () => {
    const id = await fx.payment(workOrderId, { amount: 7000 });
    const rahul = await signedInAs(USERS.rahul);
    const seen = must(
      await rahul.from("payments").select("id, work_order_id"),
      "rahul's payments",
    );
    expect(seen.map((p) => p.id)).toContain(id);

    const own = must(
      await svc
        .from("work_orders")
        .select("id")
        .eq("coordinator_id", USERS.rahul.id),
      "rahul's work orders",
    );
    const ownIds = new Set(own.map((w) => w.id));
    for (const p of seen) expect(ownIds.has(p.work_order_id)).toBe(true);

    const priya = await signedInAs(USERS.priya);
    const theirs = must(
      await priya
        .from("payments")
        .select("id")
        .eq("work_order_id", workOrderId),
      "priya's view of rahul's payments",
    );
    expect(theirs).toHaveLength(0);
  });

  it("cannot record a payment, even on their own work order", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { error } = await rahul.from("payments").insert({
      work_order_id: workOrderId,
      amount: 1,
      paid_on: "2026-02-10",
      notes: "coordinator attempt",
    });
    expect(error?.code).toBe("42501");

    const rows = must(
      await svc
        .from("payments")
        .select("id")
        .eq("notes", "coordinator attempt"),
      "coordinator attempt lookup",
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot edit or delete a payment on their own work order", async () => {
    const id = await fx.payment(workOrderId, { amount: 9000 });
    const rahul = await signedInAs(USERS.rahul);

    const edited = await rahul
      .from("payments")
      .update({ amount: 1 })
      .eq("id", id)
      .select("id");
    expect(edited.error).toBeNull();
    expect(edited.data ?? []).toHaveLength(0);

    const removed = await rahul
      .from("payments")
      .delete()
      .eq("id", id)
      .select("id");
    expect(removed.data ?? []).toHaveLength(0);

    const row = must(
      await svc.from("payments").select("amount").eq("id", id).single(),
      "payment after",
    );
    expect(Number(row.amount)).toBe(9000);
  });
});

describe("a service engineer", () => {
  it("sees no payments at all", async () => {
    const anil = await signedInAs(USERS.anil);
    const { count, error } = await anil
      .from("payments")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
  });
});

describe("ledger integrity", () => {
  it.each([0, -500])("rejects an amount of %d", async (amount) => {
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("payments")
      .insert({ work_order_id: workOrderId, amount, paid_on: "2026-02-10" });
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/payments_amount_positive/);
  });

  it("requires the date the money was received", async () => {
    const { error } = await svc
      .from("payments")
      // @ts-expect-error — paid_on is NOT NULL; the generated Insert type agrees.
      .insert({ work_order_id: workOrderId, amount: 100, paid_on: null });
    expect(error?.code).toBe("23502");
  });

  it("is removed with its work order", async () => {
    const { workOrderId: doomed } = await fx.approvedProject({
      workOrder: { client_name: "Ledger Cascade Fixture" },
    });
    const ids = [
      await fx.payment(doomed, { amount: 1000 }),
      await fx.payment(doomed, { amount: 2000, purpose: "kseb_fees" }),
    ];

    const { error } = await svc.from("work_orders").delete().eq("id", doomed);
    expect(error).toBeNull();

    const left = must(
      await svc.from("payments").select("id").in("id", ids),
      "cascade lookup",
    );
    expect(left).toHaveLength(0);
  });
});
