import { describe, it, expect } from "vitest";
import { formatCurrency } from "@/lib/format";
import {
  CUSTOM_PLAN_FEASIBILITY_ERROR,
  cancellationImpact,
  feasibilityDateRefusal,
  hasUndatedCommissioning,
  incentiveChanged,
  incentiveTotals,
  MAX_INCENTIVE,
  parseFeasibilitySetting,
  parseIncentiveSetting,
  reinstateClockImpact,
  UNDATED_COMMISSIONING_FEASIBILITY_ERROR,
  unpaidIncentives,
} from "./project-settings";

const TODAY = "2026-10-10";

function incentive(input: { amount?: string | null; paidOn?: string | null }) {
  return parseIncentiveSetting(
    { amount: input.amount ?? null, paidOn: input.paidOn ?? null },
    TODAY,
  );
}

function incentiveError(input: { amount?: string | null; paidOn?: string | null }) {
  const res = incentive(input);
  return res.ok ? null : res.error;
}

describe("parseFeasibilitySetting", () => {
  it("treats an empty field as 'clear it'", () => {
    expect(parseFeasibilitySetting(null, TODAY)).toEqual({ ok: true, data: null });
  });

  it("accepts a real date, today included", () => {
    expect(parseFeasibilitySetting("2026-09-01", TODAY)).toEqual({
      ok: true,
      data: "2026-09-01",
    });
    expect(parseFeasibilitySetting(TODAY, TODAY).ok).toBe(true);
  });

  it("rejects a date in the future", () => {
    expect(parseFeasibilitySetting("2026-10-11", TODAY)).toEqual({
      ok: false,
      error: "Feasibility date cannot be in the future.",
    });
  });

  it.each(["2026-02-30", "10/10/2026", "2026-1-5", "yesterday"])(
    "rejects %s as not a real ISO date",
    (value) => {
      expect(parseFeasibilitySetting(value, TODAY)).toEqual({
        ok: false,
        error: "Feasibility date must be a valid date.",
      });
    },
  );
});

describe("parseIncentiveSetting", () => {
  it("accepts an all-empty form as 'clear the incentive'", () => {
    expect(incentive({})).toEqual({ ok: true, data: { amount: null, paid_on: null } });
  });

  it("accepts an amount, pending or paid", () => {
    expect(incentive({ amount: "2500" })).toEqual({
      ok: true,
      data: { amount: 2500, paid_on: null },
    });
    expect(incentive({ amount: "2500", paidOn: TODAY })).toEqual({
      ok: true,
      data: { amount: 2500, paid_on: TODAY },
    });
  });

  describe("amount", () => {
    it("allows zero", () => {
      const res = incentive({ amount: "0" });
      expect(res.ok && res.data.amount).toBe(0);
    });

    it("tolerates separators, spaces and a rupee sign", () => {
      const res = incentive({ amount: "₹ 1,25,000.50" });
      expect(res.ok && res.data.amount).toBe(125000.5);
    });

    it("rounds to paise", () => {
      const res = incentive({ amount: "99.999" });
      expect(res.ok && res.data.amount).toBe(100);
    });

    it("rejects a negative amount", () => {
      expect(incentiveError({ amount: "-1" })).toBe("Incentive cannot be negative.");
    });

    it.each(["abc", "1e5", "12.", "2,5,0a", "NaN", "Infinity"])(
      "rejects %s as not an amount",
      (value) => {
        expect(incentiveError({ amount: value })).toBe(
          "Incentive must be an amount in rupees, e.g. 2500.",
        );
      },
    );

    it("rejects an amount the column cannot hold", () => {
      expect(incentiveError({ amount: String(MAX_INCENTIVE + 1) })).toBe(
        "Incentive is too large.",
      );
      expect(incentiveError({ amount: String(MAX_INCENTIVE) })).toBeNull();
    });
  });

  describe("paid on", () => {
    it("needs an amount to have been paid", () => {
      expect(incentiveError({ paidOn: "2026-10-01" })).toBe(
        "Enter the incentive amount before marking it paid.",
      );
    });

    it("rejects a future date", () => {
      expect(incentiveError({ amount: "1000", paidOn: "2026-12-01" })).toBe(
        "Incentive paid-on date cannot be in the future.",
      );
    });

    it("rejects an invalid date", () => {
      expect(incentiveError({ amount: "1000", paidOn: "2026-13-01" })).toBe(
        "Incentive paid-on date must be a valid date.",
      );
    });
  });

  it("reports the amount's problem before the date's", () => {
    expect(incentiveError({ amount: "-5", paidOn: "nope" })).toBe(
      "Incentive cannot be negative.",
    );
  });
});

