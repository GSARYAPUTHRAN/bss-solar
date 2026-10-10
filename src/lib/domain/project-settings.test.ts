import { describe, it, expect } from "vitest";
import {
  incentiveChanged,
  MAX_INCENTIVE,
  parseProjectSettings,
  type ProjectSettingsInput,
} from "./project-settings";

const TODAY = "2026-10-10";
const EMPTY: ProjectSettingsInput = {
  feasibilityDate: null,
  incentive: null,
  incentivePaidOn: null,
};

function parse(input: Partial<ProjectSettingsInput>) {
  return parseProjectSettings({ ...EMPTY, ...input }, TODAY);
}

function errorOf(input: Partial<ProjectSettingsInput>): string | null {
  const res = parse(input);
  return res.ok ? null : res.error;
}

describe("parseProjectSettings", () => {
  it("accepts an all-empty form as 'clear everything'", () => {
    expect(parse({})).toEqual({
      ok: true,
      data: { feasibility_date: null, coordinator_incentive: null, incentive_paid_on: null },
    });
  });

  it("accepts a complete, valid form", () => {
    expect(
      parse({ feasibilityDate: "2026-09-01", incentive: "2500", incentivePaidOn: TODAY }),
    ).toEqual({
      ok: true,
      data: {
        feasibility_date: "2026-09-01",
        coordinator_incentive: 2500,
        incentive_paid_on: TODAY,
      },
    });
  });

  describe("feasibility date", () => {
    it("allows today", () => {
      expect(errorOf({ feasibilityDate: TODAY })).toBeNull();
    });

    it("rejects a date in the future", () => {
      expect(errorOf({ feasibilityDate: "2026-10-11" })).toMatch(/future/);
    });

    it.each(["2026-02-30", "10/10/2026", "2026-1-5", "yesterday"])(
      "rejects %s as not a real ISO date",
      (value) => {
        expect(errorOf({ feasibilityDate: value })).toMatch(/valid date/);
      },
    );
  });

  describe("incentive", () => {
    it("allows zero", () => {
      const res = parse({ incentive: "0" });
      expect(res.ok && res.data.coordinator_incentive).toBe(0);
    });

    it("tolerates separators, spaces and a rupee sign", () => {
      const res = parse({ incentive: "₹ 1,25,000.50" });
      expect(res.ok && res.data.coordinator_incentive).toBe(125000.5);
    });

    it("rounds to paise", () => {
      const res = parse({ incentive: "99.999" });
      expect(res.ok && res.data.coordinator_incentive).toBe(100);
    });

    it("rejects a negative amount", () => {
      expect(errorOf({ incentive: "-1" })).toMatch(/negative/);
    });

    it.each(["abc", "1e5", "12.", "2,5,0a", "NaN", "Infinity"])(
      "rejects %s as not an amount",
      (value) => {
        expect(errorOf({ incentive: value })).toMatch(/amount in rupees/);
      },
    );

    it("rejects an amount the column cannot hold", () => {
      expect(errorOf({ incentive: String(MAX_INCENTIVE + 1) })).toMatch(/too large/);
      expect(errorOf({ incentive: String(MAX_INCENTIVE) })).toBeNull();
    });
  });

  describe("incentive paid on", () => {
    it("needs an incentive to have been paid", () => {
      expect(errorOf({ incentivePaidOn: "2026-10-01" })).toMatch(/incentive amount/);
    });

    it("rejects a future date", () => {
      expect(errorOf({ incentive: "1000", incentivePaidOn: "2026-12-01" })).toMatch(
        /future/,
      );
    });

    it("rejects an invalid date", () => {
      expect(errorOf({ incentive: "1000", incentivePaidOn: "2026-13-01" })).toMatch(
        /valid date/,
      );
    });
  });

  it("reports the first problem in form order", () => {
    expect(errorOf({ feasibilityDate: "nope", incentive: "-5" })).toMatch(/Feasibility/);
  });
});

describe("incentiveChanged", () => {
  const SET = { coordinator_incentive: 3000, incentive_paid_on: null };

  it("is false when nothing about the incentive changed", () => {
    expect(incentiveChanged(SET, { ...SET })).toBe(false);
  });

  it("treats a numeric string from the database as the same amount", () => {
    const fromDb = { coordinator_incentive: "3000.00" as unknown as number, incentive_paid_on: null };
    expect(incentiveChanged(fromDb, SET)).toBe(false);
  });

  it("detects a new, changed or removed amount", () => {
    const none = { coordinator_incentive: null, incentive_paid_on: null };
    expect(incentiveChanged(none, SET)).toBe(true);
    expect(incentiveChanged(SET, { ...SET, coordinator_incentive: 3500 })).toBe(true);
    expect(incentiveChanged(SET, none)).toBe(true);
  });

  it("detects the incentive being marked paid (or unpaid)", () => {
    const paid = { ...SET, incentive_paid_on: "2026-10-09" };
    expect(incentiveChanged(SET, paid)).toBe(true);
    expect(incentiveChanged(paid, SET)).toBe(true);
  });
});
