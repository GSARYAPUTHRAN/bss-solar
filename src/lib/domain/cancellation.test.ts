import { describe, it, expect } from "vitest";
import {
  CANCELLATION,
  CANCELLATIONS,
  CANCELLATION_DATE_REQUIRED_ERROR,
  CANCELLATION_REMARKS_MAX,
  isCancellation,
  isCancelled,
  parseCancellation,
  parseRemarks,
  progressLockedReason,
} from "./cancellation";

const TODAY = "2026-10-22";
const ORDER = "2025-01-13";

type Ctx = Parameters<typeof parseCancellation>[1];
const ctx = (overrides: Partial<Ctx> = {}): Ctx => ({
  today: TODAY,
  orderDate: ORDER,
  hasFeasibilityDate: false,
  ...overrides,
});
const input = (
  overrides: Partial<Parameters<typeof parseCancellation>[0]> = {},
): Parameters<typeof parseCancellation>[0] => ({
  cancellation: "refunded",
  cancelledOn: "2025-02-12",
  remarks: null,
  ...overrides,
});

/** The data of a successful parse; fails the test otherwise. */
function parsed(i: ReturnType<typeof input>, c: Ctx = ctx()) {
  const result = parseCancellation(i, c);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.data;
}
/** The error of a refused parse; fails the test otherwise. */
function refused(i: ReturnType<typeof input>, c: Ctx = ctx()) {
  const result = parseCancellation(i, c);
  if (result.ok) throw new Error(`expected an error, got: ${JSON.stringify(result.data)}`);
  return result.error;
}

describe("CANCELLATIONS / CANCELLATION", () => {
  it("has the two ways a project leaves the pipeline, labelled for badges", () => {
    expect([...CANCELLATIONS]).toEqual(["cancelled", "refunded"]);
    expect(CANCELLATION.cancelled.label).toBe("Cancelled");
    expect(CANCELLATION.refunded.label).toBe("Refunded");
    // Refunds stand out; a plain cancellation is neutral.
    expect(CANCELLATION.refunded.badgeClass).toMatch(/red/);
    expect(CANCELLATION.cancelled.badgeClass).toMatch(/gray/);
  });

  it("caps remarks at 2000 characters, as the database does", () => {
    expect(CANCELLATION_REMARKS_MAX).toBe(2000);
  });
});

describe("isCancellation / isCancelled", () => {
  it("accepts only the two values", () => {
    expect(isCancellation("cancelled")).toBe(true);
    expect(isCancellation("refunded")).toBe(true);
    for (const v of ["", "canceled", "Refunded", "active", null, undefined]) {
      expect(isCancellation(v)).toBe(false);
    }
  });

  it("is true for a row with a cancellation, false while live", () => {
    expect(isCancelled({ cancellation: "cancelled" })).toBe(true);
    expect(isCancelled({ cancellation: "refunded" })).toBe(true);
    expect(isCancelled({ cancellation: null })).toBe(false);
    expect(isCancelled({})).toBe(false);
  });
});

describe("parseRemarks", () => {
  it("trims, and treats blank as none", () => {
    expect(parseRemarks("  Refunded ₹1,50,000 by bank transfer  ")).toEqual({
      ok: true,
      data: "Refunded ₹1,50,000 by bank transfer",
    });
    for (const blank of [null, "", "   ", "\n\t"]) {
      expect(parseRemarks(blank)).toEqual({ ok: true, data: null });
    }
  });

  it("keeps line breaks inside the text", () => {
    expect(parseRemarks("line one\nline two")).toEqual({
      ok: true,
      data: "line one\nline two",
    });
  });

  it("allows exactly 2000 characters and refuses more", () => {
    expect(parseRemarks("a".repeat(2000)).ok).toBe(true);
    expect(parseRemarks("a".repeat(2001))).toEqual({
      ok: false,
      error: "Remarks can be at most 2000 characters.",
    });
  });

  it("counts after trimming", () => {
    expect(parseRemarks(`  ${"a".repeat(2000)}  `).ok).toBe(true);
  });
});

describe("parseCancellation — the kind", () => {
  it.each(["cancelled", "refunded"])("accepts %s", (kind) => {
    expect(parsed(input({ cancellation: kind })).cancellation).toBe(kind);
  });

  it.each([null, "", "  ", "canceled", "active", "REFUNDED"])("refuses %j", (kind) => {
    expect(refused(input({ cancellation: kind }))).toBe("Choose Cancelled or Refunded.");
  });
});

describe("parseCancellation — a date that was filled in", () => {
  it("accepts a date between the order date and today", () => {
    expect(parsed(input({ cancelledOn: "2025-02-12" })).cancelled_on).toBe("2025-02-12");
    expect(parsed(input({ cancelledOn: ORDER })).cancelled_on).toBe(ORDER);
    expect(parsed(input({ cancelledOn: TODAY })).cancelled_on).toBe(TODAY);
  });

  it("trims the date", () => {
    expect(parsed(input({ cancelledOn: " 2025-02-12 " })).cancelled_on).toBe("2025-02-12");
  });

  it.each(["12/02/2025", "2025-02-30", "2025-2-1", "yesterday", "2025-13-01"])(
    "refuses %j as not a date",
    (date) => {
      expect(refused(input({ cancelledOn: date }))).toBe("Enter a valid date.");
    },
  );

  it("refuses a date in the future", () => {
    expect(refused(input({ cancelledOn: "2026-10-23" }))).toBe(
      "The date cannot be in the future.",
    );
  });

  it("refuses a date before the order date, naming it", () => {
    expect(refused(input({ cancelledOn: "2025-01-12" }))).toBe(
      "The date cannot be before the order date (2025-01-13).",
    );
  });

  it("checks a filled date even when editing an existing cancellation", () => {
    const previous = { cancellation: "refunded", cancelled_on: "2025-02-12" } as const;
    expect(refused(input({ cancelledOn: "2024-12-01" }), ctx({ previous }))).toMatch(
      /before the order date/,
    );
    expect(refused(input({ cancelledOn: "2027-01-01" }), ctx({ previous }))).toMatch(
      /in the future/,
    );
  });

  it("checks the date before the remarks", () => {
    expect(
      refused(input({ cancelledOn: "2999-01-01", remarks: "x".repeat(2001) })),
    ).toMatch(/in the future/);
  });
});

