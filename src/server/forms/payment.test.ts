import { describe, expect, it } from "vitest";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import { formatCurrency } from "@/lib/format";
import type { PaymentInput } from "@/server/data/payments.repository";
import {
  WRITE_OFF_REASON_ERROR,
  checkContractTerms,
  checkLedgerChange,
  parsePaymentForm,
  parseWriteOffForm,
  recordedMessage,
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
  kind: "contract",
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
        paid_by_office: false,
        reference: "UPI 6611029934",
        notes: null,
      },
    });
  });

  it("defaults the kind to a contract payment when omitted", () => {
    const { kind: _omit, ...rest } = VALID;
    void _omit;
    const res = parsePaymentForm(form(rest), TODAY);
    expect(res.ok && res.data.purpose).toBe("contract");
  });

  it.each([
    ["contract", "contract", false],
    ["kseb_customer", "kseb_fees", false],
    ["kseb_office", "kseb_fees", true],
    ["refund", "refund", false],
  ])("reads the %s choice as purpose %s, paid by the office: %s", (kind, purpose, office) => {
    const res = parsePaymentForm(form({ ...VALID, kind }), TODAY);
    expect(res.ok && [res.data.purpose, res.data.paid_by_office]).toEqual([purpose, office]);
  });

  it("refuses a kind that is not offered — a write-off is not recorded here", () => {
    for (const kind of ["write_off", "kseb_fees", "tips", "toString"]) {
      expect(errorOf(parsePaymentForm(form({ ...VALID, kind }), TODAY))).toBe(
        "Choose what the payment is for.",
      );
    }
  });

  it("ignores a purpose or an office tick posted on its own", () => {
    // Only the choice decides: a contract payment cannot be marked office-paid.
    const res = parsePaymentForm(
      form({ ...VALID, purpose: "write_off", paid_by_office: "true" }),
      TODAY,
    );
    expect(res.ok && [res.data.purpose, res.data.paid_by_office]).toEqual(["contract", false]);
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

  it("words a refund's and an office payment's mistakes for what they are", () => {
    const refund = { ...VALID, kind: "refund" };
    expect(errorOf(parsePaymentForm(form({ ...refund, amount: "" }), TODAY))).toBe(
      "Enter the amount refunded, in rupees.",
    );
    expect(errorOf(parsePaymentForm(form({ ...refund, paid_on: "" }), TODAY))).toBe(
      "Enter the date the refund was paid.",
    );
    expect(errorOf(parsePaymentForm(form({ ...refund, paid_on: "2026-10-11" }), TODAY))).toBe(
      "The refund date cannot be in the future.",
    );
    expect(
      errorOf(parsePaymentForm(form({ ...VALID, kind: "kseb_office", amount: "" }), TODAY)),
    ).toBe("Enter the amount paid, in rupees.");
  });

  it("rejects an unknown method", () => {
    expect(errorOf(parsePaymentForm(form({ ...VALID, method: "barter" }), TODAY))).toBe(
      "Choose how the payment was made.",
    );
    expect(errorOf(parsePaymentForm(form({ ...VALID, method: "" }), TODAY))).toBe(
      "Choose how the payment was made.",
    );
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

describe("parseWriteOffForm", () => {
  const WRITE_OFF = {
    amount: "800",
    paid_on: "2026-10-01",
    reason: "  Customer was ₹800 short at handover; waived by the office ",
  };

  it("reads an amount, a date and a reason — and nothing about money moving", () => {
    expect(parseWriteOffForm(form(WRITE_OFF), TODAY)).toEqual({
      ok: true,
      data: {
        amount: 800,
        paid_on: "2026-10-01",
        method: "other",
        purpose: "write_off",
        paid_by_office: false,
        reference: null,
        notes: "Customer was ₹800 short at handover; waived by the office",
      },
    });
  });

  it.each(["", "   "])("refuses a write-off with no reason (%j)", (reason) => {
    expect(errorOf(parseWriteOffForm(form({ ...WRITE_OFF, reason }), TODAY))).toBe(
      WRITE_OFF_REASON_ERROR,
    );
    expect(errorOf(parseWriteOffForm(form({ amount: "800", paid_on: TODAY }), TODAY))).toBe(
      WRITE_OFF_REASON_ERROR,
    );
  });

  it("ignores a method, reference or purpose posted alongside", () => {
    const res = parseWriteOffForm(
      form({ ...WRITE_OFF, method: "cash", reference: "UTR 1", purpose: "contract" }),
      TODAY,
    );
    expect(res.ok && res.data).toMatchObject({
      method: "other",
      purpose: "write_off",
      reference: null,
    });
  });

  it("holds the reason to the notes length", () => {
    const long = "x".repeat(PAYMENT_LIMITS.notesLength + 1);
    expect(errorOf(parseWriteOffForm(form({ ...WRITE_OFF, reason: long }), TODAY))).toBe(
      `The reason must be ${PAYMENT_LIMITS.notesLength} characters or fewer.`,
    );
    expect(
      parseWriteOffForm(form({ ...WRITE_OFF, reason: "x".repeat(PAYMENT_LIMITS.notesLength) }), TODAY).ok,
    ).toBe(true);
  });

  it.each([
    [{ amount: "" }, "Enter the amount to write off, in rupees."],
    [{ amount: "0" }, "The amount must be more than zero."],
    [{ amount: "800.555" }, "at most 2 decimal places"],
    [{ paid_on: "" }, "Enter the date of the write-off."],
    [{ paid_on: "2026-10-11" }, "The write-off date cannot be in the future."],
  ])("rejects %j", (patch, message) => {
    expect(errorOf(parseWriteOffForm(form({ ...WRITE_OFF, ...patch }), TODAY))).toContain(message);
  });
});

/** A stored entry for the cap tests: money in unless said otherwise. */
function entry(
  id: string,
  amount: number,
  paid_on: string,
  purpose: StoredLedgerEntry["purpose"] = "contract",
  paid_by_office = false,
): StoredLedgerEntry {
  return { id, amount, paid_on, purpose, paid_by_office };
}

/** The body a form would hand `checkLedgerChange`. */
function body(
  amount: number,
  purpose: PaymentInput["purpose"] = "contract",
  paid_on = "2026-10-05",
): PaymentInput {
  return {
    amount,
    paid_on,
    method: "bank_transfer",
    purpose,
    paid_by_office: false,
    reference: null,
    notes: purpose === "write_off" ? "Waived" : null,
  };
}

describe("checkLedgerChange — recording", () => {
  // ₹1,95,000 contract, ₹20,000 advance, ₹80,000 stage 1 → ₹95,000 due.
  const terms = { total_cost: 195000, advance_amount: 20000 };
  const ledger = [
    entry("p1", 80000, "2026-09-01"),
    entry("k1", 5720, "2026-09-02", "kseb_fees"),
  ];
  const add = (e: PaymentInput, over = ledger) =>
    checkLedgerChange({ terms, ledger: over, change: { kind: "add", entry: e } });

  it("allows a contract payment within the balance and reports the new balance", () => {
    expect(add(body(45000))).toEqual({ ok: true, data: { balanceAfter: 50000 } });
  });

  it("allows settling the balance exactly", () => {
    expect(add(body(95000))).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });

  it("rejects a contract payment above the balance, naming the balance", () => {
    const res = add(body(100000));
    expect(res.ok).toBe(false);
    const error = errorOf(res) ?? "";
    expect(error).toContain("₹95,000");
    expect(error).toContain("₹1,00,000");
    expect(error).toMatch(/correct the work order's total cost first/);
  });

  it("explains a fully paid contract", () => {
    const res = checkLedgerChange({
      terms: { total_cost: 100000, advance_amount: 100000 },
      ledger: [],
      change: { kind: "add", entry: body(1) },
    });
    expect(errorOf(res)).toMatch(/Nothing is due on this contract/);
  });

  it("never caps KSEB-fee entries, whoever paid them (they are not contract money)", () => {
    const paid = { total_cost: 100000, advance_amount: 100000 };
    for (const paid_by_office of [false, true]) {
      const res = checkLedgerChange({
        terms: paid,
        ledger: [],
        change: { kind: "add", entry: { ...body(50000, "kseb_fees"), paid_by_office } },
      });
      expect(res).toEqual({ ok: true, data: { balanceAfter: 0 } });
    }
  });

  it("copes with decimal strings from PostgREST", () => {
    const res = checkLedgerChange({
      terms: { total_cost: "1000.30", advance_amount: "0.10" },
      ledger: [{ id: "p1", amount: "0.20", paid_on: "2026-09-01", purpose: "contract" }],
      change: { kind: "add", entry: body(1000) },
    });
    expect(res).toEqual({ ok: true, data: { balanceAfter: 0 } });
  });

  describe("a refund", () => {
    // Collected: 20,000 advance + 80,000 = ₹1,00,000.
    it("may be as much as was collected, and puts the balance back up", () => {
      expect(add(body(100000, "refund"))).toEqual({ ok: true, data: { balanceAfter: 195000 } });
      expect(add(body(10000, "refund"))).toEqual({ ok: true, data: { balanceAfter: 105000 } });
    });

    it("may not exceed what was collected, and says how much was", () => {
      const error = errorOf(add(body(100000.01, "refund"))) ?? "";
      expect(error).toMatch(/^A refund of ₹1,00,000\.01 is more than the ₹1,00,000\.00 collected/);
      expect(error).toContain("less refunds already made");
    });

    it("counts refunds already made", () => {
      const refunded = [...ledger, entry("r1", 30000, "2026-09-20", "refund")];
      expect(add(body(70000, "refund"), refunded).ok).toBe(true);
      expect(errorOf(add(body(70000.01, "refund"), refunded))).toContain("₹70,000.00 collected");
    });

    it("has nothing to refund before anything was collected", () => {
      const res = checkLedgerChange({
        terms: { total_cost: 100000, advance_amount: 0 },
        ledger: [],
        change: { kind: "add", entry: body(1, "refund") },
      });
      expect(errorOf(res)).toMatch(/^Nothing has been collected on this contract as of .*, so there is nothing to refund\.$/);
    });

    it("never counts KSEB fees as money to give back", () => {
      const onlyFees = [entry("k1", 5720, "2026-09-02", "kseb_fees")];
      const res = checkLedgerChange({
        terms: { total_cost: 100000, advance_amount: 0 },
        ledger: onlyFees,
        change: { kind: "add", entry: body(100, "refund") },
      });
      expect(res.ok).toBe(false);
    });

    it("is judged at its date: money collected later cannot be refunded earlier", () => {
      // The ₹80,000 came on 1 Sep; a refund dated before it had nothing to draw on
      // beyond the ₹20,000 advance.
      const early = body(30000, "refund", "2026-08-15");
      expect(errorOf(add(early))).toContain("₹20,000.00 collected");
    });
  });

  describe("the contract cap counts refunds and write-offs", () => {
    it("lets the customer pay again what was refunded", () => {
      const refunded = [...ledger, entry("r1", 10000, "2026-09-20", "refund")];
      // 1,95,000 − (20,000 + 80,000 − 10,000) = 1,05,000 due.
      expect(add(body(105000), refunded)).toEqual({ ok: true, data: { balanceAfter: 0 } });
      expect(errorOf(add(body(105000.01), refunded))).toContain("₹1,05,000.00 balance due");
    });

    it("takes away what was written off", () => {
      const writtenOff = [...ledger, entry("w1", 800, "2026-09-20", "write_off")];
      expect(add(body(94200), writtenOff)).toEqual({ ok: true, data: { balanceAfter: 0 } });
      expect(errorOf(add(body(94200.01), writtenOff))).toContain("₹94,200.00 balance due");
    });
  });

  describe("a write-off", () => {
    it("may be the whole balance — the sale is then settled", () => {
      expect(add(body(95000, "write_off"))).toEqual({ ok: true, data: { balanceAfter: 0 } });
    });

    it("may be part of it", () => {
      expect(add(body(800, "write_off"))).toEqual({ ok: true, data: { balanceAfter: 94200 } });
    });

    it("may not exceed the balance due, and says how much is", () => {
      const error = errorOf(add(body(95000.01, "write_off"))) ?? "";
      expect(error).toMatch(/^A write-off of ₹95,000\.01 is more than the ₹95,000\.00 balance due as of /);
    });

    it("has nothing to write off on a settled contract", () => {
      const settled = [entry("p1", 175000, "2026-09-01")];
      expect(errorOf(add(body(1, "write_off"), settled))).toMatch(
        /^Nothing is due on this contract as of .*, so there is nothing to write off\.$/,
      );
    });

    it("counts earlier write-offs and refunds", () => {
      const prior = [
        ...ledger,
        entry("w1", 800, "2026-09-10", "write_off"),
        entry("r1", 1000, "2026-09-12", "refund"),
      ];
      // 1,95,000 − (99,000) − 800 = 95,200 due.
      expect(add(body(95200, "write_off"), prior).ok).toBe(true);
      expect(add(body(95200.01, "write_off"), prior).ok).toBe(false);
    });
  });
});

describe("checkLedgerChange — editing", () => {
  const terms = { total_cost: 195000, advance_amount: 20000 };
  const ledger = [
    entry("p1", 80000, "2026-09-01"),
    entry("k1", 5720, "2026-09-02", "kseb_fees"),
  ];
  const replace = (id: string, e: PaymentInput, over = ledger) =>
    checkLedgerChange({ terms, ledger: over, change: { kind: "replace", id, entry: e } });

  it("releases the edited entry's own amount before checking", () => {
    // Raising stage 1 from 80,000 to 175,000 uses the whole 1,75,000 headroom.
    expect(replace("p1", body(175000))).toEqual({ ok: true, data: { balanceAfter: 0 } });
    expect(errorOf(replace("p1", body(175001)))).toContain("₹1,75,000");
  });

  it("caps a KSEB-fee entry being re-classified as contract money", () => {
    const res = checkLedgerChange({
      terms: { total_cost: 100000, advance_amount: 100000 },
      ledger: [entry("k1", 5720, "2026-09-02", "kseb_fees")],
      change: { kind: "replace", id: "k1", entry: body(5720) },
    });
    expect(res.ok).toBe(false);
  });

  it("still allows corrections on a contract that is already overpaid", () => {
    // Total lowered after collection: 1,00,000 advance + 50,000 ledger on a
    // 1,20,000 contract = 30,000 overpaid.
    const overpaid = {
      terms: { total_cost: 120000, advance_amount: 100000 },
      ledger: [entry("p1", 50000, "2026-09-01")],
    };
    const edit = (amount: number) =>
      checkLedgerChange({
        ...overpaid,
        change: { kind: "replace", id: "p1", entry: body(amount) },
      });
    // Same amount (e.g. fixing the reference) — not worse, so allowed.
    expect(edit(50000).ok).toBe(true);
    // Lowering it moves towards zero — allowed.
    expect(edit(20000)).toEqual({ ok: true, data: { balanceAfter: 0 } });
    // Raising it makes the overpayment worse — rejected, and says by how much.
    expect(errorOf(edit(60000))).toBe(
      "₹60,000.00 is more than the ₹20,000.00 balance due on this contract. If the customer paid more than agreed, correct the work order's total cost first.",
    );
  });

  it("reports an existing overpayment when nothing is available", () => {
    const res = checkLedgerChange({
      terms: { total_cost: 120000, advance_amount: 150000 },
      ledger: [],
      change: { kind: "add", entry: body(1000) },
    });
    expect(errorOf(res)).toMatch(/already overpaid by ₹30,000/);
  });

  describe("with a refund or write-off in the ledger", () => {
    const withRefund = [
      entry("p1", 80000, "2026-09-01"),
      entry("r1", 90000, "2026-09-20", "refund"),
    ];

    it("will not lower a payment below the refund paid out of it", () => {
      // Collected 20,000 + 80,000 = 1,00,000, of which 90,000 went back. Taking
      // the payment down to ₹60,000 would leave a refund of 90,000 against 80,000.
      const error = errorOf(replace("p1", body(60000, "contract", "2026-09-01"), withRefund)) ?? "";
      expect(error).toMatch(/^This change would leave the refund of ₹90,000\.00 on /);
      expect(error).toContain("larger than the ₹80,000.00 collected by then");
      expect(error).toMatch(/Correct that refund first\.$/);
    });

    it("will not move a payment to after the refund it funded", () => {
      expect(errorOf(replace("p1", body(80000, "contract", "2026-09-25"), withRefund))).toMatch(
        /would leave the refund of ₹90,000\.00/,
      );
    });

    it("allows a payment correction that keeps the refund covered", () => {
      expect(replace("p1", body(75000, "contract", "2026-09-01"), withRefund).ok).toBe(true);
    });

    it("holds an edited refund to what was collected", () => {
      expect(replace("r1", body(100000, "refund", "2026-09-20"), withRefund).ok).toBe(true);
      expect(errorOf(replace("r1", body(100000.01, "refund", "2026-09-20"), withRefund))).toMatch(
        /^A refund of ₹1,00,000\.01 is more than the ₹1,00,000\.00 collected/,
      );
    });

    it("will not shrink a refund into an overpayment", () => {
      // 1,00,000 paid on a 95,000... fully paid again after the refund; shrinking
      // the refund would leave the customer over the contract.
      const repaid = [
        entry("p1", 175000, "2026-09-01"),
        entry("r1", 20000, "2026-09-10", "refund"),
        entry("p2", 20000, "2026-09-15"),
      ];
      const res = replace("r1", body(10000, "refund", "2026-09-10"), repaid);
      expect(errorOf(res)).toBe(
        "This change would leave the contract overpaid by ₹10,000.00. If a payment was recorded in error, correct it in the payments ledger first.",
      );
    });

    it("will not raise a payment past the balance a write-off closed, and says so as an overpayment", () => {
      // ₹1,000 sold; ₹200 paid and ₹800 written off: settled. Raising the
      // payment to ₹300 would leave ₹100 more than the contract.
      const settled = {
        terms: { total_cost: 1000, advance_amount: 0 },
        ledger: [entry("p1", 200, "2026-09-01"), entry("w1", 800, "2026-09-10", "write_off")],
      };
      const edit = (amount: number) =>
        checkLedgerChange({
          ...settled,
          change: { kind: "replace", id: "p1", entry: body(amount, "contract", "2026-09-01") },
        });
      expect(errorOf(edit(300))).toMatch(/^₹300.00 is more than the ₹200.00 balance due/);
      expect(edit(200).ok).toBe(true);
    });

    it("allows deleting a payment under a write-off: more is then due, never less", () => {
      const ledger = [entry("p1", 200, "2026-09-01"), entry("w1", 800, "2026-09-10", "write_off")];
      expect(
        checkLedgerChange({
          terms: { total_cost: 1000, advance_amount: 0 },
          ledger,
          change: { kind: "remove", id: "p1" },
        }).ok,
      ).toBe(true);
    });
  });

  it("leaves a problem that was already there alone when something else is corrected", () => {
    // A refund that already exceeds what was collected (data from before the caps).
    const bad = [
      entry("p1", 80000, "2026-09-01"),
      entry("r1", 120000, "2026-09-20", "refund"),
    ];
    const res = replace("p1", body(80000, "contract", "2026-09-01"), bad);
    expect(res.ok).toBe(true);
  });
});

describe("checkLedgerChange — deleting", () => {
  const terms = { total_cost: 195000, advance_amount: 20000 };
  const remove = (id: string, ledger: StoredLedgerEntry[]) =>
    checkLedgerChange({ terms, ledger, change: { kind: "remove", id } });

  it("allows deleting an entry nothing relies on, and reports the balance after", () => {
    const ledger = [entry("p1", 80000, "2026-09-01"), entry("p2", 5000, "2026-09-10")];
    // 1,95,000 − 20,000 advance − 80,000 left.
    expect(remove("p2", ledger)).toEqual({ ok: true, data: { balanceAfter: 95000 } });
  });

  it("refuses to delete the payment a refund was paid out of", () => {
    const ledger = [
      entry("p1", 80000, "2026-09-01"),
      entry("r1", 90000, "2026-09-20", "refund"),
    ];
    // Without the ₹80,000 only the ₹20,000 advance was collected: the ₹90,000
    // refund would have had nothing to come out of.
    expect(errorOf(remove("p1", ledger))).toMatch(
      /^This change would leave the refund of ₹90,000\.00 on .* larger than the ₹20,000\.00 collected by then\. Correct that refund first\.$/,
    );
  });

  it("allows deleting the refund itself", () => {
    const ledger = [
      entry("p1", 80000, "2026-09-01"),
      entry("r1", 90000, "2026-09-20", "refund"),
    ];
    expect(remove("r1", ledger)).toEqual({ ok: true, data: { balanceAfter: 95000 } });
  });

  it("refuses to delete a refund that leaves the contract overpaid", () => {
    const ledger = [
      entry("p1", 175000, "2026-09-01"),
      entry("r1", 20000, "2026-09-10", "refund"),
      entry("p2", 20000, "2026-09-15"),
    ];
    expect(errorOf(remove("r1", ledger))).toBe(
      "This change would leave the contract overpaid by ₹20,000.00. If a payment was recorded in error, correct it in the payments ledger first.",
    );
  });

  it("allows deleting a write-off: the balance is simply due again", () => {
    const ledger = [
      entry("p1", 174200, "2026-09-01"),
      entry("w1", 800, "2026-09-20", "write_off"),
    ];
    expect(remove("w1", ledger)).toEqual({ ok: true, data: { balanceAfter: 800 } });
  });

  it("refuses to delete a refund a later write-off was sized against", () => {
    // 1,95,000 contract; 1,00,000 collected; 5,000 refunded → 1,00,000 due; a
    // write-off of 1,00,000 closes it. Without the refund only 95,000 is due.
    const ledger = [
      entry("p1", 80000, "2026-09-01"),
      entry("r1", 5000, "2026-09-10", "refund"),
      entry("w1", 100000, "2026-09-20", "write_off"),
    ];
    expect(errorOf(remove("r1", ledger))).toMatch(
      /^This change would leave the write-off of ₹1,00,000\.00 on .* larger than the ₹95,000\.00 due by then\. Correct that write-off first\.$/,
    );
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

  describe("with refunds and write-offs in the ledger", () => {
    // ₹2,00,000 contract, ₹20,000 advance + ₹1,80,000 paid, ₹10,000 refunded →
    // ₹10,000 due.
    const refunded = [
      { amount: 180000, paid_on: "2026-09-01", purpose: "contract" as const },
      { amount: 10000, paid_on: "2026-09-20", purpose: "refund" as const },
    ];

    it("counts the refund: the money returned is not received", () => {
      expect(checkContractTerms({ current, terms: current, ledger: refunded })).toEqual({
        ok: true,
        data: { balanceAfter: 10000 },
      });
      // Raising the advance by what was refunded settles the contract exactly.
      expect(
        checkContractTerms({
          current,
          terms: { total_cost: 200000, advance_amount: 30000 },
          ledger: refunded,
        }).ok,
      ).toBe(true);
      expect(
        checkContractTerms({
          current,
          terms: { total_cost: 200000, advance_amount: 30001 },
          ledger: refunded,
        }).ok,
      ).toBe(false);
    });

    it("counts the write-off: what was given up is not due", () => {
      const writtenOff = [
        { amount: 179200, paid_on: "2026-09-01", purpose: "contract" as const },
        { amount: 800, paid_on: "2026-09-20", purpose: "write_off" as const },
      ];
      expect(checkContractTerms({ current, terms: current, ledger: writtenOff })).toEqual({
        ok: true,
        data: { balanceAfter: 0 },
      });
      expect(
        checkContractTerms({
          current,
          terms: { total_cost: 199199, advance_amount: 20000 },
          ledger: writtenOff,
        }).ok,
      ).toBe(false);
    });

    it("refuses terms that would leave a refund larger than what was collected", () => {
      // Lowering the advance from 20,000 to 0 leaves 1,80,000 collected: the
      // refund still fits. A 2,00,000 refund against it would not.
      const big = [
        { amount: 180000, paid_on: "2026-09-01", purpose: "contract" as const },
        { amount: 190000, paid_on: "2026-09-20", purpose: "refund" as const },
      ];
      const res = checkContractTerms({
        current,
        terms: { total_cost: 200000, advance_amount: 5000 },
        ledger: big,
      });
      expect(errorOf(res)).toMatch(
        /^These terms would leave the refund of ₹1,90,000\.00 on .* larger than the ₹1,85,000\.00 collected by then\. Correct that refund in the payments ledger first\.$/,
      );
    });
  });
});

describe("recordedMessage", () => {
  const base = body(45000);

  it("says what went into the ledger, in the words the office uses", () => {
    expect(recordedMessage(base, 50000)).toBe(`Payment of ${formatCurrency(45000)} recorded.`);
    expect(recordedMessage(body(3540, "kseb_fees"), 50000)).toBe(
      `KSEB fee of ${formatCurrency(3540)} recorded.`,
    );
    expect(recordedMessage({ ...body(5720, "kseb_fees"), paid_by_office: true }, 50000)).toBe(
      `KSEB fee of ${formatCurrency(5720)} recorded as paid by the office.`,
    );
    expect(recordedMessage(body(10000, "refund"), 105000)).toBe(
      `Refund of ${formatCurrency(10000)} recorded.`,
    );
  });

  it("says whether a write-off settled the sale", () => {
    expect(recordedMessage(body(800, "write_off"), 0)).toBe(
      `${formatCurrency(800)} written off — the balance is settled.`,
    );
    expect(recordedMessage(body(500, "write_off"), 300)).toBe(
      `${formatCurrency(500)} written off — ${formatCurrency(300)} still due.`,
    );
  });
});
