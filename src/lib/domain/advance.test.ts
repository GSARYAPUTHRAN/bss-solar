import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  ADVANCE_WITHOUT_AMOUNT_ERROR,
  advanceDetailsProblem,
  advanceSummary,
  hasAdvanceDetails,
} from "./advance";

const NONE = { advance_method: null, advance_paid_on: null, advance_reference: null };

describe("hasAdvanceDetails", () => {
  it("is false until one of the three is recorded", () => {
    expect(hasAdvanceDetails(NONE)).toBe(false);
    expect(hasAdvanceDetails({})).toBe(false);
    expect(hasAdvanceDetails({ ...NONE, advance_method: "upi" })).toBe(true);
    expect(hasAdvanceDetails({ ...NONE, advance_paid_on: "2025-02-04" })).toBe(true);
    expect(hasAdvanceDetails({ ...NONE, advance_reference: "UTR 1" })).toBe(true);
  });
});

describe("advanceDetailsProblem", () => {
  it("refuses details of an advance that was never taken", () => {
    expect(advanceDetailsProblem(0, { ...NONE, advance_method: "upi" })).toBe(
      ADVANCE_WITHOUT_AMOUNT_ERROR,
    );
    expect(advanceDetailsProblem(0, { ...NONE, advance_reference: "UTR 1" })).toBe(
      ADVANCE_WITHOUT_AMOUNT_ERROR,
    );
  });

  it("accepts details with an advance, and no details without one", () => {
    expect(advanceDetailsProblem(50000, { ...NONE, advance_method: "upi" })).toBeNull();
    expect(advanceDetailsProblem(0, NONE)).toBeNull();
    expect(advanceDetailsProblem(50000, NONE)).toBeNull();
  });
});

describe("advanceSummary", () => {
  it("reads as one line: amount, method, date, reference", () => {
    expect(
      advanceSummary(50000, {
        advance_method: "upi",
        advance_paid_on: "2025-02-04",
        advance_reference: "UPI 4410021199",
      }),
    ).toBe(
      `Advance ${formatCurrency(50000)} · UPI · ${formatDate("2025-02-04")} · UPI 4410021199`,
    );
  });

  it("leaves out what was not recorded", () => {
    expect(advanceSummary(20000, NONE)).toBe(`Advance ${formatCurrency(20000)}`);
    expect(advanceSummary(20000, { ...NONE, advance_method: "cheque" })).toBe(
      `Advance ${formatCurrency(20000)} · Cheque`,
    );
    expect(advanceSummary(20000, { ...NONE, advance_paid_on: "2025-02-04" })).toBe(
      `Advance ${formatCurrency(20000)} · ${formatDate("2025-02-04")}`,
    );
  });

  it("is null when no advance was taken and nothing is recorded about one", () => {
    expect(advanceSummary(0, NONE)).toBeNull();
    expect(advanceSummary(0, {})).toBeNull();
  });
});
