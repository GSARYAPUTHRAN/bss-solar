/**
 * Collections against a work order.
 *
 * Money arrives in up to three tranches: the advance taken at order time, then
 * two staged instalments. The app-side maths here mirrors the SQL helper
 * `wo_amount_received(...)` and the derived `projects_list.payment_pending`
 * column, so a figure rendered by a page always agrees with a figure filtered
 * or counted in Postgres (pinned by tests/integration/payments.test.ts).
 */

/** The subset of a work order the payment maths needs. */
export interface PaymentSource {
  total_cost?: number | string | null;
  advance_amount?: number | string | null;
  first_payment_amount?: number | string | null;
  second_payment_amount?: number | string | null;
}

export interface PaymentSummary {
  totalCost: number;
  received: number;
  /** total - received. Negative when the customer has overpaid. */
  balanceDue: number;
  /** Nothing left to collect (covers exact and over payment). */
  isSettled: boolean;
}

/** Coerce a numeric/decimal column (PostgREST may hand back a string). */
function amount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function paymentSummary(source: PaymentSource): PaymentSummary {
  const totalCost = amount(source.total_cost);
  const received =
    amount(source.advance_amount) +
    amount(source.first_payment_amount) +
    amount(source.second_payment_amount);
  const balanceDue = totalCost - received;
  return { totalCost, received, balanceDue, isSettled: balanceDue <= 0 };
}

/**
 * The business case this exists for: the plant is commissioned and handed over,
 * but the full contract value has not been collected.
 */
export function isPaymentPending(
  project: { is_completed?: boolean | null },
  source: PaymentSource,
): boolean {
  return Boolean(project.is_completed) && paymentSummary(source).balanceDue > 0;
}

/** Share of the contract value collected so far, 0-100. */
export function collectedPct(source: PaymentSource): number {
  const { totalCost, received } = paymentSummary(source);
  if (totalCost <= 0) return 100;
  return Math.min(100, Math.round((received / totalCost) * 100));
}
