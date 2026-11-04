import { describe, expect, it } from "vitest";
import {
  PAYMENT_KINDS,
  isPaymentKind,
  kindOfEntry,
  paymentKind,
  type PaymentKind,
} from "./payment-kinds";

describe("PAYMENT_KINDS", () => {
  it("offers exactly the four choices the office makes, in this order", () => {
    expect(PAYMENT_KINDS.map((kind) => kind.label)).toEqual([
      "Contract payment",
      "KSEB fee collected from the customer",
      "KSEB fee paid by the office",
      "Refund",
    ]);
  });

  it("folds the paid-by-office tick into the KSEB choice, and nowhere else", () => {
    expect(PAYMENT_KINDS.map((k) => [k.value, k.purpose, k.paidByOffice])).toEqual([
      ["contract", "contract", false],
      ["kseb_customer", "kseb_fees", false],
      ["kseb_office", "kseb_fees", true],
      ["refund", "refund", false],
    ]);
  });

  it("never offers a write-off: that is its own office-only dialog", () => {
    expect(PAYMENT_KINDS.map((kind) => kind.purpose)).not.toContain("write_off");
    expect(isPaymentKind("write_off")).toBe(false);
  });

  it("says money coming in was received and money going out was paid", () => {
    expect(paymentKind("contract").dateLabel).toBe("Received on");
    expect(paymentKind("kseb_customer").dateLabel).toBe("Received on");
    expect(paymentKind("kseb_office").dateLabel).toBe("Paid on");
    expect(paymentKind("refund").dateLabel).toBe("Paid on");
  });

  it("names the submit for what is being recorded", () => {
    expect(paymentKind("refund").action).toBe("Record refund");
    expect(paymentKind("contract").action).toBe("Record payment");
  });
});

describe("isPaymentKind", () => {
  it.each(["contract", "kseb_customer", "kseb_office", "refund"])("accepts %s", (kind) => {
    expect(isPaymentKind(kind)).toBe(true);
  });

  it.each(["", "kseb_fees", "tips", "constructor", "toString"])("refuses %j", (kind) => {
    expect(isPaymentKind(kind)).toBe(false);
  });
});

describe("kindOfEntry", () => {
  it.each<[Parameters<typeof kindOfEntry>[0], PaymentKind | null]>([
    [{ purpose: "contract" }, "contract"],
    [{ purpose: "kseb_fees", paid_by_office: false }, "kseb_customer"],
    [{ purpose: "kseb_fees" }, "kseb_customer"],
    [{ purpose: "kseb_fees", paid_by_office: true }, "kseb_office"],
    [{ purpose: "refund" }, "refund"],
    [{ purpose: "write_off" }, null],
  ])("reads %j as %s", (entry, kind) => {
    expect(kindOfEntry(entry)).toBe(kind);
  });

  it("round-trips every kind through the purpose it records", () => {
    for (const kind of PAYMENT_KINDS) {
      expect(kindOfEntry({ purpose: kind.purpose, paid_by_office: kind.paidByOffice })).toBe(
        kind.value,
      );
    }
  });
});
