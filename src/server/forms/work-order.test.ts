import { describe, expect, it } from "vitest";
import {
  CAPACITY_ERROR,
  CONTRACT_TERMS_LOCKED_ERROR,
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
        plant_capacity: "3kW",
        advance_amount: 20000,
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
    [{ plant_capacity: "three kilowatt" }, CAPACITY_ERROR],
    [{ plant_capacity: "0kW" }, CAPACITY_ERROR],
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

  it.each(["3kW", "5 kWp", "3000 W", "2.5", "10KW"])("accepts capacity %j", (cap) => {
    expect(parseWorkOrderForm(form({ ...VALID, plant_capacity: cap }), TODAY).ok).toBe(true);
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

  it("never reads the deprecated fixed payment slots", () => {
    const res = parseWorkOrderForm(
      form({ ...VALID, first_payment_amount: "1000", second_payment_date: "2026-01-01" }),
      TODAY,
    );
    expect(res.ok && Object.keys(res.data)).not.toEqual(
      expect.arrayContaining(["first_payment_amount", "second_payment_date"]),
    );
  });
});
