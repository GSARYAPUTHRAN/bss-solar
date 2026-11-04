import { describe, expect, it } from "vitest";
import { ADVANCE_WITHOUT_AMOUNT_ERROR } from "@/lib/domain/advance";
import { CAPACITY_PROBLEM } from "@/lib/domain/capacity";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import {
  CONTRACT_TERMS_LOCKED_ERROR,
  PLAN_CHOICE_ERROR,
  PLAN_FIXED_ERROR,
  parseWorkOrderForm,
} from "./work-order";

const TODAY = "2026-10-10";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = {
  client_name: "  Anand Kumar ",
  client_phone: "+91 98470 11111",
  address: "Vytilla, Kochi",
  plant_capacity: "3kW",
  advance_amount: "20000",
  total_cost: "195000",
  order_date: "2026-09-01",
  consumer_number: "1156789012345",
  kseb_section: "Vytilla",
  notes: "",
  financing_type: "loan",
  loan_bank_name: "State Bank of India",
};

function errorOf(result: { ok: boolean } & ({ error: string } | { data: unknown })) {
  return "error" in result ? result.error : null;
}

describe("parseWorkOrderForm", () => {
  it("parses a complete loan-financed order", () => {
    expect(parseWorkOrderForm(form(VALID), TODAY)).toEqual({
      ok: true,
      data: {
        client_name: "Anand Kumar",
        client_phone: "+91 98470 11111",
        address: "Vytilla, Kochi",
        plan_type: "solar",
        plant_capacity: "3kW",
        advance_amount: 20000,
        advance_method: null,
        advance_paid_on: null,
        advance_reference: null,
        total_cost: 195000,
        order_date: "2026-09-01",
        consumer_number: "1156789012345",
        notes: null,
        kseb_section: "Vytilla",
        financing_type: "loan",
        loan_bank_name: "State Bank of India",
      },
    });
  });

  it("drops the bank name for a self-financed order", () => {
    const res = parseWorkOrderForm(form({ ...VALID, financing_type: "self" }), TODAY);
    expect(res.ok && res.data.financing_type).toBe("self");
    expect(res.ok && res.data.loan_bank_name).toBeNull();
  });

  it("defaults to self-financed, a zero advance and today's date", () => {
    const res = parseWorkOrderForm(
      form({
        ...VALID,
        financing_type: "",
        advance_amount: "",
        order_date: "",
      }),
      TODAY,
    );
    expect(res.ok && res.data).toMatchObject({
      financing_type: "self",
      loan_bank_name: null,
      advance_amount: 0,
      order_date: TODAY,
    });
  });

  it("allows a loan with the bank not yet known", () => {
    const res = parseWorkOrderForm(form({ ...VALID, loan_bank_name: "  " }), TODAY);
    expect(res.ok && res.data.loan_bank_name).toBeNull();
  });

  it.each([
    [{ client_name: " " }, "Client name is required."],
    [{ plant_capacity: "" }, "Plant capacity is required."],
    [{ plant_capacity: "three kilowatt" }, CAPACITY_PROBLEM],
    [{ plant_capacity: "0kW" }, CAPACITY_PROBLEM],
    // A number without a unit is not a capacity ("1 panel" used to read as 1 kW).
    [{ plant_capacity: "1 panel" }, CAPACITY_PROBLEM],
    [{ plant_capacity: "Inverter+panel" }, CAPACITY_PROBLEM],
    [{ total_cost: "" }, "Enter a valid total cost (0 or more)."],
    [{ total_cost: "-1" }, "Enter a valid total cost (0 or more)."],
    [{ advance_amount: "lots" }, "Enter a valid advance amount (0 or more)."],
    [{ advance_amount: "-5" }, "Enter a valid advance amount (0 or more)."],
    [{ advance_amount: "200000" }, "The advance cannot be more than the total cost."],
    [{ order_date: "01/09/2026" }, "Enter a valid order date."],
    [{ financing_type: "crypto" }, "Choose how the customer is paying: self-financed or bank loan."],
  ])("rejects %j", (patch, message) => {
    expect(errorOf(parseWorkOrderForm(form({ ...VALID, ...patch }), TODAY))).toBe(message);
  });

  it.each(["3kW", "5 kWp", "3000 W", "2.5", "3", "10KW", "3kW+inverter"])(
    "accepts capacity %j",
    (cap) => {
      expect(parseWorkOrderForm(form({ ...VALID, plant_capacity: cap }), TODAY).ok).toBe(true);
    },
  );

  describe("plan", () => {
    const CUSTOM = { ...VALID, plan_type: "custom", plant_capacity: "Inverter + panel" };

    it("is a solar plant unless the form says otherwise", () => {
      const res = parseWorkOrderForm(form(VALID), TODAY);
      expect(res.ok && res.data.plan_type).toBe("solar");
    });

    it("reads a custom plan, whose label is words rather than a kW capacity", () => {
      const res = parseWorkOrderForm(form(CUSTOM), TODAY);
      expect(res.ok && res.data).toMatchObject({
        plan_type: "custom",
        plant_capacity: "Inverter + panel",
      });
    });

    it("accepts a custom label a solar plant would refuse, and the reverse", () => {
      expect(
        parseWorkOrderForm(form({ ...CUSTOM, plant_capacity: "1 panel" }), TODAY).ok,
      ).toBe(true);
      expect(
        errorOf(parseWorkOrderForm(form({ ...VALID, plant_capacity: "1 panel" }), TODAY)),
      ).toBe(CAPACITY_PROBLEM);
    });

    it("needs something to describe on a custom plan, and keeps it short", () => {
      const DESCRIBE = /^Describe what was sold \(up to 120 characters\)/;
      expect(errorOf(parseWorkOrderForm(form({ ...CUSTOM, plant_capacity: "" }), TODAY))).toMatch(
        DESCRIBE,
      );
      expect(
        errorOf(parseWorkOrderForm(form({ ...CUSTOM, plant_capacity: "x".repeat(121) }), TODAY)),
      ).toMatch(DESCRIBE);
      expect(
        parseWorkOrderForm(form({ ...CUSTOM, plant_capacity: "x".repeat(120) }), TODAY).ok,
      ).toBe(true);
    });

    it("refuses a plan that is neither", () => {
      expect(errorOf(parseWorkOrderForm(form({ ...VALID, plan_type: "wind" }), TODAY))).toBe(
        PLAN_CHOICE_ERROR,
      );
    });

    it("keeps the stored plan when an edit posts none", () => {
      const { plan_type: _plan, ...noPlan } = CUSTOM;
      void _plan;
      const res = parseWorkOrderForm(form(noPlan), TODAY, { previousPlan: "custom" });
      expect(res.ok && res.data.plan_type).toBe("custom");
    });

    describe("once the project exists (lockedPlan)", () => {
      it("accepts the same plan, posted or not", () => {
        const posted = parseWorkOrderForm(form(CUSTOM), TODAY, { lockedPlan: "custom" });
        expect(posted.ok && posted.data.plan_type).toBe("custom");
        const { plan_type: _plan, ...noPlan } = CUSTOM;
        void _plan;
        const left = parseWorkOrderForm(form(noPlan), TODAY, { lockedPlan: "custom" });
        expect(left.ok && left.data.plan_type).toBe("custom");
      });

      it("refuses a different plan, even one that is not a plan at all", () => {
        for (const plan_type of ["solar", "wind"]) {
          expect(
            errorOf(parseWorkOrderForm(form({ ...CUSTOM, plan_type }), TODAY, { lockedPlan: "custom" })),
          ).toBe(PLAN_FIXED_ERROR);
        }
        expect(
          errorOf(parseWorkOrderForm(form({ ...VALID, plan_type: "custom" }), TODAY, { lockedPlan: "solar" })),
        ).toBe(PLAN_FIXED_ERROR);
      });
    });
  });

  describe("an unchanged legacy capacity", () => {
    // Saved before 2026-10-22, when "1 panel" read as a 1 kW plant.
    const LEGACY = { ...VALID, plant_capacity: "1 panel" };

    it("still saves, so an old order can be edited without retyping it", () => {
      const res = parseWorkOrderForm(form(LEGACY), TODAY, {
        previousCapacity: "1 panel",
        previousPlan: "solar",
      });
      expect(res.ok && res.data.plant_capacity).toBe("1 panel");
    });

    it("counts as unchanged whatever the spacing", () => {
      expect(
        parseWorkOrderForm(form({ ...VALID, plant_capacity: "  1 panel " }), TODAY, {
          previousCapacity: "1 panel",
        }).ok,
      ).toBe(true);
    });

    it("is refused once the label is changed to another unitless one", () => {
      expect(
        errorOf(
          parseWorkOrderForm(form({ ...VALID, plant_capacity: "2 panels" }), TODAY, {
            previousCapacity: "1 panel",
          }),
        ),
      ).toBe(CAPACITY_PROBLEM);
    });

    it("does not carry over from a custom plan that is switched to solar", () => {
      // "1 panel" was fine as a custom plan; as a solar capacity it is the 1 kW trap.
      expect(
        errorOf(
          parseWorkOrderForm(form({ ...LEGACY, plan_type: "solar" }), TODAY, {
            previousCapacity: "1 panel",
            previousPlan: "custom",
          }),
        ),
      ).toBe(CAPACITY_PROBLEM);
    });
  });

  describe("with locked contract terms (a coordinator after approval)", () => {
    const stored = { total_cost: 195000, advance_amount: 20000 };
    const { total_cost: _t, advance_amount: _a, ...withoutMoney } = VALID;
    void _t;
    void _a;

    it("keeps the stored terms when the form leaves them out", () => {
      const res = parseWorkOrderForm(form({ ...withoutMoney, notes: "Gate code 4411" }), TODAY, {
        lockedTerms: stored,
      });
      expect(res.ok && res.data).toMatchObject({ ...stored, notes: "Gate code 4411" });
    });

    it("accepts posted terms that match the stored ones", () => {
      const res = parseWorkOrderForm(form(VALID), TODAY, {
        lockedTerms: { total_cost: "195000.00", advance_amount: "20000.00" },
      });
      expect(res.ok && res.data).toMatchObject(stored);
    });

    it("treats a stored null advance as 0", () => {
      const res = parseWorkOrderForm(form({ ...withoutMoney, advance_amount: "" }), TODAY, {
        lockedTerms: { total_cost: 195000, advance_amount: null },
      });
      expect(res.ok && res.data.advance_amount).toBe(0);
    });

    it.each([
      { total_cost: "100000" },
      { advance_amount: "195000" },
      { advance_amount: "" },
      { advance_amount: "lots" },
    ])("refuses a change to the money: %j", (patch) => {
      expect(
        errorOf(parseWorkOrderForm(form({ ...VALID, ...patch }), TODAY, { lockedTerms: stored })),
      ).toBe(CONTRACT_TERMS_LOCKED_ERROR);
    });
  });

  describe("advance details", () => {
    const DETAILS = {
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      advance_reference: "  UPI 4410021199 ",
    };

    it("reads how, when and the reference of the advance, trimmed", () => {
      const res = parseWorkOrderForm(form({ ...VALID, ...DETAILS }), TODAY);
      expect(res.ok && res.data).toMatchObject({
        advance_amount: 20000,
        advance_method: "upi",
        advance_paid_on: "2025-02-04",
        advance_reference: "UPI 4410021199",
      });
    });

    it("keeps them all optional: blank is not recorded", () => {
      const res = parseWorkOrderForm(
        form({ ...VALID, advance_method: "", advance_paid_on: "", advance_reference: "  " }),
        TODAY,
      );
      expect(res.ok && res.data).toMatchObject({
        advance_method: null,
        advance_paid_on: null,
        advance_reference: null,
      });
    });

    it("reads the select's 'not recorded' as no method", () => {
      const res = parseWorkOrderForm(form({ ...VALID, advance_method: "none" }), TODAY);
      expect(res.ok && res.data.advance_method).toBeNull();
    });

    it("accepts any one of them alone", () => {
      const method = parseWorkOrderForm(form({ ...VALID, advance_method: "cheque" }), TODAY);
      expect(method.ok && method.data).toMatchObject({
        advance_method: "cheque",
        advance_paid_on: null,
        advance_reference: null,
      });
      const reference = parseWorkOrderForm(form({ ...VALID, advance_reference: "CHQ 3003" }), TODAY);
      expect(reference.ok && reference.data.advance_reference).toBe("CHQ 3003");
    });

    it("refuses a method that is not a payment method", () => {
      for (const advance_method of ["barter", "constructor", "NONE"]) {
        expect(errorOf(parseWorkOrderForm(form({ ...VALID, advance_method }), TODAY))).toBe(
          "Choose how the advance was paid, or leave it as not recorded.",
        );
      }
    });

    it("takes a day that has happened: today, or any day before, even before the order", () => {
      for (const advance_paid_on of [TODAY, "2026-09-01", "2025-02-04", "2026-08-15"]) {
        expect(parseWorkOrderForm(form({ ...VALID, advance_paid_on }), TODAY).ok).toBe(true);
      }
    });

    it("refuses a date in the future", () => {
      expect(errorOf(parseWorkOrderForm(form({ ...VALID, advance_paid_on: "2026-10-11" }), TODAY))).toBe(
        "The advance date cannot be in the future.",
      );
    });

    it.each(["04/02/2025", "2025-02-30", "2025-2-4", "yesterday"])(
      "refuses the date %j as not a date",
      (advance_paid_on) => {
        expect(errorOf(parseWorkOrderForm(form({ ...VALID, advance_paid_on }), TODAY))).toBe(
          "Enter a valid date for when the advance was received.",
        );
      },
    );

    it("holds the reference to its length", () => {
      const limit = PAYMENT_LIMITS.advanceReferenceLength;
      expect(
        parseWorkOrderForm(form({ ...VALID, advance_reference: "x".repeat(limit) }), TODAY).ok,
      ).toBe(true);
      expect(
        errorOf(parseWorkOrderForm(form({ ...VALID, advance_reference: "x".repeat(limit + 1) }), TODAY)),
      ).toBe(`The advance reference must be ${limit} characters or fewer.`);
    });

    it.each(["", "0"])("refuses details of an advance that was never taken (advance %j)", (advance_amount) => {
      const details: Record<string, string>[] = [
        { advance_method: "upi" },
        { advance_paid_on: "2025-02-04" },
        { advance_reference: "UTR 1" },
      ];
      for (const patch of details) {
        expect(
          errorOf(parseWorkOrderForm(form({ ...VALID, advance_amount, ...patch }), TODAY)),
        ).toBe(ADVANCE_WITHOUT_AMOUNT_ERROR);
      }
    });

    it("allows no advance and no details", () => {
      const res = parseWorkOrderForm(form({ ...VALID, advance_amount: "" }), TODAY);
      expect(res.ok && res.data).toMatchObject({ advance_amount: 0, advance_method: null });
    });

    describe("with locked terms (a coordinator after approval)", () => {
      const stored = {
        total_cost: 195000,
        advance_amount: 20000,
        advance_method: "cheque" as const,
        advance_paid_on: "2025-02-04",
        advance_reference: "CHQ 3003",
      };
      const { total_cost: _t, advance_amount: _a, ...withoutMoney } = VALID;
      void _t;
      void _a;

      it("writes the stored details back when the form leaves them out", () => {
        // The database lock compares what it is sent: sending null here would
        // look like the coordinator wiping the office's record.
        const res = parseWorkOrderForm(form({ ...withoutMoney, notes: "Gate code" }), TODAY, {
          lockedTerms: stored,
        });
        expect(res.ok && res.data).toMatchObject({
          advance_method: "cheque",
          advance_paid_on: "2025-02-04",
          advance_reference: "CHQ 3003",
          notes: "Gate code",
        });
      });

      it("accepts posted details that match the stored ones", () => {
        const res = parseWorkOrderForm(
          form({
            ...VALID,
            advance_method: "cheque",
            advance_paid_on: "2025-02-04",
            advance_reference: " CHQ 3003 ",
          }),
          TODAY,
          { lockedTerms: stored },
        );
        expect(res.ok && res.data).toMatchObject({ advance_method: "cheque", advance_reference: "CHQ 3003" });
      });

      it("reads a stored absence as not recorded, whatever the blank is called", () => {
        const none = { total_cost: 195000, advance_amount: 20000 };
        for (const advance_method of ["", "none"]) {
          const res = parseWorkOrderForm(
            form({ ...VALID, advance_method, advance_paid_on: "", advance_reference: "" }),
            TODAY,
            { lockedTerms: none },
          );
          expect(res.ok && res.data).toMatchObject({
            advance_method: null,
            advance_paid_on: null,
            advance_reference: null,
          });
        }
      });

      it.each([
        { advance_method: "cash" },
        { advance_method: "none" },
        { advance_paid_on: "2025-02-05" },
        { advance_paid_on: "" },
        { advance_reference: "CHQ 9999" },
        { advance_reference: "" },
      ])("refuses a change to the details: %j", (patch) => {
        const posted = {
          ...VALID,
          advance_method: "cheque",
          advance_paid_on: "2025-02-04",
          advance_reference: "CHQ 3003",
          ...patch,
        };
        expect(errorOf(parseWorkOrderForm(form(posted), TODAY, { lockedTerms: stored }))).toBe(
          CONTRACT_TERMS_LOCKED_ERROR,
        );
      });

      it("does not judge the stored details by the rules of today", () => {
        // Details recorded before a rule existed stay as they are.
        const res = parseWorkOrderForm(form(withoutMoney), TODAY, {
          lockedTerms: { ...stored, advance_paid_on: "2026-12-31" },
        });
        expect(res.ok && res.data.advance_paid_on).toBe("2026-12-31");
      });
    });
  });

  it("never reads the removed fixed payment slots", () => {
    const res = parseWorkOrderForm(
      form({ ...VALID, first_payment_amount: "1000", second_payment_date: "2026-01-01" }),
      TODAY,
    );
    expect(res.ok && Object.keys(res.data)).not.toEqual(
      expect.arrayContaining(["first_payment_amount", "second_payment_date"]),
    );
  });
});