describe("incentiveChanged", () => {
  const SET = { amount: 3000, paid_on: null };

  it("is false when nothing about the incentive changed", () => {
    expect(incentiveChanged(SET, { ...SET })).toBe(false);
  });

  it("treats a numeric string from the database as the same amount", () => {
    const fromDb = { amount: "3000.00" as unknown as number, paid_on: null };
    expect(incentiveChanged(fromDb, SET)).toBe(false);
  });

  it("detects a new, changed or removed amount", () => {
    const none = { amount: null, paid_on: null };
    expect(incentiveChanged(none, SET)).toBe(true);
    expect(incentiveChanged(SET, { ...SET, amount: 3500 })).toBe(true);
    expect(incentiveChanged(SET, none)).toBe(true);
  });

  it("detects the incentive being marked paid (or unpaid)", () => {
    const paid = { ...SET, paid_on: "2026-10-09" };
    expect(incentiveChanged(SET, paid)).toBe(true);
    expect(incentiveChanged(paid, SET)).toBe(true);
  });
});

describe("feasibilityDateRefusal", () => {
  const LIVE = {
    plan_type: "solar",
    cancellation: null,
    cancelled_on: null,
    is_completed: false,
    completed_at: null,
  } as const;

  it("lets a solar project take a date, and anything clear it", () => {
    expect(feasibilityDateRefusal(LIVE, "2026-09-01")).toBeNull();
    expect(
      feasibilityDateRefusal({ ...LIVE, plan_type: "custom" }, null),
    ).toBeNull();
  });

  it("refuses a date on a custom plan", () => {
    expect(feasibilityDateRefusal({ ...LIVE, plan_type: "custom" }, "2026-09-01")).toBe(
      CUSTOM_PLAN_FEASIBILITY_ERROR,
    );
  });

  it("refuses a running clock on a cancelled project that never recorded when it stopped", () => {
    const unrecorded = { ...LIVE, cancellation: "refunded", cancelled_on: null } as const;
    expect(feasibilityDateRefusal(unrecorded, "2026-09-01")).toMatch(
      /Record the date it was cancelled first/,
    );
    // With the date recorded, the clock has somewhere to stop.
    expect(
      feasibilityDateRefusal({ ...unrecorded, cancelled_on: "2026-10-01" }, "2026-09-01"),
    ).toBeNull();
  });

  describe("a commissioned project whose commissioning date was never recorded", () => {
    // An imported commissioned row without commissioned_on: completed, no instant.
    const UNDATED = { ...LIVE, is_completed: true, completed_at: null } as const;

    it("refuses a date: the clock would run to today and never stop", () => {
      expect(feasibilityDateRefusal(UNDATED, "2025-01-05")).toBe(
        UNDATED_COMMISSIONING_FEASIBILITY_ERROR,
      );
      expect(UNDATED_COMMISSIONING_FEASIBILITY_ERROR).toMatch(
        /commissioned on a date that was never recorded, so it has no feasibility clock/,
      );
    });

    it("still lets the office clear a date", () => {
      expect(feasibilityDateRefusal(UNDATED, null)).toBeNull();
    });

    it("takes a date once the commissioning instant is recorded", () => {
      expect(
        feasibilityDateRefusal(
          { ...UNDATED, completed_at: "2026-09-25T05:00:00.000Z" },
          "2026-09-01",
        ),
      ).toBeNull();
    });

    it("answers with the commissioning problem even when a cancellation date is also missing", () => {
      // Fixing the cancellation date would not make the date acceptable.
      expect(
        feasibilityDateRefusal(
          { ...UNDATED, cancellation: "cancelled", cancelled_on: null },
          "2025-01-05",
        ),
      ).toBe(UNDATED_COMMISSIONING_FEASIBILITY_ERROR);
    });

    it("a project still in progress is not affected (no completion date yet is normal)", () => {
      expect(feasibilityDateRefusal({ ...LIVE, is_completed: false }, "2026-09-01")).toBeNull();
    });
  });
});

describe("hasUndatedCommissioning", () => {
  it.each([
    [true, null, true],
    [true, "2026-09-25T05:00:00.000Z", false],
    [false, null, false],
    [false, "2026-09-25T05:00:00.000Z", false],
  ] as const)("is_completed %s, completed_at %s: %s", (is_completed, completed_at, expected) => {
    expect(hasUndatedCommissioning({ is_completed, completed_at })).toBe(expected);
  });
});

describe("incentiveTotals", () => {
  it("sums everyone whose incentive is set, and how much of it is still unpaid", () => {
    expect(
      incentiveTotals([
        { incentive: { amount: 2000, paid_on: null } },
        { incentive: { amount: 1500.5, paid_on: "2026-10-01" } },
        { incentive: { amount: null, paid_on: null } },
        { incentive: null },
      ]),
    ).toEqual({ count: 2, total: 3500.5, unpaidCount: 1, unpaidTotal: 2000 });
  });

  it("is null, not zero, when nobody has one (the badge reads 'Not set')", () => {
    expect(incentiveTotals([{ incentive: null }, { incentive: { amount: null, paid_on: null } }])).toEqual({
      count: 0,
      total: null,
      unpaidCount: 0,
      unpaidTotal: 0,
    });
  });

  it("a zero incentive is still a record", () => {
    expect(incentiveTotals([{ incentive: { amount: 0, paid_on: null } }])).toMatchObject({
      count: 1,
      total: 0,
      unpaidCount: 1,
    });
  });
});

