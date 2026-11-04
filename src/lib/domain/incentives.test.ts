import { describe, it, expect } from "vitest";
import { formatCurrency } from "@/lib/format";
import {
  INCENTIVE_STATE_LABELS,
  checkIncentiveAmount,
  derivedPaidOn,
  incentivePaid,
  incentivePending,
  incentiveState,
  planIncentiveInstalment,
  summarizeIncentives,
} from "./incentives";

const TODAY = "2026-10-10";

describe("incentivePaid", () => {
  it("adds the instalments", () => {
    expect(incentivePaid([{ amount: 20000 }, { amount: 2360 }, { amount: 2360 }])).toBe(24720);
  });

  it("is nothing for no instalments", () => {
    expect(incentivePaid([])).toBe(0);
  });

  it("reads PostgREST strings without floating-point dust", () => {
    expect(incentivePaid([{ amount: "0.10" }, { amount: "0.20" }])).toBe(0.3);
  });

  it("counts a garbage amount as nothing", () => {
    expect(incentivePaid([{ amount: "abc" }, { amount: null }, { amount: 100 }])).toBe(100);
  });
});

describe("incentivePending", () => {
  it("is the agreed amount less what was paid", () => {
    expect(incentivePending({ amount: 25000, paid: 24720 })).toBe(280);
    expect(incentivePending({ amount: 25000, paid: 0 })).toBe(25000);
    expect(incentivePending({ amount: "25000.00", paid: "100.50" })).toBe(24899.5);
  });

  it("is nothing once paid, and never negative", () => {
    expect(incentivePending({ amount: 5000, paid: 5000 })).toBe(0);
    expect(incentivePending({ amount: 5000, paid: 6000 })).toBe(0);
  });

  it("is nothing to pay while no amount is set", () => {
    expect(incentivePending({ amount: null, paid: 0 })).toBe(0);
    expect(incentivePending({ amount: undefined, paid: 0 })).toBe(0);
  });

  it("does not drift on paise", () => {
    expect(incentivePending({ amount: 0.3, paid: 0.1 })).toBe(0.2);
  });
});

describe("incentiveState", () => {
  it.each([
    [{ amount: null, paid: 0 }, "unset"],
    [{ amount: undefined, paid: 0 }, "unset"],
    [{ amount: 5000, paid: 0 }, "pending"],
    [{ amount: 5000, paid: 2000 }, "partly_paid"],
    [{ amount: 5000, paid: 4999.99 }, "partly_paid"],
    [{ amount: 5000, paid: 5000 }, "paid"],
    [{ amount: "5000.00", paid: "5000.00" }, "paid"],
  ] as const)("%j is %s", (figures, state) => {
    expect(incentiveState(figures)).toBe(state);
  });

  it("calls an agreed amount of zero paid: there is nothing to pay", () => {
    expect(incentiveState({ amount: 0, paid: 0 })).toBe("paid");
  });

  it("an amount set beats having no instalments, even when it was paid in advance of the setting", () => {
    // (paid > amount cannot happen — the database forbids it — but must not read as unset.)
    expect(incentiveState({ amount: 100, paid: 200 })).toBe("paid");
  });

  it("has a label for every state", () => {
    expect(INCENTIVE_STATE_LABELS).toEqual({
      unset: "Not set",
      pending: "Pending",
      partly_paid: "Partly paid",
      paid: "Paid",
    });
  });
});

