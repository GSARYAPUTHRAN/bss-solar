import { describe, it, expect } from "vitest";
import { collectedPct, isPaymentPending, paymentSummary } from "./payment";

describe("paymentSummary", () => {
  it("sums the advance and both instalments", () => {
    const s = paymentSummary({
      total_cost: 320000,
      advance_amount: 40000,
      first_payment_amount: 100000,
      second_payment_amount: 80000,
    });
    expect(s.received).toBe(220000);
    expect(s.balanceDue).toBe(100000);
    expect(s.isSettled).toBe(false);
  });

  it("treats missing instalments as zero, not as paid", () => {
    const s = paymentSummary({ total_cost: 200000, advance_amount: 50000 });
    expect(s.received).toBe(50000);
    expect(s.balanceDue).toBe(150000);
  });

  it("settles on an exact payment", () => {
    const s = paymentSummary({
      total_cost: 260000,
      advance_amount: 30000,
      first_payment_amount: 130000,
      second_payment_amount: 100000,
    });
    expect(s.balanceDue).toBe(0);
    expect(s.isSettled).toBe(true);
  });

  it("settles on an overpayment (negative balance)", () => {
    const s = paymentSummary({ total_cost: 100000, advance_amount: 120000 });
    expect(s.balanceDue).toBe(-20000);
    expect(s.isSettled).toBe(true);
  });

  it("accepts decimal strings, as PostgREST may return numerics", () => {
    const s = paymentSummary({
      total_cost: "320000.00",
      advance_amount: "40000.00",
      first_payment_amount: "100000.00",
    });
    expect(s.received).toBe(140000);
    expect(s.balanceDue).toBe(180000);
  });

  it("coerces null/undefined/garbage to zero", () => {
    const s = paymentSummary({
      total_cost: null,
      advance_amount: undefined,
      first_payment_amount: "abc",
    });
    expect(s.received).toBe(0);
    expect(s.balanceDue).toBe(0);
    expect(s.isSettled).toBe(true);
  });
});

describe("isPaymentPending", () => {
  const partPaid = { total_cost: 320000, advance_amount: 140000 };

  it("flags a commissioned project with a balance", () => {
    expect(isPaymentPending({ is_completed: true }, partPaid)).toBe(true);
  });

  it("does not flag an in-progress project with a balance", () => {
    expect(isPaymentPending({ is_completed: false }, partPaid)).toBe(false);
  });

  it("does not flag a commissioned project that is settled", () => {
    expect(
      isPaymentPending(
        { is_completed: true },
        { total_cost: 260000, advance_amount: 260000 },
      ),
    ).toBe(false);
  });

  it("treats a null completion flag as not commissioned", () => {
    expect(isPaymentPending({ is_completed: null }, partPaid)).toBe(false);
  });
});

describe("collectedPct", () => {
  it("reports the share collected", () => {
    expect(collectedPct({ total_cost: 200000, advance_amount: 50000 })).toBe(25);
  });
  it("caps at 100 when overpaid", () => {
    expect(collectedPct({ total_cost: 100, advance_amount: 500 })).toBe(100);
  });
  it("treats a zero-value order as fully collected", () => {
    expect(collectedPct({ total_cost: 0 })).toBe(100);
  });
});
