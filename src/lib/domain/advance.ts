import { formatCurrency, formatDate } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { PAYMENT_METHOD_LABELS } from "./payment";

/**
 * How and when the booking advance was paid. Three optional columns on the work
 * order (`advance_method`, `advance_paid_on`, `advance_reference`): the advance
 * itself stays `advance_amount`, and these only describe it. They are locked
 * with it — a coordinator edits them only while the sale is pending, the office
 * always (the database guards the same).
 */
export interface AdvanceDetails {
  advance_method: PaymentMethod | null;
  advance_paid_on: string | null;
  advance_reference: string | null;
}

/** The method select's value for "not recorded" — a select cannot hold an empty option. */
export const ADVANCE_METHOD_NONE = "none";

export const ADVANCE_WITHOUT_AMOUNT_ERROR =
  "How or when the advance was paid is filled in, but there is no advance amount — enter the advance, or clear its method, date and reference.";

export function hasAdvanceDetails(details: Partial<AdvanceDetails>): boolean {
  return Boolean(
    details.advance_method || details.advance_paid_on || details.advance_reference,
  );
}

/**
 * Details of an advance that was never taken mean nothing, and are almost
 * always a typo in the amount: refuse them instead of storing them. The import
 * holds a row to the same rule.
 */
export function advanceDetailsProblem(
  advance: number,
  details: Partial<AdvanceDetails>,
): string | null {
  return advance <= 0 && hasAdvanceDetails(details) ? ADVANCE_WITHOUT_AMOUNT_ERROR : null;
}

/**
 * The advance as one line — "Advance ₹50,000.00 · UPI · 04 Feb 2025 · UTR 1" —
 * for the ledger's header and the work-order page. Null when there is nothing to
 * say: no advance was taken and nothing is recorded about one.
 */
export function advanceSummary(
  advance: number,
  details: Partial<AdvanceDetails>,
): string | null {
  if (advance <= 0 && !hasAdvanceDetails(details)) return null;
  const parts = [`Advance ${formatCurrency(advance)}`];
  if (details.advance_method) parts.push(PAYMENT_METHOD_LABELS[details.advance_method]);
  if (details.advance_paid_on) parts.push(formatDate(details.advance_paid_on));
  if (details.advance_reference) parts.push(details.advance_reference);
  return parts.join(" · ");
}