describe("summarizeIncentives", () => {
  it("totals what is agreed, paid and still to pay, as incentive_summary() does", () => {
    expect(
      summarizeIncentives([
        { amount: 25000, paid: 24720 },
        { amount: 5000, paid: 5000 },
        { amount: 8000, paid: 0 },
        { amount: null, paid: 0 },
      ]),
    ).toEqual({ total: 38000, paid: 29720, pending: 8280, count: 3, unpaidCount: 2 });
  });

  it("counts a zero incentive as set, and as nothing to pay", () => {
    expect(summarizeIncentives([{ amount: 0, paid: 0 }])).toEqual({
      total: 0,
      paid: 0,
      pending: 0,
      count: 1,
      unpaidCount: 0,
    });
  });

  it("is all zero when nobody has one", () => {
    expect(summarizeIncentives([])).toEqual({ total: 0, paid: 0, pending: 0, count: 0, unpaidCount: 0 });
    expect(summarizeIncentives([{ amount: null, paid: 0 }])).toMatchObject({ count: 0, total: 0 });
  });

  it("keeps total − paid = pending exactly", () => {
    const s = summarizeIncentives([
      { amount: 0.3, paid: 0.1 },
      { amount: 0.3, paid: 0.2 },
    ]);
    expect(s).toMatchObject({ total: 0.6, paid: 0.3, pending: 0.3 });
  });
});

describe("derivedPaidOn", () => {
  it("is the date of the instalment that reaches the agreed amount", () => {
    expect(
      derivedPaidOn(25000, [
        { amount: 20000, paid_on: "2025-05-15" },
        { amount: 2360, paid_on: "2025-05-16" },
        { amount: 2640, paid_on: "2025-05-21" },
      ]),
    ).toBe("2025-05-21");
  });

  it("goes by date, not by the order the instalments are listed", () => {
    expect(
      derivedPaidOn(5000, [
        { amount: 3000, paid_on: "2026-03-01" },
        { amount: 2000, paid_on: "2026-01-01" },
      ]),
    ).toBe("2026-03-01");
  });

  it("is null while anything is still to pay", () => {
    expect(derivedPaidOn(25000, [{ amount: 20000, paid_on: "2025-05-15" }])).toBeNull();
    expect(derivedPaidOn(25000, [])).toBeNull();
  });

  it("is null while no amount is set", () => {
    expect(derivedPaidOn(null, [{ amount: 100, paid_on: "2025-05-15" }])).toBeNull();
  });

  it("is the single instalment's date when it pays everything", () => {
    expect(derivedPaidOn("5000.00", [{ amount: "5000.00", paid_on: "2026-02-02" }])).toBe("2026-02-02");
  });

  it("does not let an instalment on an earlier day than another reach it by luck of listing", () => {
    // 3,000 on the 2nd then 2,000 on the 1st: the total is reached on the 2nd.
    expect(
      derivedPaidOn(5000, [
        { amount: 3000, paid_on: "2026-01-02" },
        { amount: 2000, paid_on: "2026-01-01" },
      ]),
    ).toBe("2026-01-02");
  });

  it("is exact on paise", () => {
    expect(
      derivedPaidOn(0.3, [
        { amount: 0.1, paid_on: "2026-01-01" },
        { amount: 0.2, paid_on: "2026-01-02" },
      ]),
    ).toBe("2026-01-02");
  });
});