describe("parseCancellation — a blank date, newly cancelling", () => {
  it("is today when there is no previous record", () => {
    expect(parsed(input({ cancelledOn: null })).cancelled_on).toBe(TODAY);
    expect(parsed(input({ cancelledOn: "" })).cancelled_on).toBe(TODAY);
    expect(parsed(input({ cancelledOn: "  " })).cancelled_on).toBe(TODAY);
  });

  it("is today when the previous state was live (a reinstated project cancelled again)", () => {
    const previous = { cancellation: null, cancelled_on: null };
    expect(parsed(input({ cancelledOn: null }), ctx({ previous })).cancelled_on).toBe(TODAY);
    expect(parsed(input({ cancelledOn: null }), ctx({ previous: null })).cancelled_on).toBe(
      TODAY,
    );
  });

  it("is today even when the project has a running feasibility clock", () => {
    expect(
      parsed(input({ cancelledOn: null }), ctx({ hasFeasibilityDate: true })).cancelled_on,
    ).toBe(TODAY);
  });

  it("is refused when the order date is after today — there is no valid date to default to", () => {
    expect(refused(input({ cancelledOn: null }), ctx({ orderDate: "2026-12-01" }))).toBe(
      "The date cannot be before the order date (2026-12-01).",
    );
  });
});

describe("parseCancellation — a blank date, editing an existing cancellation", () => {
  const recorded = { cancellation: "cancelled", cancelled_on: "2025-02-12" } as const;
  const unrecorded = { cancellation: "refunded", cancelled_on: null } as const;

  it("keeps the recorded date", () => {
    const data = parsed(
      input({ cancellation: "refunded", cancelledOn: null, remarks: "Refunded in full" }),
      ctx({ previous: recorded }),
    );
    expect(data).toEqual({
      cancellation: "refunded",
      cancelled_on: "2025-02-12",
      cancellation_remarks: "Refunded in full",
    });
  });

  it("keeps a recorded date even if it would no longer pass today's checks", () => {
    // Recorded before the order date was corrected: history, left alone.
    const data = parsed(
      input({ cancelledOn: null }),
      ctx({ previous: { cancellation: "cancelled", cancelled_on: "2024-06-01" } }),
    );
    expect(data.cancelled_on).toBe("2024-06-01");
  });

  it("keeps an unrecorded (NULL) date as NULL when there is no feasibility clock", () => {
    const data = parsed(input({ cancelledOn: null, remarks: "REFUNDED" }), ctx({ previous: unrecorded }));
    expect(data.cancelled_on).toBeNull();
    expect(data.cancellation_remarks).toBe("REFUNDED");
  });

  it("never invents today's date for an unrecorded one", () => {
    expect(parsed(input({ cancelledOn: "" }), ctx({ previous: unrecorded })).cancelled_on).not.toBe(
      TODAY,
    );
  });

  it("refuses to leave the date NULL when the feasibility clock runs", () => {
    expect(
      refused(input({ cancelledOn: null }), ctx({ previous: unrecorded, hasFeasibilityDate: true })),
    ).toBe(CANCELLATION_DATE_REQUIRED_ERROR);
    expect(CANCELLATION_DATE_REQUIRED_ERROR).toBe(
      "Enter the date it was cancelled — it stops the feasibility clock.",
    );
  });

  it("accepts a date typed for a clock that has none recorded", () => {
    expect(
      parsed(
        input({ cancelledOn: "2025-02-12" }),
        ctx({ previous: unrecorded, hasFeasibilityDate: true }),
      ).cancelled_on,
    ).toBe("2025-02-12");
  });

  it("lets a cancelled project become refunded, keeping the date", () => {
    expect(
      parsed(input({ cancellation: "refunded", cancelledOn: null }), ctx({ previous: recorded }))
        .cancellation,
    ).toBe("refunded");
  });
});

describe("parseCancellation — remarks", () => {
  it("carries trimmed remarks, or null when blank", () => {
    expect(parsed(input({ remarks: "  refunded by UPI  " })).cancellation_remarks).toBe(
      "refunded by UPI",
    );
    expect(parsed(input({ remarks: "   " })).cancellation_remarks).toBeNull();
    expect(parsed(input({ remarks: null })).cancellation_remarks).toBeNull();
  });

  it("refuses remarks over 2000 characters", () => {
    expect(refused(input({ remarks: "x".repeat(2001) }))).toBe(
      "Remarks can be at most 2000 characters.",
    );
  });
});

describe("progressLockedReason", () => {
  it("locks a cancelled or refunded project's milestones", () => {
    for (const cancellation of ["cancelled", "refunded"] as const) {
      expect(progressLockedReason({ cancellation })).toBe(
        "Reinstate the project before changing its milestones.",
      );
    }
  });

  it("locks nothing while the project is live", () => {
    expect(progressLockedReason({ cancellation: null })).toBeNull();
    expect(progressLockedReason({})).toBeNull();
  });
});
