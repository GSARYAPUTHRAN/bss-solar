import { describe, expect, it } from "vitest";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import {
  checkContractCap,
  checkContractTerms,
  parsePaymentForm,
  type StoredLedgerEntry,
} from "./payment";

const TODAY = "2026-10-10";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = {
  amount: "25000",
  paid_on: "2026-10-01",
  method: "upi",
  purpose: "contract",
  reference: "  UPI 6611029934 ",
  notes: "",
};

function errorOf(result: { ok: boolean } & ({ error: string } | { data: unknown })) {
  return "error" in result ? result.error : null;
}

describe("parsePaymentForm", () => {
  it("parses a complete entry, trimming text and nulling blanks", () => {
    const res = parsePaymentForm(form(VALID), TODAY);
    expect(res).toEqual({
      ok: true,
      data: {
        amount: 25000,
        paid_on: "2026-10-01",
        method: "upi",
        purpose: "contract",
        reference: "UPI 6611029934",
        notes: null,
      },
    });
  });

  it("defaults the purpose to contract when omitted", () => {
    const { purpose: _omit, ...rest } = VALID;
    void _omit;
    const res = parsePaymentForm(form(rest), TODAY);
    expect(res.ok && res.data.purpose).toBe("contract");
  });

  it("accepts paise and a payment dated today", () => {
    const res = parsePaymentForm(
      form({ ...VALID, amount: "1500.50", paid_on: TODAY }),
      TODAY,
    );
    expect(res.ok && res.data.amount).toBe(1500.5);
  });

  it.each([
    ["", "Enter the amount received, in rupees."],
    ["abc", "Enter the amount received, in rupees."],
    ["0", "The amount must be more than zero."],
    ["-500", "The amount must be more than zero."],
    ["100.555", "at most 2 decimal places"],
    ["1e5", "at most 2 decimal places"],
    ["99999999999", "too large"],
  ])("rejects amount %j", (amount, message) => {
    const res = parsePaymentForm(form({ ...VALID, amount }), TODAY);
    expect(res.ok).toBe(false);
    expect(errorOf(res)).toContain(message);
  });

  it("accepts the largest amount the column can hold", () => {
    const res = parsePaymentForm(
      form({ ...VALID, amount: String(PAYMENT_LIMITS.maxAmount) }),
      TODAY,
    );
    expect(res.ok).toBe(true);
  });

  it.each(["", "01/10/2026", "2026-02-30", "2026-1-5"])(
    "rejects paid_on %j",
    (paid_on) => {
      const res = parsePaymentForm(form({ ...VALID, paid_on }), TODAY);
      expect(errorOf(res)).toBe("Enter the date the payment was received.");
    },
  );

  it("rejects a payment dated after today (IST)", () => {
    const res = parsePaymentForm(form({ ...VALID, paid_on: "2026-10-11" }), TODAY);
    expect(errorOf(res)).toBe("The payment date cannot be in the future.");
  });

  it("rejects an unknown method or purpose", () => {
    expect(errorOf(parsePaymentForm(form({ ...VALID, method: "barter" }), TODAY))).toBe(
      "Choose how the payment was made.",
    );
    expect(errorOf(parsePaymentForm(form({ ...VALID, method: "" }), TODAY))).toBe(
      "Choose how the payment was made.",
    );
    expect(
      errorOf(parsePaymentForm(form({ ...VALID, purpose: "tips" }), TODAY)),
    ).toBe("Choose what the payment is for.");
  });

  it("caps reference and notes length", () => {
    const longRef = "x".repeat(PAYMENT_LIMITS.referenceLength + 1);
    expect(errorOf(parsePaymentForm(form({ ...VALID, reference: longRef }), TODAY))).toBe(
      `Reference must be ${PAYMENT_LIMITS.referenceLength} characters or fewer.`,
    );
    const longNotes = "x".repeat(PAYMENT_LIMITS.notesLength + 1);
    expect(errorOf(parsePaymentForm(form({ ...VALID, notes: longNotes }), TODAY))).toBe(
      `Notes must be ${PAYMENT_LIMITS.notesLength} characters or fewer.`,
    );
    // Exactly at the limit is fine.
    const atLimit = "x".repeat(PAYMENT_LIMITS.notesLength);
    expect(parsePaymentForm(form({ ...VALID, notes: atLimit }), TODAY).ok).toBe(true);
  });
});

