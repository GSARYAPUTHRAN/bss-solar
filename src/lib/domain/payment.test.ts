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
  ledgerEffect,
  ledgerNet,
  ledgerProblems,
  ledgerTotals,
  maxContractPayment,
  maxRefund,
  maxWriteOff,
  paymentSummary,
  signedAmount,
  withLedger,
  withStages,
  type LedgerEntry,
} from "./payment";

/** What `ledgerTotals` says for a ledger with nothing in some purposes. */
const NONE = { ksebFees: 0, ksebFeesByOffice: 0, refunded: 0, writtenOff: 0 };

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
      refunded: 0,
      writtenOff: 0,
      collected: 220000,
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
      refunded: 0,
      writtenOff: 0,
      collected: 0,
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
    expect(ledgerTotals([])).toEqual({ contract: 0, ...NONE, count: 0, lastPaidOn: null });
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
      ...NONE,
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
    ).toEqual({ contract: 3000, ...NONE, count: 2, lastPaidOn: "2026-01-02" });
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
    ).toEqual({ contract: 0, ...NONE, ksebFees: 3540, count: 0, lastPaidOn: null });
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
      ...NONE,
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
    ).toEqual({ contract: 500, ...NONE, count: 3, lastPaidOn: "2026-01-03" });
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
    expect(PAYMENT_PURPOSE_LABELS).toEqual({
      contract: "Contract",
      kseb_fees: "KSEB fees",
      refund: "Refund",
      write_off: "Write-off",
    });
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

describe("paymentSummary — refunds and write-offs", () => {
  const live = { total_cost: 200000, advance_amount: 50000, payments_total: 150000 };

  it("takes a refund out of what was received, and puts it back on the balance", () => {
    const s = paymentSummary({ ...live, refunded_total: 10000 });
    expect(s).toMatchObject({
      collected: 200000,
      refunded: 10000,
      received: 190000,
      balanceDue: 10000,
      isSettled: false,
    });
  });

  it("closes a balance that was written off, whatever was received", () => {
    const s = paymentSummary({
      total_cost: 200000,
      advance_amount: 50000,
      payments_total: 149200,
      written_off_total: 800,
    });
    expect(s).toMatchObject({ received: 199200, writtenOff: 800, balanceDue: 0, isSettled: true });
  });

  it("nets a refund and a write-off on the same sale", () => {
    const s = paymentSummary({
      total_cost: 200000,
      advance_amount: 50000,
      payments_total: 150000,
      refunded_total: 10000,
      written_off_total: 10000,
    });
    expect(s).toMatchObject({ received: 190000, balanceDue: 0, isSettled: true });
  });

  it("reads PostgREST strings and garbage in the new fields too", () => {
    const s = paymentSummary({ ...live, refunded_total: "2500.50", written_off_total: "abc" });
    expect(s).toMatchObject({ refunded: 2500.5, writtenOff: 0, balanceDue: 2500.5 });
  });

  it("does not drift on paise", () => {
    const s = paymentSummary({
      total_cost: "1000.00",
      advance_amount: "0.10",
      payments_total: "0.20",
      refunded_total: "0.10",
      written_off_total: "0.10",
    });
    expect(s.received).toBe(0.2);
    expect(s.balanceDue).toBe(999.7);
  });

  it("leaves a source without the new fields exactly as before", () => {
    expect(paymentSummary(live)).toMatchObject({ received: 200000, balanceDue: 0 });
  });
});

describe("isPaymentPending / collectedPct / collectibleBalance — with refunds and write-offs", () => {
  const paid = { total_cost: 200000, advance_amount: 50000, payments_total: 150000 };

  it("a refund on a paid-up commissioned project reopens the balance", () => {
    expect(isPaymentPending({ is_completed: true }, paid)).toBe(false);
    expect(isPaymentPending({ is_completed: true }, { ...paid, refunded_total: 10000 })).toBe(true);
  });

  it("a write-off closes a commissioned balance that is not coming", () => {
    const short = { ...paid, payments_total: 149200 };
    expect(isPaymentPending({ is_completed: true }, short)).toBe(true);
    expect(isPaymentPending({ is_completed: true }, { ...short, written_off_total: 800 })).toBe(
      false,
    );
  });

  it("a written-off sale reads 100% collected, though it was not all received", () => {
    const short = { ...paid, payments_total: 149200 };
    expect(collectedPct(short)).toBe(99);
    expect(collectedPct({ ...short, written_off_total: 800 })).toBe(100);
  });

  it("a refund lowers the share collected", () => {
    expect(collectedPct({ ...paid, refunded_total: 100000 })).toBe(50);
  });

  it("a cancelled sale has nothing collectable, refund or not", () => {
    const summary = paymentSummary({ ...paid, refunded_total: 10000 });
    expect(summary.balanceDue).toBe(10000);
    expect(collectibleBalance(summary, "refunded")).toBe(0);
    expect(collectibleBalance(summary, null)).toBe(10000);
    expect(
      isPaymentPending({ is_completed: true, cancellation: "refunded" }, { ...paid, refunded_total: 10000 }),
    ).toBe(false);
  });
});