describe("planIncentiveInstalment", () => {
  const base = { amount: 25000, paid: 20000, instalment: 2360, paidOn: "2026-10-01", today: TODAY };

  it("says what the instalment leaves", () => {
    expect(planIncentiveInstalment(base)).toEqual({
      ok: true,
      data: { paidAfter: 22360, pendingAfter: 2640, stateAfter: "partly_paid" },
    });
  });

  it("allows the instalment that pays it off, and calls it paid", () => {
    expect(planIncentiveInstalment({ ...base, instalment: 5000 })).toEqual({
      ok: true,
      data: { paidAfter: 25000, pendingAfter: 0, stateAfter: "paid" },
    });
  });

  it("takes a first instalment against a pending incentive", () => {
    expect(planIncentiveInstalment({ ...base, paid: 0, instalment: 100 })).toMatchObject({
      ok: true,
      data: { stateAfter: "partly_paid", pendingAfter: 24900 },
    });
  });

  it("needs the amount set first", () => {
    for (const amount of [null, undefined]) {
      expect(planIncentiveInstalment({ ...base, amount })).toEqual({
        ok: false,
        error: "Set the incentive amount first.",
      });
    }
  });

  it("refuses an instalment that would exceed the agreed amount, and says what is left", () => {
    expect(planIncentiveInstalment({ ...base, instalment: 5000.01 })).toEqual({
      ok: false,
      error: `${formatCurrency(5000.01)} is more than the ${formatCurrency(5000)} still to pay on this incentive.`,
    });
  });

  it("refuses any instalment on an incentive that is already paid", () => {
    expect(planIncentiveInstalment({ ...base, paid: 25000, instalment: 1 })).toEqual({
      ok: false,
      error: "This incentive is already fully paid.",
    });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %j as an instalment", (instalment) => {
    const res = planIncentiveInstalment({ ...base, instalment });
    expect(res.ok).toBe(false);
  });

  it("refuses a date that is missing, not a date, or in the future", () => {
    expect(planIncentiveInstalment({ ...base, paidOn: "" })).toEqual({
      ok: false,
      error: "Enter the date the instalment was paid.",
    });
    expect(planIncentiveInstalment({ ...base, paidOn: "2026-02-30" })).toMatchObject({ ok: false });
    expect(planIncentiveInstalment({ ...base, paidOn: "2026-10-11" })).toEqual({
      ok: false,
      error: "The payment date cannot be in the future.",
    });
    expect(planIncentiveInstalment({ ...base, paidOn: TODAY })).toMatchObject({ ok: true });
  });

  it("does not count the instalment being edited twice", () => {
    // 22,360 paid in all, of which this instalment is 2,360: the others are 20,000, so it may
    // become 5,000 and no more.
    expect(
      planIncentiveInstalment({ ...base, paid: 22360, replacing: 2360, instalment: 5000 }),
    ).toEqual({
      ok: true,
      data: { paidAfter: 25000, pendingAfter: 0, stateAfter: "paid" },
    });
    expect(
      planIncentiveInstalment({ ...base, paid: 22360, replacing: 2360, instalment: 5000.01 }),
    ).toMatchObject({ ok: false });
    // Without `replacing` the same edit would be counted twice and refused.
    expect(
      planIncentiveInstalment({ ...base, paid: 22360, instalment: 5000 }),
    ).toMatchObject({ ok: false });
  });

  it("is exact on paise", () => {
    expect(
      planIncentiveInstalment({ ...base, amount: 0.3, paid: 0.1, instalment: 0.2 }),
    ).toEqual({ ok: true, data: { paidAfter: 0.3, pendingAfter: 0, stateAfter: "paid" } });
  });

  it("reads PostgREST strings", () => {
    expect(
      planIncentiveInstalment({ ...base, amount: "25000.00", paid: "20000.00" }),
    ).toMatchObject({ ok: true, data: { paidAfter: 22360 } });
  });
});

describe("checkIncentiveAmount", () => {
  it("lets the agreed amount be corrected up or down while nothing is paid", () => {
    expect(checkIncentiveAmount(1000, 0)).toEqual({ ok: true, data: { pendingAfter: 1000 } });
    expect(checkIncentiveAmount(0, 0)).toEqual({ ok: true, data: { pendingAfter: 0 } });
  });

  it("lets it fall to exactly what is paid, never below", () => {
    expect(checkIncentiveAmount(24720, 24720)).toEqual({ ok: true, data: { pendingAfter: 0 } });
    expect(checkIncentiveAmount(24719.99, 24720)).toEqual({
      ok: false,
      error: `The incentive cannot be less than the ${formatCurrency(24720)} already paid.`,
    });
  });

  it("says what is left to pay after a rise", () => {
    expect(checkIncentiveAmount(30000, 24720)).toEqual({ ok: true, data: { pendingAfter: 5280 } });
  });

  it("clears an incentive only while nothing has been paid on it", () => {
    expect(checkIncentiveAmount(null, 0)).toEqual({ ok: true, data: { pendingAfter: 0 } });
    expect(checkIncentiveAmount(null, "100.00")).toEqual({
      ok: false,
      error: `${formatCurrency(100)} has already been paid on this incentive — remove those payments before clearing it.`,
    });
  });
});
