import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, signedInAs, USERS } from "./helpers";
import { createFixtures, must } from "./fixtures";
import {
  isPaymentPending,
  ledgerTotals,
  paymentSummary,
  type LedgerEntry,
} from "@/lib/domain/payment";

/**
 * The payment maths exists twice — once in SQL (the ledger aggregates in
 * `work_orders_list` / `projects_list`, and `dashboard_metrics`) and once in
 * the app (`lib/domain/payment.ts`) so pages can render without a round trip.
 * These tests pin the two to each other: a figure shown on a page must equal
 * the figure Postgres filters and counts on.
 *
 * The app side is computed from the RAW ledger rows (`ledgerTotals`), never
 * from the view's own `payments_total`, so a wrong aggregate cannot vouch for
 * itself.
 */
const svc = serviceClient();
const fx = createFixtures(svc);

async function ledgerByWorkOrder(): Promise<Map<string, LedgerEntry[]>> {
  const rows = must(
    await svc
      .from("payments")
      .select("work_order_id, amount, paid_on, purpose, created_at"),
    "payments",
  );
  const byWorkOrder = new Map<string, LedgerEntry[]>();
  for (const { work_order_id, ...entry } of rows) {
    byWorkOrder.set(work_order_id, [
      ...(byWorkOrder.get(work_order_id) ?? []),
      entry,
    ]);
  }
  return byWorkOrder;
}

beforeAll(async () => {
  // Edge cases the seed does not cover: KSEB fees alongside contract stages,
  // and a customer who overpaid (negative balance) after commissioning.
  const kseb = await fx.approvedProject({
    workOrder: {
      client_name: "Ledger Parity KSEB",
      total_cost: 100000,
      advance_amount: 10000,
    },
  });
  await fx.payment(kseb.workOrderId, { amount: 40000, paid_on: "2026-02-01" });
  await fx.payment(kseb.workOrderId, {
    amount: 5720,
    paid_on: "2026-01-20",
    purpose: "kseb_fees",
  });

  const overpaid = await fx.approvedProject({
    workOrder: {
      client_name: "Ledger Parity Overpaid",
      total_cost: 100000,
      advance_amount: 0,
    },
    project: {
      is_completed: true,
      current_stage: "plant_commissioning",
      completed_at: "2026-03-01T06:30:00Z",
    },
  });
  await fx.payment(overpaid.workOrderId, {
    amount: 60000,
    paid_on: "2026-02-01",
  });
  await fx.payment(overpaid.workOrderId, {
    amount: 50000,
    paid_on: "2026-02-20",
  });

  // Commissioned but refunded, with money still uncollected: not payment
  // pending, though its balance is untouched.
  const refunded = await fx.approvedProject({
    workOrder: {
      client_name: "Ledger Parity Refunded",
      total_cost: 200000,
      advance_amount: 50000,
    },
    project: {
      is_completed: true,
      current_stage: "plant_commissioning",
      completed_at: "2026-03-01T06:30:00Z",
      cancellation: "refunded",
    },
  });
  await fx.payment(refunded.workOrderId, {
    amount: 30000,
    paid_on: "2026-02-10",
  });
});

afterAll(() => fx.cleanup());