describe("ledgerTotals — refunds, write-offs and who paid the KSEB fee", () => {
  const ledger: LedgerEntry[] = [
    { amount: 100000, paid_on: "2026-03-01", purpose: "contract" },
    { amount: 4540, paid_on: "2026-03-05", purpose: "kseb_fees" },
    { amount: 1180, paid_on: "2026-03-06", purpose: "kseb_fees", paid_by_office: true },
    { amount: 2500, paid_on: "2026-03-07", purpose: "kseb_fees", paid_by_office: false },
    { amount: 10000, paid_on: "2026-04-01", purpose: "refund" },
    { amount: 5000, paid_on: "2026-04-02", purpose: "refund" },
    { amount: 800, paid_on: "2026-04-03", purpose: "write_off" },
  ];

  it("splits every purpose, and the KSEB fees by who paid", () => {
    expect(ledgerTotals(ledger)).toEqual({
      contract: 100000,
      ksebFees: 7040,
      ksebFeesByOffice: 1180,
      refunded: 15000,
      writtenOff: 800,
      count: 1,
      lastPaidOn: "2026-03-01",
    });
  });

  it("never counts a refund or a write-off as a contract payment, or dates the last payment by one", () => {
    const totals = ledgerTotals([
      { amount: 1, paid_on: "2026-01-01" },
      { amount: 1, paid_on: "2026-12-31", purpose: "refund" },
      { amount: 1, paid_on: "2026-12-31", purpose: "write_off" },
    ]);
    expect(totals.count).toBe(1);
    expect(totals.lastPaidOn).toBe("2026-01-01");
  });

  it("sums refunds and write-offs without floating-point dust", () => {
    const totals = ledgerTotals([
      { amount: "0.10", paid_on: "2026-01-01", purpose: "refund" },
      { amount: "0.20", paid_on: "2026-01-02", purpose: "refund" },
      { amount: "0.10", paid_on: "2026-01-03", purpose: "write_off" },
      { amount: "0.20", paid_on: "2026-01-04", purpose: "write_off" },
      { amount: "0.10", paid_on: "2026-01-05", purpose: "kseb_fees", paid_by_office: true },
      { amount: "0.20", paid_on: "2026-01-06", purpose: "kseb_fees", paid_by_office: true },
    ]);
    expect([totals.refunded, totals.writtenOff, totals.ksebFeesByOffice]).toEqual([0.3, 0.3, 0.3]);
  });

  it("feeds the summary: contract, refunded and written off are its three ledger inputs", () => {
    const totals = ledgerTotals(ledger);
    const s = paymentSummary({
      total_cost: 120000,
      advance_amount: 30000,
      payments_total: totals.contract,
      refunded_total: totals.refunded,
      written_off_total: totals.writtenOff,
    });
    // 30,000 + 100,000 − 15,000 received; 120,000 − 115,000 − 800 left.
    expect(s.received).toBe(115000);
    expect(s.balanceDue).toBe(4200);
  });
});

describe("ledgerNet / withLedger", () => {
  it("nets the ledger without the advance: contract less refunds", () => {
    expect(ledgerNet({ contract: 150000, refunded: 10000 })).toBe(140000);
    expect(ledgerNet({ contract: 0.3, refunded: 0.1 })).toBe(0.2);
  });

  it("gives the terms and the ledger's totals in the shape the summary takes", () => {
    const source = withLedger({ total_cost: 200000, advance_amount: 50000 }, [
      { amount: 100000, paid_on: "2026-01-01" },
      { amount: 5000, paid_on: "2026-01-02", purpose: "refund" },
      { amount: 800, paid_on: "2026-01-03", purpose: "write_off" },
      { amount: 4540, paid_on: "2026-01-04", purpose: "kseb_fees" },
    ]);
    expect(source).toEqual({
      total_cost: 200000,
      advance_amount: 50000,
      payments_total: 100000,
      refunded_total: 5000,
      written_off_total: 800,
    });
    // 50,000 + 100,000 − 5,000 received; 200,000 − 145,000 − 800 left.
    expect(paymentSummary(source).balanceDue).toBe(54200);
  });
});

