import type { PaymentPurpose } from "@/lib/types";

/**
 * What the person recording a ledger entry chooses between.
 *
 * The ledger stores a purpose and, for a KSEB fee, who paid it (`paid_by_office`).
 * The form folds the two into one plain choice, so nobody has to know that
 * "KSEB fees" and "paid by the office" belong together — and "paid by the office"
 * cannot be ticked on a contract payment or a refund.
 *
 * A write-off is not offered here: it has its own office-only dialog (it closes
 * a balance rather than moving money, and it always carries a reason).
 */
export type PaymentKind = "contract" | "kseb_customer" | "kseb_office" | "refund";

export interface PaymentKindInfo {
  value: PaymentKind;
  /** The option, as the form lists it. */
  label: string;
  /** The ledger purpose it records. */
  purpose: Exclude<PaymentPurpose, "write_off">;
  /** `kseb_fees` only: the BSS office paid KSEB on the customer's behalf. */
  paidByOffice: boolean;
  /** What the date is: money coming in is "Received on", money going out is "Paid on". */
  dateLabel: string;
  /** One line under the choice: what it does to the books. */
  hint: string;
  /** The submit button. */
  action: string;
}

export const PAYMENT_KINDS: readonly PaymentKindInfo[] = [
  {
    value: "contract",
    label: "Contract payment",
    purpose: "contract",
    paidByOffice: false,
    dateLabel: "Received on",
    hint: "Money from the customer towards the contract. It lowers the balance due.",
    action: "Record payment",
  },
  {
    value: "kseb_customer",
    label: "KSEB fee collected from the customer",
    purpose: "kseb_fees",
    paidByOffice: false,
    dateLabel: "Received on",
    hint: "Collected for KSEB through BSS. Kept apart from the contract: it never reduces the balance due.",
    action: "Record payment",
  },
  {
    value: "kseb_office",
    label: "KSEB fee paid by the office",
    purpose: "kseb_fees",
    paidByOffice: true,
    dateLabel: "Paid on",
    hint: "The office paid KSEB on the customer's behalf. Kept apart from the contract: it never reduces the balance due.",
    action: "Record payment",
  },
  {
    value: "refund",
    label: "Refund",
    purpose: "refund",
    paidByOffice: false,
    dateLabel: "Paid on",
    hint: "Money returned to the customer. It lowers the net received, so the balance due goes back up.",
    action: "Record refund",
  },
];

export function isPaymentKind(value: string): value is PaymentKind {
  return PAYMENT_KINDS.some((kind) => kind.value === value);
}

export function paymentKind(value: PaymentKind): PaymentKindInfo {
  // The registry holds every kind; the lookup cannot miss.
  return PAYMENT_KINDS.find((kind) => kind.value === value) as PaymentKindInfo;
}

/**
 * The choice a stored entry corresponds to — what the edit form starts on. Null
 * for a write-off, which is edited in its own dialog.
 */
export function kindOfEntry(entry: {
  purpose: PaymentPurpose;
  paid_by_office?: boolean | null;
}): PaymentKind | null {
  switch (entry.purpose) {
    case "contract":
      return "contract";
    case "kseb_fees":
      return entry.paid_by_office ? "kseb_office" : "kseb_customer";
    case "refund":
      return "refund";
    case "write_off":
      return null;
  }
}
