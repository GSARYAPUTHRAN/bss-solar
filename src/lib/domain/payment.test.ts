import { describe, it, expect } from "vitest";
import {
  FINANCING_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PURPOSE_LABELS,
  amount,
  canEditContractTerms,
  collectedPct,
  isFinancingType,
  isPaymentMethod,
  collectibleBalance,
  isPaymentPending,
  isPaymentPurpose,
  ledgerTotals,
  paymentSummary,
  withStages,
  type LedgerEntry,
} from "./payment";

describe("amount", () => {
  it("passes numbers through", () => {
    expect(amount(1500.5)).toBe(1500.5);
    expect(amount(0)).toBe(0);
  });

  it("parses PostgREST numeric strings", () => {
    expect(amount("320000.00")).toBe(320000);
    expect(amount("0.10")).toBe(0.1);
  });

  it.each([[null], [undefined], [""], ["abc"], ["1,000"], ["Infinity"], [Number.NaN]])(
    "coerces %j to zero",
    (value) => {
      expect(amount(value)).toBe(0);
    },
  );
});

describe("paymentSummary", () => {
  it("adds the advance and the ledger", () => {
    expect(
      paymentSummary({ total_cost: 320000, advance_amount: 40000, payments_total: 180000 }),
    ).toEqual({
      totalCost: 320000,
      advance: 40000,
      ledger: 180000,
      received: 220000,
      balanceDue: 100000,
      isSettled: false,
    });
  });

  it("treats a missing ledger as nothing collected yet, not as paid", () => {
    const s = paymentSummary({ total_cost: 200000, advance_amount: 50000 });
    expect(s.ledger).toBe(0);
    expect(s.received).toBe(50000);
    expect(s.balanceDue).toBe(150000);
    expect(s.isSettled).toBe(false);
  });

  it("settles on an exact payment", () => {
    const s = paymentSummary({ total_cost: 260000, advance_amount: 30000, payments_total: 230000 });
    expect(s.balanceDue).toBe(0);
    expect(s.isSettled).toBe(true);
  });

  it("settles on an overpayment (negative balance)", () => {
    const s = paymentSummary({ total_cost: 100000, advance_amount: 20000, payments_total: 100000 });
    expect(s.balanceDue).toBe(-20000);
    expect(s.isSettled).toBe(true);
  });

  it("accepts decimal strings, as PostgREST returns numerics", () => {
    const s = paymentSummary({
      total_cost: "320000.00",
      advance_amount: "40000.00",
      payments_total: "100000.50",
    });
    expect(s.received).toBe(140000.5);
    expect(s.balanceDue).toBe(179999.5);
  });

  it("does not leave floating-point dust on paise", () => {
    const s = paymentSummary({ total_cost: 0.3, advance_amount: 0.1, payments_total: 0.2 });
    expect(s.received).toBe(0.3);
    expect(s.balanceDue).toBe(0);
    expect(s.isSettled).toBe(true);
  });

  it("is not settled by a one-paisa shortfall", () => {
    const s = paymentSummary({ total_cost: 100000, advance_amount: 50000, payments_total: 49999.99 });
    expect(s.balanceDue).toBe(0.01);
    expect(s.isSettled).toBe(false);
  });

  it("coerces null/undefined/garbage to zero", () => {
    const s = paymentSummary({ total_cost: null, advance_amount: undefined, payments_total: "abc" });
    expect(s).toEqual({
      totalCost: 0,
      advance: 0,
      ledger: 0,
      received: 0,
      balanceDue: 0,
      isSettled: true,
    });
  });

  it("accepts an empty source", () => {
    expect(paymentSummary({}).isSettled).toBe(true);
  });
});

