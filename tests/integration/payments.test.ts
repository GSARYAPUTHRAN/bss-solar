import { describe, it, expect } from "vitest";
import { clientAs, serviceClient, USERS } from "./helpers";
import { isPaymentPending, paymentSummary } from "@/lib/domain/payment";

/**
 * The payment maths exists twice — once in SQL (`wo_amount_received`, the derived
 * view columns, `dashboard_metrics`) and once in the app
 * (`lib/domain/payment.ts`) so pages can render without a round trip. These
 * tests pin the two to each other: a figure shown on a page must equal the figure
 * Postgres filters and counts on.
 */
const svc = serviceClient();

describe("derived payment columns", () => {
  it("work_orders_list agrees with paymentSummary(), row for row", async () => {
    const { data, error } = await svc
      .from("work_orders_list")
      .select(
        "id, total_cost, advance_amount, first_payment_amount, second_payment_amount, amount_received, balance_due",
      );
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);

    for (const row of data ?? []) {
      const app = paymentSummary(row);
      expect(Number(row.amount_received)).toBe(app.received);
      expect(Number(row.balance_due)).toBe(app.balanceDue);
    }
  });

  it("projects_list.payment_pending agrees with isPaymentPending()", async () => {
    const { data, error } = await svc
      .from("projects_list")
      .select(
        "id, is_completed, total_cost, advance_amount, first_payment_amount, second_payment_amount, amount_received, balance_due, payment_pending",
      );
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);

    for (const row of data ?? []) {
      expect(Number(row.amount_received)).toBe(paymentSummary(row).received);
      expect(Number(row.balance_due)).toBe(paymentSummary(row).balanceDue);
      expect(row.payment_pending).toBe(isPaymentPending(row, row));
    }
  });

  it("the seed contains both a commissioned-unpaid and a commissioned-paid project", async () => {
    const { data } = await svc
      .from("projects_list")
      .select("client_name, payment_pending")
      .eq("is_completed", true);
    const rows = data ?? [];
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
});

describe("dashboard payment KPIs", () => {
  it("commissioned_unpaid / outstanding_amount match the view", async () => {
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    const { data, error } = await admin.rpc("dashboard_metrics").single();
    expect(error).toBeNull();
    const m = data as {
      commissioned_unpaid: number;
      outstanding_amount: number;
    };

    const { data: pending } = await svc
      .from("projects_list")
      .select("balance_due")
      .eq("payment_pending", true);
    const rows = pending ?? [];
    const expectedTotal = rows.reduce(
      (sum, r) => sum + Number(r.balance_due ?? 0),
      0,
    );

    expect(Number(m.commissioned_unpaid)).toBe(rows.length);
    expect(Number(m.outstanding_amount)).toBe(expectedTotal);
    expect(Number(m.commissioned_unpaid)).toBeGreaterThan(0);
  });

  it("respects RLS — a coordinator only sees their own outstanding balance", async () => {
    // dashboard_metrics is SECURITY INVOKER, so the aggregate is scoped by RLS.
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);
    const { data } = await rahul.rpc("dashboard_metrics").single();
    const mine = data as {
      commissioned_unpaid: number;
      outstanding_amount: number;
    };

    const { data: rows } = await rahul
      .from("projects_list")
      .select("balance_due")
      .eq("payment_pending", true);
    expect(Number(mine.commissioned_unpaid)).toBe((rows ?? []).length);
    expect(Number(mine.outstanding_amount)).toBe(
      (rows ?? []).reduce((sum, r) => sum + Number(r.balance_due ?? 0), 0),
    );
  });
});
