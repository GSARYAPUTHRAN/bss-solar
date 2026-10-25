import { describe, it, expect } from "vitest";
import {
  CANCELLATION_VOCABULARY,
  COMPLETION_ALIASES,
  FINANCING_VOCABULARY,
  PAYMENT_METHOD_VOCABULARY,
  PAYMENT_PURPOSE_VOCABULARY,
  PLAN_VOCABULARY,
  booleanCell,
  cancellationCell,
  dateCell,
  emailCell,
  financingCell,
  identifierCell,
  moneyCell,
  normalizeStage,
  paymentMethodCell,
  paymentPurposeCell,
  planTypeCell,
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

  it("shows a sum as an example in the message", () => {
    expect(moneyCell("soon", "total_cost")).toEqual({
      ok: false,
      error: 'total_cost must be an amount in rupees, like 195000 or 235000+23500 (got "soon")',
    });
  });
});

describe("moneyCell — sums", () => {
  it.each([
    ["235000+23500", 258500],
    ["₹1,000 + Rs. 500", 1500],
    ["230000 + 23,500", 253500],
    ["1.5+2.25", 3.75],
    ["189985.84+0.16", 189986],
    ["0+0", 0],
  ])("adds %s", (raw, total) => {
    expect(moneyCell(raw, "total_cost")).toEqual(okWith(total));
  });

  it("adds in paise, so 0.1 + 0.2 is exactly 0.3", () => {
    // In floating point 0.1 + 0.2 is 0.30000000000000004.
    expect(moneyCell("0.1+0.2", "total_cost")).toEqual(okWith(0.3));
    expect(moneyCell("19.99+0.01", "total_cost")).toEqual(okWith(20));
  });

  it("names an empty part and how to write the sum", () => {
    for (const raw of ["100+", "+100", "100++5"]) {
      expect(moneyCell(raw, "total_cost")).toEqual({
        ok: false,
        error: `total_cost "${raw}" has an empty part — write it like 235000+23500`,
      });
    }
  });

  it("refuses a part that is not a plain amount, a negative one included", () => {
    expect(moneyCell("100+-5", "total_cost")).toEqual({
      ok: false,
      error: 'total_cost "100+-5" — each part of a sum must be a plain amount',
    });
    expect(moneyCell("100+abc", "total_cost")).toEqual(failing(/each part of a sum/));
    expect(moneyCell("1e+5", "total_cost")).toEqual(failing(/each part of a sum/));
  });

  it("applies the limits to the total, not to the parts", () => {
    expect(moneyCell("0+0", "payment_1_amount", { positive: true })).toEqual(
      failing(/must be more than zero/),
    );
    expect(moneyCell("9999999999+1", "total_cost")).toEqual(failing(/too large/));
    expect(moneyCell("9999999999+0.99", "total_cost")).toEqual(okWith(9999999999.99));
    expect(moneyCell("1+0.005", "total_cost")).toEqual(failing(/2 decimal places/));
  });

  it("keeps the single-amount message for a lone negative", () => {
    expect(moneyCell("-5", "total_cost")).toEqual(failing(/total_cost cannot be negative/));
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

describe("normalizeStage", () => {
  it("accepts a stage key or its label, case-insensitively", () => {
    expect(normalizeStage("material_dispatch")).toBe("material_dispatch");
    expect(normalizeStage("Plant Commissioning")).toBe("plant_commissioning");
  });
  it("still defaults blank to the first stage for the callers that rely on it", () => {
    expect(normalizeStage("")).toBe("site_feasibility_survey");
  });
  it("returns null for an unknown stage", () => {
    expect(normalizeStage("nonsense")).toBeNull();
  });
});

describe("stageCell", () => {
  it("is null for a blank cell — the importer's plan decides the start", () => {
    expect(stageCell("")).toEqual(okWith({ stage: null, completed: false }));
    expect(stageCell(undefined)).toEqual(okWith({ stage: null, completed: false }));
    expect(stageCell("  ")).toEqual(okWith({ stage: null, completed: false }));
  });

  it("reads a stage by key or label, not completed", () => {
    expect(stageCell("panel_installation")).toEqual(
      okWith({ stage: "panel_installation", completed: false }),
    );
    expect(stageCell("Material Dispatch (Panels & Structure)")).toEqual(
      okWith({ stage: "material_dispatch", completed: false }),
    );
    // Naming the last stage is not saying it is finished.
    expect(stageCell("plant_commissioning")).toEqual(
      okWith({ stage: "plant_commissioning", completed: false }),
    );
  });

  it.each([...COMPLETION_ALIASES, "Plant-Complete", "HANDED_OVER", " Commissioned "])(
    "reads %s as the last stage, completed",
    (raw) => {
      expect(stageCell(raw)).toEqual(okWith({ stage: "plant_commissioning", completed: true }));
    },
  );

  it.each(["cancelled", "Canceled", "refunded", "Refund", "cancel"])(
    "points %s at the cancellation column",
    (raw) => {
      expect(stageCell(raw)).toEqual({
        ok: false,
        error: `current_stage "${raw}" is not a stage — put cancelled or refunded in the cancellation column and leave current_stage at the stage the project reached`,
      });
    },
  );

  it("suggests the nearest stage, or completion word, for a typo", () => {
    expect(stageCell("panel_instalation")).toEqual(
      failing(/did you mean "panel_installation"\?/),
    );
    expect(stageCell("complted")).toEqual(failing(/did you mean "completed"\?/));
    expect(stageCell("nonsense")).toEqual(
      failing(/^current_stage "nonsense" is not recognised$/),
    );
  });

  it("names the column the sheet used", () => {
    expect(stageCell("nonsense", "stage")).toEqual(failing(/^stage "nonsense"/));
  });
});

describe("planTypeCell", () => {
  it("is solar when blank", () => {
    expect(planTypeCell("", "plan_type")).toEqual(okWith("solar"));
    expect(planTypeCell(undefined, "plan_type")).toEqual(okWith("solar"));
  });
  it.each(["solar", "Solar", "Solar plant", "solar_plant", "KW"])("reads %s as solar", (raw) => {
    expect(planTypeCell(raw, "plan_type")).toEqual(okWith("solar"));
  });
  it.each(["custom", "Custom plan", "custom_plan", "Other"])("reads %s as custom", (raw) => {
    expect(planTypeCell(raw, "plan_type")).toEqual(okWith("custom"));
  });
  it("suggests the nearest plan for an unknown one", () => {
    expect(planTypeCell("kustom", "plan_type")).toEqual({
      ok: false,
      error: 'plan_type "kustom" is not recognised — did you mean "custom"?',
    });
    expect(planTypeCell("hybrid", "plan")).toEqual(failing(/^plan "hybrid" is not recognised/));
  });
  it("documents its spellings for the page", () => {
    expect(PLAN_VOCABULARY.spellings).toEqual({
      solar: ["solar", "Solar plant", "kw"],
      custom: ["custom", "Custom plan", "other"],
    });
  });
});

describe("cancellationCell", () => {
  it.each(["", "  ", "active", "Live"])("reads %j as a live project", (raw) => {
    expect(cancellationCell(raw, "cancellation")).toEqual(okWith(null));
  });
  it.each(["cancelled", "Canceled", "cancel", "CANCELLED"])("reads %s as cancelled", (raw) => {
    expect(cancellationCell(raw, "cancellation")).toEqual(okWith("cancelled"));
  });
  it.each(["refunded", "Refund", "REFUNDED"])("reads %s as refunded", (raw) => {
    expect(cancellationCell(raw, "cancellation")).toEqual(okWith("refunded"));
  });
  it("suggests the nearest word for a typo", () => {
    expect(cancellationCell("refunnded", "cancellation")).toEqual({
      ok: false,
      error: 'cancellation "refunnded" is not recognised — did you mean "refunded"?',
    });
    expect(cancellationCell("maybe", "cancellation")).toEqual(
      failing(/^cancellation "maybe" is not recognised$/),
    );
  });
  it("documents its spellings for the page", () => {
    expect(CANCELLATION_VOCABULARY.spellings).toEqual({
      cancelled: ["cancelled", "canceled", "cancel"],
      refunded: ["refunded", "refund"],
    });
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