describe("isPaymentPending", () => {
  const partPaid = { total_cost: 320000, advance_amount: 40000, payments_total: 100000 };

  it("flags a commissioned project with a balance", () => {
    expect(isPaymentPending({ is_completed: true }, partPaid)).toBe(true);
  });

  it("does not flag an in-progress project with a balance", () => {
    expect(isPaymentPending({ is_completed: false }, partPaid)).toBe(false);
  });

  it("does not flag a commissioned project once the ledger settles it", () => {
    expect(
      isPaymentPending(
        { is_completed: true },
        { total_cost: 260000, advance_amount: 60000, payments_total: 200000 },
      ),
    ).toBe(false);
  });

  it("does not flag an overpaid project", () => {
    expect(
      isPaymentPending({ is_completed: true }, { total_cost: 100, advance_amount: 150 }),
    ).toBe(false);
  });

  it("treats a null/absent completion flag as not commissioned", () => {
    expect(isPaymentPending({ is_completed: null }, partPaid)).toBe(false);
    expect(isPaymentPending({}, partPaid)).toBe(false);
  });

  it("reads PostgREST strings", () => {
    expect(
      isPaymentPending(
        { is_completed: true },
        { total_cost: "1000.00", advance_amount: "500.00", payments_total: "499.99" },
      ),
    ).toBe(true);
  });

  it.each(["cancelled", "refunded"] as const)(
    "is never pending on a %s project — its balance is no longer receivable",
    (cancellation) => {
      expect(isPaymentPending({ is_completed: true, cancellation }, partPaid)).toBe(false);
      expect(isPaymentPending({ is_completed: false, cancellation }, partPaid)).toBe(false);
    },
  );

  it("is unchanged for a live project, whether the field is null or absent", () => {
    expect(isPaymentPending({ is_completed: true, cancellation: null }, partPaid)).toBe(true);
    expect(isPaymentPending({ is_completed: true }, partPaid)).toBe(true);
  });
});

describe("collectibleBalance", () => {
  const summary = paymentSummary({ total_cost: 320000, advance_amount: 40000, payments_total: 100000 });

  it("is the balance due while the project is live", () => {
    expect(collectibleBalance(summary)).toBe(180000);
    expect(collectibleBalance(summary, null)).toBe(180000);
    expect(collectibleBalance(summary, undefined)).toBe(180000);
  });

  it.each(["cancelled", "refunded"] as const)("is nothing once the project is %s", (cancellation) => {
    expect(collectibleBalance(summary, cancellation)).toBe(0);
  });

  it("leaves an overpayment on a live project as the (negative) balance", () => {
    const overpaid = paymentSummary({ total_cost: 100, advance_amount: 150 });
    expect(collectibleBalance(overpaid)).toBe(-50);
    expect(collectibleBalance(overpaid, "refunded")).toBe(0);
  });
});

describe("collectedPct", () => {
  it("reports the share collected, advance + ledger", () => {
    expect(
      collectedPct({ total_cost: 200000, advance_amount: 50000, payments_total: 50000 }),
    ).toBe(50);
  });

  it("caps at 100 when overpaid", () => {
    expect(collectedPct({ total_cost: 100, advance_amount: 500 })).toBe(100);
  });

  it("floors at 0 when the received total is negative (bad data)", () => {
    expect(collectedPct({ total_cost: 100, advance_amount: -50 })).toBe(0);
  });

  it("treats a zero-value or negative-value order as fully collected", () => {
    expect(collectedPct({ total_cost: 0 })).toBe(100);
    expect(collectedPct({ total_cost: -10 })).toBe(100);
    expect(collectedPct({})).toBe(100);
  });

  it("returns an integer", () => {
    expect(collectedPct({ total_cost: 3, advance_amount: 1 })).toBe(33);
  });

  // Math.round reports 100% while money is still due (199,500 of
  // 200,000 → 99.75 → 100), so a progress bar reads "100% collected" next to
  // "₹500 due" — exactly the commissioned-but-unpaid case this release tracks.
  // Fix: only a settled order is 100%, e.g.
  //   isSettled ? 100 : Math.min(99, Math.max(0, Math.floor(pct)))
  it("never reports 100% while a balance is due", () => {
    expect(collectedPct({ total_cost: 200000, advance_amount: 199500 })).toBeLessThan(100);
  });

  // In binary floating point 57000 / 100000 * 100 is 56.99999999999999, so a
  // plain floor under-reported ordinary amounts by a whole point.
  it.each([
    [57000, 100000, 57],
    [29000, 100000, 29],
    [58000, 100000, 58],
    [174000, 300000, 58],
    [199500, 200000, 99],
  ])("reports %d of %d as %d%%", (received, total, pct) => {
    expect(collectedPct({ total_cost: total, advance_amount: received })).toBe(pct);
    // The same whether the money came as the advance or through the ledger.
    expect(
      collectedPct({ total_cost: total, advance_amount: 0, payments_total: received }),
    ).toBe(pct);
  });

  it("is exact with paise and PostgREST decimal strings", () => {
    expect(
      collectedPct({ total_cost: "1000.00", advance_amount: "0.10", payments_total: "569.90" }),
    ).toBe(57);
  });
});