describe("the caps: maxContractPayment / maxRefund / maxWriteOff", () => {
  const source = {
    total_cost: 200000,
    advance_amount: 50000,
    payments_total: 100000,
    refunded_total: 0,
    written_off_total: 0,
  };

  it("lets a refund be at most what BSS holds: advance plus contract, less earlier refunds", () => {
    expect(maxRefund(source)).toBe(150000);
    expect(maxRefund({ ...source, refunded_total: 20000 })).toBe(130000);
    expect(maxRefund({ ...source, refunded_total: 150000 })).toBe(0);
  });

  it("never lets a refund exceed what was collected, even on a corrupt ledger", () => {
    expect(maxRefund({ ...source, refunded_total: 999999 })).toBe(0);
  });

  it("does not count a write-off as money to refund", () => {
    expect(maxRefund({ ...source, written_off_total: 50000 })).toBe(150000);
  });

  it("lets a write-off be at most the balance due", () => {
    expect(maxWriteOff(source)).toBe(50000);
    expect(maxWriteOff({ ...source, payments_total: 149200 })).toBe(800);
    expect(maxWriteOff({ ...source, written_off_total: 10000 })).toBe(40000);
  });

  it("allows no write-off once the contract is settled or overpaid", () => {
    expect(maxWriteOff({ ...source, payments_total: 150000 })).toBe(0);
    expect(maxWriteOff({ ...source, payments_total: 160000 })).toBe(0);
  });

  it("lets a contract payment be at most the balance, which a refund raises and a write-off lowers", () => {
    expect(maxContractPayment(source)).toBe(50000);
    expect(maxContractPayment({ ...source, refunded_total: 10000 })).toBe(60000);
    expect(maxContractPayment({ ...source, written_off_total: 800 })).toBe(49200);
    expect(maxContractPayment({ ...source, payments_total: 160000 })).toBe(0);
  });
});

describe("ledgerEffect / signedAmount", () => {
  it("money in, money out, and a balance closed", () => {
    expect(ledgerEffect("contract")).toBe("in");
    expect(ledgerEffect("kseb_fees")).toBe("in");
    expect(ledgerEffect(null)).toBe("in");
    expect(ledgerEffect(undefined)).toBe("in");
    expect(ledgerEffect("refund")).toBe("out");
    expect(ledgerEffect("write_off")).toBe("adjustment");
  });

  it("shows a refund as a negative line and everything else positive", () => {
    expect(signedAmount({ amount: 10000, purpose: "refund" })).toBe(-10000);
    expect(signedAmount({ amount: "10000.50", purpose: "refund" })).toBe(-10000.5);
    expect(signedAmount({ amount: 800, purpose: "write_off" })).toBe(800);
    expect(signedAmount({ amount: 4540, purpose: "kseb_fees" })).toBe(4540);
    expect(signedAmount({ amount: 100 })).toBe(100);
  });
});

describe("withStages — refunds and write-offs are not stages", () => {
  type Row = LedgerEntry & { id: string };

  it("numbers only collections, and leaves a refund or a write-off unnumbered", () => {
    const rows: Row[] = [
      { id: "c1", amount: 1, paid_on: "2026-01-01" },
      { id: "r1", amount: 1, paid_on: "2026-01-02", purpose: "refund" },
      { id: "c2", amount: 1, paid_on: "2026-01-03" },
      { id: "w1", amount: 1, paid_on: "2026-01-04", purpose: "write_off" },
      { id: "k1", amount: 1, paid_on: "2026-01-05", purpose: "kseb_fees" },
      { id: "r2", amount: 1, paid_on: "2026-01-06", purpose: "refund" },
      { id: "c3", amount: 1, paid_on: "2026-01-07" },
    ];
    expect(withStages(rows).map((r) => [r.id, r.stage])).toEqual([
      ["c1", 1],
      ["r1", null],
      ["c2", 2],
      ["w1", null],
      ["k1", 1],
      ["r2", null],
      ["c3", 3],
    ]);
  });

  it("keeps the rest of the entry", () => {
    const rows: Row[] = [{ id: "r", amount: "5.00", paid_on: "2026-01-01", purpose: "refund" }];
    const [refund] = withStages(rows);
    expect(refund).toEqual({ id: "r", amount: "5.00", paid_on: "2026-01-01", purpose: "refund", stage: null });
  });
});

