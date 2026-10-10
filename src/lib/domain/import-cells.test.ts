import { describe, it, expect } from "vitest";
import {
  FINANCING_VOCABULARY,
  PAYMENT_METHOD_VOCABULARY,
  PAYMENT_PURPOSE_VOCABULARY,
  booleanCell,
  dateCell,
  emailCell,
  financingCell,
  identifierCell,
  moneyCell,
  normalizeStage,
  paymentMethodCell,
  paymentPurposeCell,
  spelling,
  stageCell,
  textCell,
} from "./import-cells";

const okWith = (data: unknown) => ({ ok: true, data });
const failing = (pattern: RegExp) => ({ ok: false, error: expect.stringMatching(pattern) });

describe("spelling", () => {
  it("ignores case, edge space and - _ runs", () => {
    expect(spelling("  Bank-Transfer ")).toBe("bank transfer");
    expect(spelling("bank__transfer")).toBe("bank transfer");
  });
});

describe("textCell", () => {
  it("trims and turns blank into null", () => {
    expect(textCell("  Vytilla ")).toBe("Vytilla");
    expect(textCell("   ")).toBeNull();
    expect(textCell(undefined)).toBeNull();
  });
});

describe("moneyCell", () => {
  it("is null when blank (never a silent 0)", () => {
    expect(moneyCell("", "advance_amount")).toEqual(okWith(null));
    expect(moneyCell(undefined, "advance_amount")).toEqual(okWith(null));
  });

  it.each([
    ["195000", 195000],
    ["1,95,000", 195000],
    ["₹ 2,500.50", 2500.5],
    ["Rs. 4540", 4540],
    ["0", 0],
  ])("reads %s as %d", (raw, value) => {
    expect(moneyCell(raw, "total_cost")).toEqual(okWith(value));
  });

  it("rejects text, negatives, sub-paise and absurd amounts", () => {
    expect(moneyCell("soon", "total_cost")).toEqual(failing(/^total_cost must be an amount/));
    expect(moneyCell("1e5", "total_cost")).toEqual(failing(/must be an amount/));
    expect(moneyCell("-5", "total_cost")).toEqual(failing(/cannot be negative/));
    expect(moneyCell("10.505", "total_cost")).toEqual(failing(/2 decimal places/));
    expect(moneyCell("99999999999", "total_cost")).toEqual(failing(/too large/));
  });

  it("rejects zero when the amount must be positive", () => {
    expect(moneyCell("0", "payment_1_amount", { positive: true })).toEqual(
      failing(/payment_1_amount must be more than zero/),
    );
  });
});

describe("dateCell", () => {
  const today = "2026-10-10";

  it("accepts a strict ISO date up to today", () => {
    expect(dateCell("2026-10-10", "paid_on", { notAfter: today })).toEqual(
      okWith("2026-10-10"),
    );
    expect(dateCell("", "paid_on")).toEqual(okWith(null));
  });

  it("rejects a date after today", () => {
    expect(dateCell("2026-10-11", "feasibility_date", { notAfter: today })).toEqual(
      failing(/feasibility_date 2026-10-11 is in the future/),
    );
  });

  it("rejects an impossible calendar date", () => {
    expect(dateCell("2026-02-30", "order_date")).toEqual(
      failing(/2026-02-30 is not a real calendar date/),
    );
  });

  it("offers the ISO form of a day-first date without guessing it in", () => {
    expect(dateCell("15/03/2026", "order_date")).toEqual(
      failing(/YYYY-MM-DD.*did you mean 2026-03-15\?/),
    );
    expect(dateCell("2026-3-5", "order_date")).toEqual(failing(/YYYY-MM-DD/));
  });
});

describe("booleanCell", () => {
  it.each(["true", "Yes", "y", "1"])("reads %s as true", (raw) => {
    expect(booleanCell(raw, "is_completed")).toEqual(okWith(true));
  });
  it.each(["false", "NO", "n", "0"])("reads %s as false", (raw) => {
    expect(booleanCell(raw, "is_completed")).toEqual(okWith(false));
  });
  it("keeps blank distinct from no", () => {
    expect(booleanCell(" ", "is_completed")).toEqual(okWith(null));
  });
  it("rejects anything else", () => {
    expect(booleanCell("maybe", "is_completed")).toEqual(
      failing(/is_completed must be yes or no/),
    );
  });
});

describe("emailCell", () => {
  it("lower-cases a valid address", () => {
    expect(emailCell(" Coord@BSSSolar.test ", "coordinator_email")).toEqual(
      okWith("coord@bsssolar.test"),
    );
  });
  it("rejects a non-address", () => {
    expect(emailCell("rahul", "coordinator_email")).toEqual(failing(/not an e-mail/));
  });
});

