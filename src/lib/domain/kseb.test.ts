import { describe, it, expect } from "vitest";
import { addDays } from "./dates";
import {
  FEASIBILITY_WARNING_DAYS,
  KSEB_FEES,
  customerKsebFees,
  feasibilityPeriods,
  feasibilityStatus,
  registrationFee,
} from "./kseb";

const START = "2026-01-01";
/** The date `days` after the feasibility start. */
const day = (days: number) => addDays(START, days);

describe("KSEB_FEES", () => {
  it("encodes the charges agreed with BSS", () => {
    expect(KSEB_FEES).toEqual({
      feasibilityFee: 1000,
      feasibilityValidityDays: 30,
      feasibilityRenewalFee: 1000,
      registrationFeePerKw: 1000,
      gstRate: 0.18,
    });
    expect(FEASIBILITY_WARNING_DAYS).toBe(7);
  });
});

describe("registrationFee", () => {
  it("charges ₹1,000 per kW plus 18% GST", () => {
    expect(registrationFee(3)).toEqual({ kw: 3, base: 3000, gst: 540, total: 3540 });
  });

  it("prices fractional capacities", () => {
    expect(registrationFee(3.5)).toEqual({ kw: 3.5, base: 3500, gst: 630, total: 4130 });
    expect(registrationFee(0.5)).toEqual({ kw: 0.5, base: 500, gst: 90, total: 590 });
  });

  it("absorbs binary noise to whole paise (2.07 × 1000 is 2069.9999… in floats)", () => {
    expect(registrationFee(2.07)).toEqual({ kw: 2.07, base: 2070, gst: 372.6, total: 2442.6 });
    expect(registrationFee(1.11)).toEqual({ kw: 1.11, base: 1110, gst: 199.8, total: 1309.8 });
    expect(registrationFee(0.33)).toEqual({ kw: 0.33, base: 330, gst: 59.4, total: 389.4 });
  });

  it("rounds GST to the paisa", () => {
    // 0.0025 kW → ₹2.50 base → GST ₹0.45.
    expect(registrationFee(0.0025)).toEqual({ kw: 0.0025, base: 2.5, gst: 0.45, total: 2.95 });
    // 1.23456 kW → ₹1,234.56 base → GST 222.2208 → ₹222.22.
    expect(registrationFee(1.23456)).toEqual({
      kw: 1.23456,
      base: 1234.56,
      gst: 222.22,
      total: 1456.78,
    });
  });

  it("accepts the numeric string PostgREST returns for plant_capacity_kw", () => {
    expect(registrationFee("5.00")).toEqual({ kw: 5, base: 5000, gst: 900, total: 5900 });
  });

  it.each([
    [0],
    [-3],
    ["0"],
    ["-3"],
    [""],
    ["   "],
    ["abc"],
    ["3kW"],
    [null],
    [undefined],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
  ])("is null when the capacity cannot be priced: %j", (kw) => {
    expect(registrationFee(kw)).toBeNull();
  });
});

describe("customerKsebFees", () => {
  it("adds the ₹1,000 feasibility fee to the registration", () => {
    expect(customerKsebFees(3)).toEqual({
      feasibility: 1000,
      registration: { kw: 3, base: 3000, gst: 540, total: 3540 },
      total: 4540,
    });
  });

  it("still states the feasibility fee when the capacity is unknown", () => {
    for (const kw of [null, undefined, 0, -1, "abc"]) {
      expect(customerKsebFees(kw)).toEqual({ feasibility: 1000, registration: null, total: null });
    }
  });

  it("keeps the total to the paisa", () => {
    expect(customerKsebFees(1.23456).total).toBe(2456.78);
    expect(customerKsebFees("2.07").total).toBe(3442.6);
  });
});

