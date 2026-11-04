import { describe, it, expect } from "vitest";
import {
  addDays,
  diffDays,
  isIsoDate,
  istDateOf,
  monthKey,
  monthName,
  parseDateText,
} from "./dates";

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

describe("parseDateText — dates are day first", () => {
  const ok = (iso: string, dayFirst: boolean) => ({ ok: true, iso, dayFirst });

  it("keeps ISO as it is, and says it was not read day first", () => {
    expect(parseDateText("2025-02-13")).toEqual(ok("2025-02-13", false));
    expect(parseDateText("  2025-02-13  ")).toEqual(ok("2025-02-13", false));
  });

  it.each([
    ["13/02/2025", "2025-02-13"],
    ["13-02-2025", "2025-02-13"],
    ["13.02.2025", "2025-02-13"],
    ["3/2/2025", "2025-02-03"],
    ["03/02/2025", "2025-02-03"],
    ["13/02/25", "2025-02-13"],
    ["3/2/25", "2025-02-03"],
    ["  13/02/2025 ", "2025-02-13"],
  ])("reads %s as %s", (written, iso) => {
    expect(parseDateText(written)).toEqual(ok(iso, true));
  });

  // The clerk's Excel (US locale) shows 4 February as 04-02-25: it must still
  // be 4 February, never 2 April.
  it("never reads a date month first", () => {
    expect(parseDateText("04/02/2025")).toEqual(ok("2025-02-04", true));
    expect(parseDateText("04-02-25")).toEqual(ok("2025-02-04", true));
    expect(parseDateText("02/04/2025")).toEqual(ok("2025-04-02", true));
  });

  it("puts a two-digit year of 00-69 in the 2000s and 70-99 in the 1900s", () => {
    expect(parseDateText("01/01/00")).toEqual(ok("2000-01-01", true));
    expect(parseDateText("01/01/69")).toEqual(ok("2069-01-01", true));
    expect(parseDateText("01/01/70")).toEqual(ok("1970-01-01", true));
    expect(parseDateText("31/12/99")).toEqual(ok("1999-12-31", true));
  });

  it("knows leap days in either shape", () => {
    expect(parseDateText("29/02/2024")).toEqual(ok("2024-02-29", true));
    expect(parseDateText("29/02/24")).toEqual(ok("2024-02-29", true));
    expect(parseDateText("2024-02-29")).toEqual(ok("2024-02-29", false));
  });

  it.each(["31/04/2025", "29/02/2025", "00/01/2025", "01/00/2025", "32/01/2025", "13/13/2025"])(
    "refuses %s as a day that does not exist",
    (written) => {
      expect(parseDateText(written)).toMatchObject({ ok: false, problem: "not_real" });
    },
  );

  it("refuses an ISO-shaped date that does not exist", () => {
    expect(parseDateText("2025-02-30")).toEqual({
      ok: false,
      problem: "not_real",
      swapped: null,
    });
  });

  it("offers the swapped reading as a question when only that one is a real date", () => {
    // 02/13/2025 is no day-first date; swapped it is 13 February.
    expect(parseDateText("02/13/2025")).toEqual({
      ok: false,
      problem: "not_real",
      swapped: "2025-02-13",
    });
    expect(parseDateText("31/04/2025")).toMatchObject({ swapped: null });
  });

  it.each([
    "",
    "   ",
    "tomorrow",
    "2025/02/13",
    "2025-2-13",
    "13/02-2025",
    "13-02.2025",
    "13/2",
    "13/02/202",
    "13/02/20255",
    "130/02/2025",
    "13/02/2025 10:00",
    "13/02/2025+14/02/2025",
    "１３/02/2025",
  ])("cannot read %j", (written) => {
    expect(parseDateText(written)).toEqual({ ok: false, problem: "unreadable", swapped: null });
  });
});

describe("monthKey / monthName", () => {
  it("takes the calendar month of an ISO date", () => {
    expect(monthKey("2025-02-13")).toBe("2025-02");
    expect(monthKey("2025-12-01")).toBe("2025-12");
  });

  it("names a month in English", () => {
    expect(monthName("2025-02")).toBe("February 2025");
    expect(monthName("2024-12")).toBe("December 2024");
    expect(monthName("2025-01")).toBe("January 2025");
  });
});