describe("identifierCell", () => {
  it("keeps long numbers as text", () => {
    expect(identifierCell("1156789012345", "consumer_number")).toEqual(
      okWith("1156789012345"),
    );
  });
  it("refuses Excel scientific notation (the digits are already lost)", () => {
    expect(identifierCell("1.15679E+12", "consumer_number")).toEqual(
      failing(/scientific notation/),
    );
    expect(identifierCell("9.19847e11", "client_phone")).toEqual(
      failing(/client_phone.*scientific notation/),
    );
  });
});

describe("financingCell", () => {
  it.each(["loan", "Bank loan", "bank-loan", "YES", "true"])("reads %s as loan", (raw) => {
    expect(financingCell(raw)).toEqual(okWith("loan"));
  });
  it.each(["self", "Self-financed", "self financed", "no", "False"])(
    "reads %s as self",
    (raw) => {
      expect(financingCell(raw)).toEqual(okWith("self"));
    },
  );
  it("is null when blank — the row decides", () => {
    expect(financingCell("")).toEqual(okWith(null));
  });
  it("rejects anything else", () => {
    expect(financingCell("subsidy")).toEqual(failing(/use loan or self/));
  });
});

describe("paymentMethodCell", () => {
  it("defaults blank to other", () => {
    expect(paymentMethodCell("", "payment_1_method")).toEqual(okWith("other"));
  });
  it.each([
    ["bank_transfer", "bank_transfer"],
    ["Bank transfer", "bank_transfer"],
    ["NEFT", "bank_transfer"],
    ["UPI", "upi"],
    ["GPay", "upi"],
    ["Loan disbursement", "loan_disbursement"],
    ["cheque", "cheque"],
  ])("reads %s as %s", (raw, method) => {
    expect(paymentMethodCell(raw, "payment_1_method")).toEqual(okWith(method));
  });
  it("suggests the nearest method for a typo", () => {
    expect(paymentMethodCell("chque", "payment_2_method")).toEqual(
      failing(/payment_2_method "chque" is not recognised — did you mean "cheque"\?/),
    );
  });
});

describe("paymentPurposeCell", () => {
  it("defaults blank to contract", () => {
    expect(paymentPurposeCell("", "payment_1_purpose")).toEqual(okWith("contract"));
  });
  it.each(["kseb_fees", "KSEB fees", "kseb"])("reads %s as kseb_fees", (raw) => {
    expect(paymentPurposeCell(raw, "payment_1_purpose")).toEqual(okWith("kseb_fees"));
  });
  it("rejects anything else", () => {
    expect(paymentPurposeCell("subsidy", "payment_1_purpose")).toEqual(
      failing(/payment_1_purpose "subsidy" is not recognised/),
    );
  });
});

describe("normalizeStage / stageCell", () => {
  it("accepts a stage key or its label, case-insensitively", () => {
    expect(normalizeStage("material_dispatch")).toBe("material_dispatch");
    expect(normalizeStage("Plant Commissioning")).toBe("plant_commissioning");
  });
  it("defaults blank to the first stage", () => {
    expect(normalizeStage("")).toBe("site_feasibility_survey");
  });
  it("returns null / an error with a suggestion for an unknown stage", () => {
    expect(normalizeStage("nonsense")).toBeNull();
    expect(stageCell("panel_instalation")).toEqual(
      failing(/did you mean "panel_installation"\?/),
    );
  });
});

describe("vocabulary spellings (feed the column reference)", () => {
  it("lists the key, a distinct label and the aliases", () => {
    expect(PAYMENT_METHOD_VOCABULARY.spellings.bank_transfer).toEqual([
      "bank_transfer",
      "Bank transfer",
      "NEFT",
      "RTGS",
      "IMPS",
    ]);
    expect(PAYMENT_METHOD_VOCABULARY.spellings.cash).toEqual(["cash"]);
    expect(PAYMENT_PURPOSE_VOCABULARY.spellings.kseb_fees).toContain("KSEB fees");
    expect(FINANCING_VOCABULARY.spellings.loan).toEqual(["loan", "Bank loan", "yes", "true"]);
    expect(FINANCING_VOCABULARY.spellings.self).toEqual([
      "self",
      "Self-financed",
      "no",
      "false",
    ]);
  });

  it("accepts every spelling it documents", () => {
    for (const [method, spellings] of Object.entries(PAYMENT_METHOD_VOCABULARY.spellings)) {
      for (const s of spellings) expect(PAYMENT_METHOD_VOCABULARY.get(s)).toBe(method);
    }
  });
});
