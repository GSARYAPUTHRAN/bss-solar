import { describe, it, expect } from "vitest";
import { addDays, diffDays, isIsoDate, istDateOf } from "./dates";

describe("isIsoDate", () => {
  it.each(["2026-01-01", "2026-12-31", "2024-02-29", "2000-02-29", "1999-12-31"])(
    "accepts the real calendar date %s",
    (value) => {
      expect(isIsoDate(value)).toBe(true);
    },
  );

  it.each([
    ["2026-02-29", "not a leap year"],
    ["2100-02-29", "century years are not leap years unless ÷400"],
    ["2026-02-30", "February has no 30th"],
    ["2026-04-31", "April has 30 days"],
    ["2026-13-01", "month 13"],
    ["2026-00-10", "month 0"],
    ["2026-01-00", "day 0"],
    ["2026-01-32", "day 32"],
  ])("rejects %s (%s)", (value) => {
    expect(isIsoDate(value)).toBe(false);
  });

  it.each([
    "2026-1-1",
    "2026-01-1",
    "26-01-01",
    "2026/01/01",
    "01-01-2026",
    "2026-01-01T00:00:00Z",
    " 2026-01-01",
    "2026-01-01 ",
    "2026-01-01\n",
    "２０２６-01-01",
  ])("rejects the non-strict shape %j", (value) => {
    expect(isIsoDate(value)).toBe(false);
  });

  it.each([[null], [undefined], [""]])("rejects %j", (value) => {
    expect(isIsoDate(value)).toBe(false);
  });
});

describe("diffDays", () => {
  it("is zero for the same day", () => {
    expect(diffDays("2026-10-10", "2026-10-10")).toBe(0);
  });

  it("counts whole days across a month boundary", () => {
    expect(diffDays("2026-01-31", "2026-02-01")).toBe(1);
    expect(diffDays("2026-01-01", "2026-03-02")).toBe(60);
  });

  it("counts across a year boundary", () => {
    expect(diffDays("2026-12-31", "2027-01-01")).toBe(1);
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("counts the leap day", () => {
    expect(diffDays("2024-02-28", "2024-03-01")).toBe(2);
    expect(diffDays("2026-02-28", "2026-03-01")).toBe(1);
    expect(diffDays("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("is negative when the end is earlier", () => {
    expect(diffDays("2026-02-01", "2026-01-31")).toBe(-1);
    expect(diffDays("2027-01-01", "2026-01-01")).toBe(-365);
  });

  it("is unaffected by daylight-saving style shifts (pure UTC days)", () => {
    // Late March / late October are DST changes in many zones; IST has none,
    // and the maths must not depend on the host time zone either.
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
    expect(diffDays("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("throws on a malformed date instead of returning NaN", () => {
    expect(() => diffDays("2026-02-30", "2026-03-01")).toThrow(RangeError);
    expect(() => diffDays("2026-03-01", "garbage")).toThrow(RangeError);
  });
});

describe("addDays", () => {
  it("rolls over month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", 30)).toBe("2026-01-31");
    expect(addDays("2026-01-01", 60)).toBe("2026-03-02");
  });

  it("lands on the leap day only in leap years", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("goes backwards with a negative span", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("is the inverse of diffDays", () => {
    const from = "2025-11-17";
    for (const span of [-400, -31, -1, 0, 1, 29, 30, 31, 365, 366, 1000]) {
      expect(diffDays(from, addDays(from, span))).toBe(span);
    }
  });

  it("throws on a malformed date", () => {
    expect(() => addDays("2026-13-01", 1)).toThrow(RangeError);
  });
});

describe("istDateOf", () => {
  it("moves an evening UTC instant to the next IST day", () => {
    expect(istDateOf("2026-01-01T19:00:00Z")).toBe("2026-01-02");
  });

  it("switches exactly at IST midnight (18:30 UTC)", () => {
    expect(istDateOf("2026-01-01T18:29:59.999Z")).toBe("2026-01-01");
    expect(istDateOf("2026-01-01T18:30:00Z")).toBe("2026-01-02");
  });

  it("crosses a year boundary", () => {
    expect(istDateOf("2026-12-31T20:00:00Z")).toBe("2027-01-01");
  });

  it("keeps an early-morning UTC instant on the same day", () => {
    expect(istDateOf("2026-01-01T00:00:00Z")).toBe("2026-01-01");
  });

  it("reads PostgREST timestamptz strings (offset + microseconds)", () => {
    expect(istDateOf("2026-01-01T19:00:00.123456+00:00")).toBe("2026-01-02");
    expect(istDateOf("2026-01-02T00:30:00+05:30")).toBe("2026-01-02");
  });

  it("accepts a Date", () => {
    expect(istDateOf(new Date(Date.UTC(2026, 0, 1, 19)))).toBe("2026-01-02");
  });

  it("returns a strict ISO date", () => {
    expect(isIsoDate(istDateOf("2026-06-15T10:00:00Z"))).toBe(true);
  });
});