describe("canEditContractTerms", () => {
  it("lets the coordinator correct the money only while the order is pending", () => {
    expect(canEditContractTerms("coordinator", "pending")).toBe(true);
    expect(canEditContractTerms("coordinator", "approved")).toBe(false);
    expect(canEditContractTerms("coordinator", "rejected")).toBe(false);
  });

  it.each(["admin", "superadmin"] as const)("always lets the %s change it", (role) => {
    for (const status of ["pending", "approved", "rejected"] as const) {
      expect(canEditContractTerms(role, status)).toBe(true);
    }
  });
});

describe("ledgerTotals", () => {
  it("is all zeros for an empty ledger", () => {
    expect(ledgerTotals([])).toEqual({ contract: 0, ksebFees: 0, count: 0, lastPaidOn: null });
  });

  it("splits contract collections from KSEB fees", () => {
    const totals = ledgerTotals([
      { amount: 100000, paid_on: "2026-03-01", purpose: "contract" },
      { amount: 3540, paid_on: "2026-03-05", purpose: "kseb_fees" },
      { amount: 50000, paid_on: "2026-04-01", purpose: "contract" },
      { amount: 1000, paid_on: "2026-05-01", purpose: "kseb_fees" },
    ]);
    expect(totals).toEqual({
      contract: 150000,
      ksebFees: 4540,
      count: 2,
      lastPaidOn: "2026-04-01",
    });
  });

  it("counts entries without a purpose as contract (the column default)", () => {
    expect(
      ledgerTotals([
        { amount: 1000, paid_on: "2026-01-01" },
        { amount: 2000, paid_on: "2026-01-02", purpose: null },
      ]),
    ).toEqual({ contract: 3000, ksebFees: 0, count: 2, lastPaidOn: "2026-01-02" });
  });

  it("takes the latest contract date regardless of row order, ignoring KSEB dates", () => {
    const totals = ledgerTotals([
      { amount: 1, paid_on: "2026-06-01" },
      { amount: 1, paid_on: "2026-08-15" },
      { amount: 1, paid_on: "2026-07-01" },
      { amount: 1, paid_on: "2026-12-31", purpose: "kseb_fees" },
    ]);
    expect(totals.lastPaidOn).toBe("2026-08-15");
  });

  it("has no contract date when only KSEB fees were collected", () => {
    expect(
      ledgerTotals([{ amount: 3540, paid_on: "2026-03-05", purpose: "kseb_fees" }]),
    ).toEqual({ contract: 0, ksebFees: 3540, count: 0, lastPaidOn: null });
  });

  it("sums PostgREST strings without floating-point dust", () => {
    const totals = ledgerTotals([
      { amount: "0.10", paid_on: "2026-01-01" },
      { amount: "0.20", paid_on: "2026-01-02" },
      { amount: "0.10", paid_on: "2026-01-03", purpose: "kseb_fees" },
      { amount: "0.20", paid_on: "2026-01-04", purpose: "kseb_fees" },
    ]);
    expect(totals.contract).toBe(0.3);
    expect(totals.ksebFees).toBe(0.3);
  });

  it("supports more than three stages", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      amount: 10000.01,
      paid_on: `2026-${String(i + 1).padStart(2, "0")}-15`,
    }));
    expect(ledgerTotals(entries)).toEqual({
      contract: 120000.12,
      ksebFees: 0,
      count: 12,
      lastPaidOn: "2026-12-15",
    });
  });

  it("treats a garbage amount as zero without dropping the entry", () => {
    expect(
      ledgerTotals([
        { amount: "abc", paid_on: "2026-01-01" },
        { amount: null, paid_on: "2026-01-02" },
        { amount: 500, paid_on: "2026-01-03" },
      ]),
    ).toEqual({ contract: 500, ksebFees: 0, count: 3, lastPaidOn: "2026-01-03" });
  });
});