describe("feasibilityPeriods", () => {
  it.each([
    [0, 1],
    [1, 1],
    [29, 1],
    [30, 1],
    [31, 2],
    [59, 2],
    [60, 2],
    [61, 3],
    [90, 3],
    [91, 4],
    [365, 13],
  ])("day %i of the clock is period %i", (elapsed, periods) => {
    expect(feasibilityPeriods(START, day(elapsed))).toBe(periods);
  });

  it("counts a future start as the first period", () => {
    expect(feasibilityPeriods(START, day(-1))).toBe(1);
    expect(feasibilityPeriods(START, day(-400))).toBe(1);
  });

  it("is calendar-aware across a leap year", () => {
    // 2024-02-01 + 30 = 2024-03-02 (29-day February).
    expect(feasibilityPeriods("2024-02-01", "2024-03-02")).toBe(1);
    expect(feasibilityPeriods("2024-02-01", "2024-03-03")).toBe(2);
  });

  it("throws on a malformed date", () => {
    expect(() => feasibilityPeriods("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});

describe("feasibilityStatus — not set", () => {
  it.each([[null], [undefined], [""]])("is not_set for %j", (feasibilityDate) => {
    expect(feasibilityStatus({ feasibilityDate, today: "2026-10-10" })).toEqual({
      state: "not_set",
      periods: null,
      renewals: 0,
      validUntil: null,
      daysLeft: null,
      extensionCost: 0,
    });
  });

  it("is not_set even for a commissioned project", () => {
    expect(
      feasibilityStatus({
        feasibilityDate: null,
        completedAt: "2026-02-01T10:00:00Z",
        isCompleted: true,
        today: "2026-10-10",
      }).state,
    ).toBe("not_set");
  });
});

describe("feasibilityStatus — active clock", () => {
  const at = (elapsed: number) =>
    feasibilityStatus({ feasibilityDate: START, today: day(elapsed) });

  it("is on_track on the feasibility day itself, with the full validity left", () => {
    expect(at(0)).toEqual({
      state: "on_track",
      periods: 1,
      renewals: 0,
      validUntil: "2026-01-31",
      daysLeft: 30,
      extensionCost: 0,
    });
  });

  it("stays on_track until more than 7 days are left", () => {
    expect(at(22)).toMatchObject({ state: "on_track", daysLeft: 8 });
  });

  it("is expiring with exactly 7 days left", () => {
    expect(at(23)).toMatchObject({ state: "expiring", daysLeft: FEASIBILITY_WARNING_DAYS });
  });

  it("is expiring on the last valid day with 0 days left and no renewal yet", () => {
    expect(at(30)).toEqual({
      state: "expiring",
      periods: 1,
      renewals: 0,
      validUntil: "2026-01-31",
      daysLeft: 0,
      extensionCost: 0,
    });
  });

  it("is extended the day after the first validity lapses — BSS pays ₹1,000", () => {
    expect(at(31)).toEqual({
      state: "extended",
      periods: 2,
      renewals: 1,
      validUntil: "2026-03-02",
      daysLeft: 29,
      extensionCost: 1000,
    });
  });

  it("prefers expiring over extended when a renewed period is about to lapse", () => {
    expect(at(59)).toMatchObject({ state: "expiring", renewals: 1, daysLeft: 1 });
    expect(at(60)).toMatchObject({ state: "expiring", renewals: 1, daysLeft: 0 });
  });

  it("charges one renewal per further period", () => {
    expect(at(61)).toEqual({
      state: "extended",
      periods: 3,
      renewals: 2,
      validUntil: "2026-04-01",
      daysLeft: 29,
      extensionCost: 2000,
    });
    expect(at(365)).toMatchObject({ periods: 13, renewals: 12, extensionCost: 12000 });
  });

  it("never reports negative days left while the clock runs", () => {
    for (let elapsed = -45; elapsed <= 400; elapsed++) {
      const s = at(elapsed);
      expect(s.daysLeft).not.toBeNull();
      expect(s.daysLeft!).toBeGreaterThanOrEqual(0);
      expect(s.daysLeft!).toBeLessThanOrEqual(
        KSEB_FEES.feasibilityValidityDays + Math.max(0, -elapsed),
      );
    }
  });

  it("keeps validUntil = start + 30 × periods and cost = renewals × ₹1,000", () => {
    for (let elapsed = 0; elapsed <= 200; elapsed++) {
      const s = at(elapsed);
      expect(s.validUntil).toBe(addDays(START, 30 * s.periods!));
      expect(s.renewals).toBe(s.periods! - 1);
      expect(s.extensionCost).toBe(s.renewals * KSEB_FEES.feasibilityRenewalFee);
    }
  });

  it("treats a future feasibility date as on_track for its first period", () => {
    // Starts 31 days after today: valid until start + 30.
    expect(feasibilityStatus({ feasibilityDate: day(31), today: START })).toEqual({
      state: "on_track",
      periods: 1,
      renewals: 0,
      validUntil: day(61),
      daysLeft: 61,
      extensionCost: 0,
    });
  });

  it("does not treat an explicit isCompleted=false as closed", () => {
    expect(
      feasibilityStatus({ feasibilityDate: START, isCompleted: false, completedAt: null, today: day(5) })
        .state,
    ).toBe("on_track");
  });
});

describe("feasibilityStatus — commissioned (clock stopped)", () => {
  it("freezes the clock at the commissioning date, not today", () => {
    expect(
      feasibilityStatus({
        feasibilityDate: START,
        completedAt: "2026-01-20T06:00:00Z",
        isCompleted: true,
        today: "2026-10-10",
      }),
    ).toEqual({
      state: "closed",
      periods: 1,
      renewals: 0,
      validUntil: "2026-01-31",
      daysLeft: null,
      extensionCost: 0,
    });
  });

  it("reads completedAt as its IST calendar date", () => {
    // 2026-03-02T19:00Z is 00:30 on 2026-03-03 in IST — day 61, a third period.
    // Reading the UTC date (day 60) would under-count BSS's renewal cost.
    expect(
      feasibilityStatus({
        feasibilityDate: START,
        completedAt: "2026-03-02T19:00:00Z",
        isCompleted: true,
        today: "2026-10-10",
      }),
    ).toMatchObject({ state: "closed", periods: 3, renewals: 2, extensionCost: 2000 });

    expect(
      feasibilityStatus({
        feasibilityDate: START,
        completedAt: "2026-03-02T18:29:59Z",
        isCompleted: true,
        today: "2026-10-10",
      }),
    ).toMatchObject({ state: "closed", periods: 2, renewals: 1, extensionCost: 1000 });
  });

  it("is closed rather than expiring, even inside the warning window", () => {
    expect(
      feasibilityStatus({
        feasibilityDate: START,
        completedAt: "2026-01-29T06:00:00Z",
        isCompleted: true,
        today: day(29),
      }),
    ).toMatchObject({ state: "closed", daysLeft: null });
  });

  it("closes on isCompleted alone, running the clock to today (as the SQL view does)", () => {
    expect(
      feasibilityStatus({
        feasibilityDate: START,
        completedAt: null,
        isCompleted: true,
        today: day(45),
      }),
    ).toMatchObject({ state: "closed", periods: 2, renewals: 1, daysLeft: null });
  });

  it("closes on completedAt alone", () => {
    expect(
      feasibilityStatus({
        feasibilityDate: START,
        completedAt: "2026-01-10T06:00:00Z",
        today: day(45),
      }),
    ).toMatchObject({ state: "closed", periods: 1, renewals: 0 });
  });

  it("counts a commissioning before the feasibility date as the first period", () => {
    expect(
      feasibilityStatus({
        feasibilityDate: START,
        completedAt: "2025-12-01T06:00:00Z",
        isCompleted: true,
        today: "2026-10-10",
      }),
    ).toMatchObject({ state: "closed", periods: 1, renewals: 0, extensionCost: 0 });
  });
});
