import { dec, str, text } from "@/server/form";
import { isIsoDate } from "@/lib/domain/dates";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import {
  isPaymentMethod,
  isPaymentPurpose,
  ledgerTotals,
  paymentSummary,
  type LedgerEntry,
  type PaymentSource,
} from "@/lib/domain/payment";
import { fail, ok, type ActionResult } from "@/lib/result";
import { formatCurrency } from "@/lib/format";
import type { PaymentPurpose } from "@/lib/types";
import type { PaymentInput } from "@/server/data/payments.repository";

/**
 * Parsing and business rules for a payments-ledger entry, kept free of I/O so
 * the server actions stay thin and every rule is unit-tested.
 */

/** Plain rupees with at most two decimals ("25000", "25000.5", "25000.50"). */
const PLAIN_AMOUNT = /^\d+(\.\d{1,2})?$/;

function parseAmount(raw: string): ActionResult<number> {
  const value = dec(raw);
  if (value === null) return fail("Enter the amount received, in rupees.");
  if (value <= 0) return fail("The amount must be more than zero.");
  if (!PLAIN_AMOUNT.test(raw)) {
    return fail(
      "Enter the amount as a plain number with at most 2 decimal places, e.g. 25000.50.",
    );
  }
  if (value > PAYMENT_LIMITS.maxAmount) {
    return fail("That amount is too large — check for extra digits.");
  }
  return ok(value);
}

function capped(
  value: string | null,
  max: number,
  label: string,
): ActionResult<string | null> {
  if (value !== null && value.length > max) {
    return fail(`${label} must be ${max} characters or fewer.`);
  }
  return ok(value);
}

/**
 * Read a ledger entry from a submitted form. `today` is the IST calendar date —
 * a payment cannot have been received in the future.
 */
export function parsePaymentForm(
  formData: FormData,
  today: string,
): ActionResult<PaymentInput> {
  const amount = parseAmount(text(formData.get("amount")));
  if (!amount.ok) return amount;

  const paidOn = text(formData.get("paid_on"));
  if (!isIsoDate(paidOn)) return fail("Enter the date the payment was received.");
  if (paidOn > today) return fail("The payment date cannot be in the future.");

  const method = text(formData.get("method"));
  if (!isPaymentMethod(method)) return fail("Choose how the payment was made.");

  const purpose = text(formData.get("purpose")) || "contract";
  if (!isPaymentPurpose(purpose)) return fail("Choose what the payment is for.");

  const reference = capped(
    str(formData.get("reference")),
    PAYMENT_LIMITS.referenceLength,
    "Reference",
  );
  if (!reference.ok) return reference;

  const notes = capped(str(formData.get("notes")), PAYMENT_LIMITS.notesLength, "Notes");
  if (!notes.ok) return notes;

  return ok({
    amount: amount.data,
    paid_on: paidOn,
    method,
    purpose,
    reference: reference.data,
    notes: notes.data,
  });
}

/** A stored ledger entry, as far as the cap needs it. */
export interface StoredLedgerEntry extends LedgerEntry {
  id: string;
}

/** Contract balance given the ledger, plus any extra contract amount. */
function balanceWith(
  contract: PaymentSource,
  entries: readonly LedgerEntry[],
  extra = 0,
): number {
  return paymentSummary({
    ...contract,
    payments_total: ledgerTotals(entries).contract + extra,
  }).balanceDue;
}

function overpaymentMessage(amount: number, available: number): string {
  const fix =
    "If the customer paid more than agreed, correct the work order's total cost first.";
  if (available > 0) {
    return `${formatCurrency(amount)} is more than the ${formatCurrency(available)} balance due on this contract. ${fix}`;
  }
  if (available === 0) {
    return `Nothing is due on this contract — the balance is ${formatCurrency(0)}. ${fix}`;
  }
  return `This contract is already overpaid by ${formatCurrency(-available)}. ${fix}`;
}

/**
 * A contract payment may not take the contract balance below zero: an
 * overpayment almost always means a typo, or a contract total that was never
 * updated. KSEB-fee entries do not count towards the contract and are never
 * capped.
 *
 * When editing (`editingId`), the entry's current amount is released first.
 * An edit that does not make the balance worse is always allowed, so a contract
 * that is already overpaid (its total was lowered later) can still have its
 * entries corrected.
 *
 * Returns the contract balance after the entry is applied.
 */
export function checkContractCap(input: {
  contract: Pick<PaymentSource, "total_cost" | "advance_amount">;
  ledger: readonly StoredLedgerEntry[];
  entry: { amount: number; purpose: PaymentPurpose };
  editingId?: string | null;
}): ActionResult<{ balanceAfter: number }> {
  const { contract, ledger, entry, editingId } = input;
  const others = editingId ? ledger.filter((e) => e.id !== editingId) : ledger;

  const before = balanceWith(contract, ledger);
  const available = balanceWith(contract, others);
  const balanceAfter = balanceWith(
    contract,
    others,
    entry.purpose === "contract" ? entry.amount : 0,
  );

  if (entry.purpose === "contract" && balanceAfter < 0 && balanceAfter < before) {
    return fail(overpaymentMessage(entry.amount, available));
  }
  return ok({ balanceAfter });
}

/**
 * The same cap as `checkContractCap`, from the work order's side: new contract
 * terms (total cost and booking advance) may not take the balance below zero
 * against the contract payments already in the ledger — raising the advance or
 * lowering the total past what has been collected would otherwise settle (or
 * overpay) a contract with no payment recorded. As with an entry edit, terms
 * that do not make the balance worse are always allowed, so the other details
 * of an already-overpaid order can still be corrected.
 *
 * Returns the contract balance under the new terms.
 */
export function checkContractTerms(input: {
  current: Pick<PaymentSource, "total_cost" | "advance_amount">;
  terms: Pick<PaymentSource, "total_cost" | "advance_amount">;
  ledger: readonly LedgerEntry[];
}): ActionResult<{ balanceAfter: number }> {
  const { current, terms, ledger } = input;
  const before = balanceWith(current, ledger);
  const after = paymentSummary({
    ...terms,
    payments_total: ledgerTotals(ledger).contract,
  });

  if (after.balanceDue < 0 && after.balanceDue < before) {
    const fix = "If a payment was recorded in error, correct it in the payments ledger first.";
    return fail(
      `The advance and the contract payments recorded come to ${formatCurrency(after.received)}, ` +
        `more than the ${formatCurrency(after.totalCost)} total cost — this contract would be ` +
        `overpaid by ${formatCurrency(-after.balanceDue)}. ${fix}`,
    );
  }
  return ok({ balanceAfter: after.balanceDue });
}