describe("withStages", () => {
  type Row = LedgerEntry & { id: string };

  it("is empty for an empty ledger", () => {
    expect(withStages([])).toEqual([]);
  });

  it("orders by paid_on and numbers contract stages from 1", () => {
    const rows: Row[] = [
      { id: "c", amount: 3, paid_on: "2026-05-01" },
      { id: "a", amount: 1, paid_on: "2026-01-01" },
      { id: "b", amount: 2, paid_on: "2026-03-01" },
    ];
    expect(withStages(rows).map((r) => [r.id, r.stage])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("numbers each purpose independently", () => {
    const rows: Row[] = [
      { id: "c1", amount: 1, paid_on: "2026-01-01", purpose: "contract" },
      { id: "k1", amount: 1, paid_on: "2026-01-02", purpose: "kseb_fees" },
      { id: "c2", amount: 1, paid_on: "2026-01-03" },
      { id: "k2", amount: 1, paid_on: "2026-01-04", purpose: "kseb_fees" },
      { id: "c3", amount: 1, paid_on: "2026-01-05", purpose: null },
    ];
    expect(withStages(rows).map((r) => [r.id, r.stage])).toEqual([
      ["c1", 1],
      ["k1", 1],
      ["c2", 2],
      ["k2", 2],
      ["c3", 3],
    ]);
  });

  it("breaks a same-day tie on created_at", () => {
    const rows: Row[] = [
      { id: "later", amount: 1, paid_on: "2026-01-01", created_at: "2026-01-01T10:00:00+00:00" },
      { id: "earlier", amount: 1, paid_on: "2026-01-01", created_at: "2026-01-01T09:00:00+00:00" },
    ];
    expect(withStages(rows).map((r) => r.id)).toEqual(["earlier", "later"]);
  });

  it("orders PostgREST timestamps whose fractional seconds differ in length", () => {
    // Postgres JSON drops trailing zeros: .5 is 500 ms, .45 is 450 ms.
    const rows: Row[] = [
      { id: "500ms", amount: 1, paid_on: "2026-01-01", created_at: "2026-01-01T09:00:00.5+00:00" },
      { id: "123.456ms", amount: 1, paid_on: "2026-01-01", created_at: "2026-01-01T09:00:00.123456+00:00" },
      { id: "450ms", amount: 1, paid_on: "2026-01-01", created_at: "2026-01-01T09:00:00.45+00:00" },
    ];
    expect(withStages(rows).map((r) => r.id)).toEqual(["123.456ms", "450ms", "500ms"]);
  });

  // the created_at tie-break uses localeCompare, which collates
  // punctuation (CLDR puts "." before "+") instead of comparing code units.
  // Postgres JSON omits the fraction for a whole-second timestamp, so
  // "…09:00:00+00:00" sorts AFTER "…09:00:00.5+00:00" and the stage numbers of
  // two same-day payments swap. Fix: an ordinal comparator,
  //   const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  // for both paid_on and created_at (ISO strings in one offset sort correctly).
  it("orders a whole-second timestamp before a fractional one", () => {
    const rows: Row[] = [
      { id: "500ms", amount: 1, paid_on: "2026-01-01", created_at: "2026-01-01T09:00:00.5+00:00" },
      { id: "0ms", amount: 1, paid_on: "2026-01-01", created_at: "2026-01-01T09:00:00+00:00" },
    ];
    expect(withStages(rows).map((r) => r.id)).toEqual(["0ms", "500ms"]);
  });

  it("keeps entry order on a full tie (stable sort)", () => {
    const rows: Row[] = ["x", "y", "z"].map((id) => ({ id, amount: 1, paid_on: "2026-01-01" }));
    expect(withStages(rows).map((r) => r.id)).toEqual(["x", "y", "z"]);
  });

  it("puts paid_on ahead of created_at", () => {
    const rows: Row[] = [
      { id: "recorded-first-paid-later", amount: 1, paid_on: "2026-02-01", created_at: "2026-01-01T00:00:00+00:00" },
      { id: "recorded-later-paid-first", amount: 1, paid_on: "2026-01-15", created_at: "2026-03-01T00:00:00+00:00" },
    ];
    expect(withStages(rows).map((r) => [r.id, r.stage])).toEqual([
      ["recorded-later-paid-first", 1],
      ["recorded-first-paid-later", 2],
    ]);
  });

  it("does not mutate the input and keeps extra fields", () => {
    const rows: Row[] = [
      { id: "b", amount: "2.00", paid_on: "2026-02-01" },
      { id: "a", amount: "1.00", paid_on: "2026-01-01" },
    ];
    const snapshot = structuredClone(rows);
    const staged = withStages(rows);
    expect(rows).toEqual(snapshot);
    expect(staged[0]).toEqual({ id: "a", amount: "1.00", paid_on: "2026-01-01", stage: 1 });
    expect(staged[0]).not.toBe(rows[1]);
  });
});

describe("labels", () => {
  it("label every payment method and purpose", () => {
    expect(Object.keys(PAYMENT_METHOD_LABELS).sort()).toEqual([
      "bank_transfer",
      "cash",
      "cheque",
      "loan_disbursement",
      "other",
      "upi",
    ]);
    expect(PAYMENT_PURPOSE_LABELS).toEqual({ contract: "Contract", kseb_fees: "KSEB fees" });
    for (const label of Object.values(PAYMENT_METHOD_LABELS)) expect(label).toBeTruthy();
  });

  it("derive financing labels from the FINANCING registry", () => {
    expect(FINANCING_LABELS).toEqual({ self: "Self-financed", loan: "Bank loan" });
  });
});

describe("type guards", () => {
  const PROTOTYPE_KEYS = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"];

  it("accept every known value", () => {
    for (const v of Object.keys(PAYMENT_METHOD_LABELS)) expect(isPaymentMethod(v)).toBe(true);
    for (const v of Object.keys(PAYMENT_PURPOSE_LABELS)) expect(isPaymentPurpose(v)).toBe(true);
    expect(isFinancingType("self")).toBe(true);
    expect(isFinancingType("loan")).toBe(true);
  });

  it.each(PROTOTYPE_KEYS)("reject the inherited key %j", (key) => {
    expect(isPaymentMethod(key)).toBe(false);
    expect(isPaymentPurpose(key)).toBe(false);
    expect(isFinancingType(key)).toBe(false);
  });

  it.each(["", "CASH", "Cash", " cash", "bank transfer", "kseb", "Loan", "self "])(
    "reject the near-miss %j",
    (value) => {
      expect(isPaymentMethod(value)).toBe(false);
      expect(isPaymentPurpose(value)).toBe(false);
      expect(isFinancingType(value)).toBe(false);
    },
  );
});