describe("ledgerProblems — a ledger replayed in the order it happened", () => {
  const terms = { total_cost: 200000, advance_amount: 50000 };
  const entry = (
    purpose: LedgerEntry["purpose"],
    amount: number,
    paid_on: string,
  ): LedgerEntry => ({ amount, paid_on, purpose });

  it("finds nothing wrong with an ordinary ledger", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 100000, "2026-01-10"),
        entry("refund", 10000, "2026-02-01"),
        entry("contract", 59999, "2026-02-10"),
        entry("write_off", 0.5, "2026-02-11"),
      ]),
    ).toEqual([]);
  });

  it("refuses a refund larger than what was collected by then", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 100000, "2026-01-10"),
        entry("refund", 160000, "2026-02-01"),
      ]),
    ).toEqual([{ entry: 1, kind: "refund_over_collected", limit: 150000 }]);
  });

  it("counts money that comes after a refund as not yet collected", () => {
    // 150,000 is held on 1 Feb; the 100,000 paid on 1 Mar cannot be refunded on 1 Feb.
    expect(
      ledgerProblems(terms, [
        entry("refund", 140000, "2026-02-01"),
        entry("contract", 100000, "2026-01-10"),
        entry("contract", 40000, "2026-03-01"),
      ]),
    ).toEqual([]);
    expect(
      ledgerProblems(terms, [
        entry("refund", 140000, "2026-01-05"),
        entry("contract", 100000, "2026-01-10"),
      ]),
    ).toEqual([{ entry: 0, kind: "refund_over_collected", limit: 50000 }]);
  });

  it("does not let two refunds take the same money twice", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 100000, "2026-01-10"),
        entry("refund", 100000, "2026-02-01"),
        entry("refund", 60000, "2026-02-02"),
      ]),
    ).toEqual([{ entry: 2, kind: "refund_over_collected", limit: 50000 }]);
  });

  it("on one day, a collection comes before a refund, and a refund before a write-off", () => {
    expect(
      ledgerProblems({ total_cost: 100000, advance_amount: 0 }, [
        entry("refund", 100000, "2026-01-10"),
        entry("contract", 100000, "2026-01-10"),
      ]),
    ).toEqual([]);
    expect(
      ledgerProblems({ total_cost: 100000, advance_amount: 0 }, [
        entry("write_off", 100000, "2026-01-10"),
        entry("refund", 40000, "2026-01-10"),
        entry("contract", 40000, "2026-01-10"),
      ]),
    ).toEqual([]);
  });

  it("refuses a write-off larger than the balance then due", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 149200, "2026-01-10"),
        entry("write_off", 1000, "2026-01-11"),
      ]),
    ).toEqual([{ entry: 1, kind: "write_off_over_balance", limit: 800 }]);
  });

  it("sees a refund as raising the balance a write-off may close", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 150000, "2026-01-10"),
        entry("refund", 5000, "2026-01-20"),
        entry("write_off", 5000, "2026-01-21"),
      ]),
    ).toEqual([]);
  });

  it("does not let a second write-off close the same balance again", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 149200, "2026-01-10"),
        entry("write_off", 800, "2026-01-11"),
        entry("write_off", 800, "2026-01-12"),
      ]),
    ).toEqual([{ entry: 2, kind: "write_off_over_balance", limit: 0 }]);
  });

  it("does not judge contract overpayment: a customer may overpay and be refunded the excess", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 160000, "2026-01-10"),
        entry("refund", 10000, "2026-01-20"),
      ]),
    ).toEqual([]);
  });

  it("names entries by their place in the list given, not in date order", () => {
    const problems = ledgerProblems(terms, [
      entry("write_off", 99999, "2026-03-01"),
      entry("contract", 100000, "2026-01-10"),
      entry("refund", 999999, "2026-02-01"),
    ]);
    expect(problems.map((p) => [p.entry, p.kind])).toEqual([
      [0, "write_off_over_balance"],
      [2, "refund_over_collected"],
    ]);
  });

  it("reports a slipped digit once, not again in every entry after it", () => {
    expect(
      ledgerProblems(terms, [
        entry("contract", 100000, "2026-01-10"),
        entry("refund", 1000000, "2026-02-01"),
        entry("refund", 10000, "2026-02-02"),
      ]),
    ).toEqual([{ entry: 1, kind: "refund_over_collected", limit: 150000 }]);
  });

  it("ignores KSEB fees", () => {
    expect(
      ledgerProblems(terms, [
        entry("kseb_fees", 999999, "2026-01-01"),
        entry("refund", 1, "2026-01-02"),
      ]),
    ).toEqual([]);
  });

  it("breaks a tie between same-day, same-kind entries by when they were recorded, then by order", () => {
    const entries: LedgerEntry[] = [
      { amount: 100000, paid_on: "2026-01-10", purpose: "refund", created_at: "2026-01-10T11:00:00+00:00" },
      { amount: 100000, paid_on: "2026-01-10", purpose: "refund", created_at: "2026-01-10T10:00:00+00:00" },
      entry("contract", 100000, "2026-01-01"),
    ];
    // Entry 1 was recorded first, so entry 0 is the one that goes over.
    expect(ledgerProblems(terms, entries)).toEqual([
      { entry: 0, kind: "refund_over_collected", limit: 50000 },
    ]);
  });
});