describe("derived payment columns", () => {
  it("work_orders_list agrees with ledgerTotals() + paymentSummary(), row for row", async () => {
    const ledger = await ledgerByWorkOrder();
    const rows = must(
      await svc
        .from("work_orders_list")
        .select(
          "id, total_cost, advance_amount, payments_total, payment_count, last_payment_on, amount_received, balance_due",
        ),
      "work_orders_list",
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const totals = ledgerTotals(ledger.get(row.id!) ?? []);
      const app = paymentSummary({ ...row, payments_total: totals.contract });
      expect(Number(row.payments_total)).toBe(totals.contract);
      expect(row.payment_count).toBe(totals.count);
      expect(row.last_payment_on).toBe(totals.lastPaidOn);
      expect(Number(row.amount_received)).toBe(app.received);
      expect(Number(row.balance_due)).toBe(app.balanceDue);
    }
  });

  it("projects_list agrees too, and payment_pending agrees with isPaymentPending()", async () => {
    const ledger = await ledgerByWorkOrder();
    const rows = must(
      await svc
        .from("projects_list")
        .select(
          "id, work_order_id, is_completed, cancellation, total_cost, advance_amount, payments_total, payment_count, last_payment_on, amount_received, balance_due, payment_pending",
        ),
      "projects_list",
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const totals = ledgerTotals(ledger.get(row.work_order_id!) ?? []);
      const source = { ...row, payments_total: totals.contract };
      const app = paymentSummary(source);
      expect(Number(row.payments_total)).toBe(totals.contract);
      expect(row.payment_count).toBe(totals.count);
      expect(row.last_payment_on).toBe(totals.lastPaidOn);
      expect(Number(row.amount_received)).toBe(app.received);
      expect(Number(row.balance_due)).toBe(app.balanceDue);
      expect(row.payment_pending).toBe(isPaymentPending(row, source));
    }
  });

  it("does not call a cancelled or refunded project payment pending, whatever its balance", async () => {
    const row = must(
      await svc
        .from("projects_list")
        .select("is_completed, cancellation, balance_due, payment_pending")
        .eq("client_name", "Ledger Parity Refunded")
        .single(),
      "refunded project",
    );
    expect(row).toEqual({
      is_completed: true,
      cancellation: "refunded",
      balance_due: 120000,
      payment_pending: false,
    });
    // The app's rule says the same, and a live project in the same state is pending.
    expect(
      isPaymentPending(
        { is_completed: true, cancellation: "refunded" },
        { total_cost: 200000, advance_amount: 50000, payments_total: 30000 },
      ),
    ).toBe(false);
    expect(
      isPaymentPending(
        { is_completed: true, cancellation: null },
        { total_cost: 200000, advance_amount: 50000, payments_total: 30000 },
      ),
    ).toBe(true);
  });

  it("never counts KSEB fees collected through BSS towards the contract", async () => {
    const row = must(
      await svc
        .from("work_orders_list")
        .select(
          "payments_total, payment_count, last_payment_on, amount_received, balance_due",
        )
        .eq("client_name", "Ledger Parity KSEB")
        .single(),
      "KSEB fixture",
    );
    expect(Number(row.payments_total)).toBe(40000);
    expect(row.payment_count).toBe(1);
    // The KSEB entry (2026-01-20) is neither counted nor the "last payment".
    expect(row.last_payment_on).toBe("2026-02-01");
    expect(Number(row.amount_received)).toBe(50000); // 10,000 advance + 40,000
    expect(Number(row.balance_due)).toBe(50000);
  });

  it("an overpaid commissioned project is settled, not pending", async () => {
    const row = must(
      await svc
        .from("projects_list")
        .select("balance_due, payment_pending, payment_count")
        .eq("client_name", "Ledger Parity Overpaid")
        .single(),
      "overpaid fixture",
    );
    expect(Number(row.balance_due)).toBe(-10000);
    expect(row.payment_count).toBe(2);
    expect(row.payment_pending).toBe(false);
  });

  it("the seed holds a project paid in four stages after the advance", async () => {
    const latha = must(
      await svc
        .from("projects_list")
        .select("payment_count, amount_received, balance_due, payment_pending")
        .eq("client_name", "Latha Krishnan")
        .single(),
      "Latha Krishnan",
    );
    expect(latha.payment_count).toBe(4);
    expect(Number(latha.amount_received)).toBe(260000);
    expect(Number(latha.balance_due)).toBe(0);
    expect(latha.payment_pending).toBe(false);
  });

  it("the seed contains both a commissioned-unpaid and a commissioned-paid project", async () => {
    const rows = must(
      await svc
        .from("projects_list")
        .select("client_name, payment_pending")
        .eq("is_completed", true),
      "commissioned projects",
    );
    expect(rows.some((r) => r.payment_pending === true)).toBe(true);
    expect(rows.some((r) => r.payment_pending === false)).toBe(true);
  });

  it("filters commissioned-but-unpaid projects server-side (the list filter)", async () => {
    const { data, count, error } = await svc
      .from("projects_list")
      .select("id, is_completed, balance_due", { count: "exact" })
      .eq("payment_pending", true);
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(row.is_completed).toBe(true);
      expect(Number(row.balance_due)).toBeGreaterThan(0);
    }
  });

  it("a coordinator's list sums the same ledger the office sees", async () => {
    // The views are SECURITY INVOKER, so the payments join runs under the
    // coordinator's RLS — it must still see every payment on their own orders.
    const rahul = await signedInAs(USERS.rahul);
    const mine = must(
      await rahul
        .from("work_orders_list")
        .select("id, payments_total, amount_received, balance_due"),
      "rahul's work orders",
    );
    expect(mine.length).toBeGreaterThan(0);

    const office = must(
      await svc
        .from("work_orders_list")
        .select("id, payments_total, amount_received, balance_due")
        .in(
          "id",
          mine.map((r) => r.id!),
        ),
      "office view of rahul's work orders",
    );
    const officeById = new Map(office.map((r) => [r.id, r]));
    for (const row of mine) expect(officeById.get(row.id)).toEqual(row);
  });
});

describe("dashboard payment KPIs", () => {
  it("commissioned_unpaid / outstanding_amount match the view", async () => {
    const admin = await signedInAs(USERS.admin);
    const m = must(
      await admin.rpc("dashboard_metrics").single(),
      "dashboard_metrics",
    );

    const pending = must(
      await svc
        .from("projects_list")
        .select("balance_due")
        .eq("payment_pending", true),
      "pending projects",
    );
    const expectedTotal = pending.reduce(
      (sum, r) => sum + Number(r.balance_due ?? 0),
      0,
    );

    expect(Number(m.commissioned_unpaid)).toBe(pending.length);
    expect(Number(m.outstanding_amount)).toBe(expectedTotal);
    expect(Number(m.commissioned_unpaid)).toBeGreaterThan(0);
  });

  it("respects RLS — a coordinator only sees their own outstanding balance", async () => {
    // dashboard_metrics is SECURITY INVOKER, so the aggregate is scoped by RLS.
    const rahul = await signedInAs(USERS.rahul);
    const mine = must(
      await rahul.rpc("dashboard_metrics").single(),
      "dashboard_metrics",
    );

    const rows = must(
      await rahul
        .from("projects_list")
        .select("balance_due")
        .eq("payment_pending", true),
      "rahul's pending projects",
    );
    expect(Number(mine.commissioned_unpaid)).toBe(rows.length);
    expect(Number(mine.outstanding_amount)).toBe(
      rows.reduce((sum, r) => sum + Number(r.balance_due ?? 0), 0),
    );
  });
});