describe("unpaidIncentives", () => {
  it("sums what is set and not yet paid, per person", () => {
    const team = [
      { incentive: { amount: 2000, paid_on: null } },
      { incentive: { amount: 1500.5, paid_on: null } },
      { incentive: { amount: 9000, paid_on: "2026-10-01" } },
      { incentive: { amount: null, paid_on: null } },
      { incentive: null },
    ];
    expect(unpaidIncentives(team)).toEqual({ count: 2, total: 3500.5 });
  });

  it("counts a zero incentive that was set (it is still a record)", () => {
    expect(unpaidIncentives([{ incentive: { amount: 0, paid_on: null } }])).toEqual({
      count: 1,
      total: 0,
    });
  });

  it("is empty for a sale with no incentive", () => {
    expect(unpaidIncentives([{ incentive: null }])).toEqual({ count: 0, total: 0 });
  });
});

describe("cancellationImpact", () => {
  const BASE = {
    received: 120000,
    balanceDue: 75000,
    feasibilityDate: null,
    completedAt: null,
    isCompleted: false,
    cancelledOn: TODAY,
    today: TODAY,
    unpaid: { count: 0, total: 0 },
  };

  it("lists what leaves, what stays and what is no longer owed", () => {
    expect(cancellationImpact(BASE)).toEqual([
      "Leaves the active pipeline and KPIs",
      `${formatCurrency(120000)} collected stays in the ledger`,
      `${formatCurrency(75000)} balance is no longer counted as outstanding`,
    ]);
  });

  it("stays quiet about money that does not exist", () => {
    expect(cancellationImpact({ ...BASE, received: 0, balanceDue: 0 })).toEqual([
      "Leaves the active pipeline and KPIs",
    ]);
  });

  it("says the feasibility clock stops, and what renewals it already cost", () => {
    // 39 days from the feasibility date to the day it stops: one renewal.
    const lines = cancellationImpact({ ...BASE, feasibilityDate: "2026-09-01" });
    expect(lines).toContain(
      `The feasibility clock stops (${formatCurrency(1000)} of renewals already borne stays a cost)`,
    );
    // Inside the first 30 days nothing has been renewed yet.
    expect(
      cancellationImpact({ ...BASE, feasibilityDate: "2026-09-20" }),
    ).toContain("The feasibility clock stops");
  });

  it("reads the clock to the date chosen, not to today", () => {
    const lines = cancellationImpact({
      ...BASE,
      feasibilityDate: "2026-09-01",
      cancelledOn: "2026-09-10",
    });
    expect(lines).toContain("The feasibility clock stops");
  });

  it("falls back to today for a date that is not a date", () => {
    const lines = cancellationImpact({
      ...BASE,
      feasibilityDate: "2026-09-01",
      cancelledOn: "",
    });
    expect(lines.join(" ")).toContain(formatCurrency(1000));
  });

  it("says nothing about the clock of a commissioned project (it stopped already)", () => {
    const lines = cancellationImpact({
      ...BASE,
      feasibilityDate: "2026-09-01",
      isCompleted: true,
      completedAt: "2026-09-20T06:00:00Z",
    });
    expect(lines.join(" ")).not.toMatch(/feasibility/i);
  });

  it("warns that unpaid incentives stay owed", () => {
    expect(
      cancellationImpact({ ...BASE, unpaid: { count: 2, total: 5500 } }).at(-1),
    ).toBe(
      `2 unpaid incentives (${formatCurrency(5500)}) stay owed — clear them under Coordinator incentives if they won't be paid`,
    );
    expect(
      cancellationImpact({ ...BASE, unpaid: { count: 1, total: 2000 } }).at(-1),
    ).toBe(
      `1 unpaid incentive (${formatCurrency(2000)}) stays owed — clear it under Coordinator incentives if it won't be paid`,
    );
  });
});

describe("reinstateClockImpact", () => {
  const CANCELLED = {
    feasibilityDate: "2026-01-01",
    completedAt: null,
    isCompleted: false,
    cancelledOn: "2026-02-01",
    today: TODAY,
  };

  it("shows what the cancelled stretch would cost as renewals once the clock reopens", () => {
    // Stopped after 31 days: 1 renewal (₹1,000). Reopened to 2026-10-10: 282 days, 9 renewals.
    expect(reinstateClockImpact(CANCELLED)).toEqual({
      feasibilityDate: "2026-01-01",
      costNow: 1000,
      costReopened: 9000,
    });
  });

  it("is null when the reopened clock costs the same", () => {
    // Cancelled a week ago, within the same validity period as today.
    expect(
      reinstateClockImpact({ ...CANCELLED, feasibilityDate: "2026-10-01", cancelledOn: "2026-10-03" }),
    ).toBeNull();
  });

  it("is null without a feasibility date (nothing runs)", () => {
    expect(reinstateClockImpact({ ...CANCELLED, feasibilityDate: null })).toBeNull();
  });

  it("is null for a commissioned project: its clock stopped at commissioning, whatever happens", () => {
    expect(
      reinstateClockImpact({
        ...CANCELLED,
        isCompleted: true,
        completedAt: "2026-01-20T06:00:00Z",
      }),
    ).toBeNull();
  });
});