/**
 * The list views compute the same figures in SQL (migration
 * 20261104120100, work_orders_list / projects_list):
 *
 *   payments_total      = Σ amount where purpose = 'contract'
 *   refunded_total      = Σ amount where purpose = 'refund'
 *   written_off_total   = Σ amount where purpose = 'write_off'
 *   amount_received     = advance + payments_total − refunded_total
 *   balance_due         = total_cost − amount_received − written_off_total
 *   payment_pending     = completed and not cancelled and balance_due > 0
 *
 * This replays that arithmetic in exact integer paise and checks the domain
 * against it over a deterministic spread of ledgers, so a drift in either shows
 * up here before it shows up in a list. (tests/integration pins the SQL itself.)
 */
describe("parity with the SQL view maths", () => {
  const PURPOSES = ["contract", "kseb_fees", "refund", "write_off"] as const;

  function lcg(seed: number) {
    let state = seed;
    return (max: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % max;
    };
  }

  const toPaise = (rupees: number) => Math.round(rupees * 100);

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))("ledger #%i", (seed) => {
    const next = lcg(seed);
    const total_cost = (next(5_000_000) + 1) / 100;
    const advance_amount = next(2) === 0 ? 0 : next(Math.floor(toPaise(total_cost) / 2) + 1) / 100;
    const entries: LedgerEntry[] = Array.from({ length: next(9) }, (_, i) => ({
      amount: (next(300_000) + 1) / 100,
      paid_on: `2026-01-${String(i + 1).padStart(2, "0")}`,
      purpose: PURPOSES[next(PURPOSES.length)],
      paid_by_office: next(2) === 0,
    }));

    // The view, in paise.
    const sum = (purpose: string) =>
      entries.filter((e) => e.purpose === purpose).reduce((s, e) => s + toPaise(Number(e.amount)), 0);
    const paymentsTotal = sum("contract");
    const refundedTotal = sum("refund");
    const writtenOffTotal = sum("write_off");
    const amountReceived = toPaise(advance_amount) + paymentsTotal - refundedTotal;
    const balanceDue = toPaise(total_cost) - amountReceived - writtenOffTotal;

    const source = withLedger({ total_cost, advance_amount }, entries);
    const s = paymentSummary(source);
    expect(toPaise(Number(source.payments_total))).toBe(paymentsTotal);
    expect(toPaise(Number(source.refunded_total))).toBe(refundedTotal);
    expect(toPaise(Number(source.written_off_total))).toBe(writtenOffTotal);
    expect(toPaise(s.received)).toBe(amountReceived);
    expect(toPaise(s.balanceDue)).toBe(balanceDue);
    expect(isPaymentPending({ is_completed: true, cancellation: null }, source)).toBe(balanceDue > 0);
    expect(isPaymentPending({ is_completed: false, cancellation: null }, source)).toBe(false);
    expect(
      ledgerTotals(entries).ksebFees + ledgerTotals(entries).ksebFeesByOffice,
    ).toBeCloseTo(sum("kseb_fees") / 100, 2);
  });
});