describe("checkContractCap", () => {
  // ₹1,95,000 contract, ₹20,000 advance, ₹80,000 stage 1 → ₹95,000 due.
  const contract = { total_cost: 195000, advance_amount: 20000 };
  const ledger: StoredLedgerEntry[] = [
    { id: "p1", amount: 80000, paid_on: "2026-09-01", purpose: "contract" },
    { id: "k1", amount: 5720, paid_on: "2026-09-02", purpose: "kseb_fees" },
  ];

  it("allows a contract payment within the balance and reports the new balance", () => {
    const res = checkContractCap({
      contract,
      ledger,
      entry: { amount: 45000, purpose: "contract" },
    });
    expect(res).toEqual({ ok: true, data: { balanceAfter: 50000 } });
  });

  it("allows settling the balance exactly", () => {
    const res = checkContractCap({
      contract,
      ledger,
      entry: { amount: 95000, purpose: "contract" },
    });
    expect(res).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });

  it("rejects a contract payment above the balance, naming the balance", () => {
    const res = checkContractCap({
      contract,
      ledger,
      entry: { amount: 100000, purpose: "contract" },
    });
    expect(res.ok).toBe(false);
    const error = errorOf(res) ?? "";
    expect(error).toContain("₹95,000");
    expect(error).toContain("₹1,00,000");
    expect(error).toMatch(/correct the work order's total cost first/);
  });

  it("explains a fully paid contract", () => {
    const res = checkContractCap({
      contract: { total_cost: 100000, advance_amount: 100000 },
      ledger: [],
      entry: { amount: 1, purpose: "contract" },
    });
    expect(errorOf(res)).toMatch(/Nothing is due on this contract/);
  });

  it("never caps KSEB-fee entries (they are not contract money)", () => {
    const res = checkContractCap({
      contract: { total_cost: 100000, advance_amount: 100000 },
      ledger: [],
      entry: { amount: 50000, purpose: "kseb_fees" },
    });
    expect(res).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });

  it("releases the edited entry's own amount before checking", () => {
    // Raising stage 1 from 80,000 to 175,000 uses the whole 1,75,000 headroom.
    const res = checkContractCap({
      contract,
      ledger,
      editingId: "p1",
      entry: { amount: 175000, purpose: "contract" },
    });
    expect(res).toEqual({ ok: true, data: { balanceAfter: 0 } });

    const over = checkContractCap({
      contract,
      ledger,
      editingId: "p1",
      entry: { amount: 175001, purpose: "contract" },
    });
    expect(errorOf(over)).toContain("₹1,75,000");
  });

  it("caps a KSEB-fee entry being re-classified as contract money", () => {
    const res = checkContractCap({
      contract: { total_cost: 100000, advance_amount: 100000 },
      ledger: [{ id: "k1", amount: 5720, paid_on: "2026-09-02", purpose: "kseb_fees" }],
      editingId: "k1",
      entry: { amount: 5720, purpose: "contract" },
    });
    expect(res.ok).toBe(false);
  });

  it("still allows corrections on a contract that is already overpaid", () => {
    // Total lowered after collection: 1,00,000 advance + 50,000 ledger on a
    // 1,20,000 contract = 30,000 overpaid.
    const overpaid = {
      contract: { total_cost: 120000, advance_amount: 100000 },
      ledger: [{ id: "p1", amount: 50000, paid_on: "2026-09-01", purpose: "contract" as const }],
      editingId: "p1",
    };
    // Same amount (e.g. fixing the reference) — not worse, so allowed.
    expect(
      checkContractCap({ ...overpaid, entry: { amount: 50000, purpose: "contract" } }).ok,
    ).toBe(true);
    // Lowering it moves towards zero — allowed.
    expect(
      checkContractCap({ ...overpaid, entry: { amount: 20000, purpose: "contract" } }),
    ).toEqual({ ok: true, data: { balanceAfter: 0 } });
    // Raising it makes the overpayment worse — rejected, and says by how much.
    const worse = checkContractCap({
      ...overpaid,
      entry: { amount: 60000, purpose: "contract" },
    });
    expect(errorOf(worse)).toBe(
      "₹60,000.00 is more than the ₹20,000.00 balance due on this contract. If the customer paid more than agreed, correct the work order's total cost first.",
    );
  });

  it("reports an existing overpayment when nothing is available", () => {
    const res = checkContractCap({
      contract: { total_cost: 120000, advance_amount: 150000 },
      ledger: [],
      entry: { amount: 1000, purpose: "contract" },
    });
    expect(errorOf(res)).toMatch(/already overpaid by ₹30,000/);
  });

  it("copes with decimal strings from PostgREST", () => {
    const res = checkContractCap({
      contract: { total_cost: "1000.30", advance_amount: "0.10" },
      ledger: [{ id: "p1", amount: "0.20", paid_on: "2026-09-01", purpose: "contract" }],
      entry: { amount: 1000, purpose: "contract" },
    });
    expect(res).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });
});

describe("checkContractTerms", () => {
  // ₹2,00,000 contract, ₹20,000 advance, ₹1,00,000 collected through the
  // ledger (plus KSEB fees, which never count) → ₹80,000 due.
  const current = { total_cost: 200000, advance_amount: 20000 };
  const ledger = [
    { amount: 100000, paid_on: "2026-09-01", purpose: "contract" as const },
    { amount: 5720, paid_on: "2026-09-02", purpose: "kseb_fees" as const },
  ];

  it("allows terms that keep a balance, reporting it", () => {
    expect(
      checkContractTerms({
        current,
        terms: { total_cost: 210000, advance_amount: 30000 },
        ledger,
      }),
    ).toEqual({ ok: true, data: { balanceAfter: 80000 } });
  });

  it("allows terms that settle the contract exactly", () => {
    expect(
      checkContractTerms({
        current,
        terms: { total_cost: 200000, advance_amount: 100000 },
        ledger,
      }),
    ).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });

  it("refuses an advance that would overpay against the ledger", () => {
    const res = checkContractTerms({
      current,
      terms: { total_cost: 200000, advance_amount: 150000 },
      ledger,
    });
    expect(errorOf(res)).toBe(
      "The advance and the contract payments recorded come to ₹2,50,000.00, more than the ₹2,00,000.00 total cost — this contract would be overpaid by ₹50,000.00. If a payment was recorded in error, correct it in the payments ledger first.",
    );
  });

  it("refuses lowering the total below what has been collected", () => {
    const res = checkContractTerms({
      current,
      terms: { total_cost: 110000, advance_amount: 20000 },
      ledger,
    });
    expect(errorOf(res)).toContain("overpaid by ₹10,000.00");
  });

  it("does not count KSEB-fee entries towards the contract", () => {
    const res = checkContractTerms({
      current,
      terms: { total_cost: 120000, advance_amount: 20000 },
      ledger,
    });
    expect(res).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });

  it("still allows editing an order that is already overpaid, if not made worse", () => {
    // Collected 1,30,000 against a 1,20,000 contract: 10,000 overpaid already.
    const overpaid = { total_cost: 120000, advance_amount: 30000 };
    expect(checkContractTerms({ current: overpaid, terms: overpaid, ledger }).ok).toBe(true);
    // Moving towards zero is allowed…
    expect(
      checkContractTerms({
        current: overpaid,
        terms: { total_cost: 125000, advance_amount: 30000 },
        ledger,
      }).ok,
    ).toBe(true);
    // …making it worse is not.
    expect(
      checkContractTerms({
        current: overpaid,
        terms: { total_cost: 115000, advance_amount: 30000 },
        ledger,
      }).ok,
    ).toBe(false);
  });

  it("copes with decimal strings from PostgREST", () => {
    expect(
      checkContractTerms({
        current: { total_cost: "1000.30", advance_amount: "0.10" },
        terms: { total_cost: "1000.30", advance_amount: "1000.10" },
        ledger: [{ amount: "0.20", paid_on: "2026-09-01", purpose: "contract" }],
      }),
    ).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });
});
