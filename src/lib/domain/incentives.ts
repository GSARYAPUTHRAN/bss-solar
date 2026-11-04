import { formatCurrency } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/result";
import { isIsoDate } from "./dates";
import { amount as toAmount } from "./payment";
import { round2 } from "./rounding";

/**
 * A coordinator's incentive on one sale, and what has been paid against it.
 *
 * The office sets the agreed `amount`; payments reach the coordinator in dated
 * instalments (`coordinator_incentive_payments`). Everything here is the same
 * arithmetic the database enforces and the list views compute, in one place:
 *
 *   paid     = Σ instalments
 *   pending  = amount − paid                      (0 while no amount is set)
 *   instalments can never exceed the amount; the amount can never fall below
 *   what is already paid; an instalment needs the amount set first.
 *
 * tests/integration/incentive-instalments.test.ts pins the database to these
 * rules; the unit tests pin this module to the same cases.
 */

type Amount = number | string | null | undefined;

/** Where an incentive stands. */
export type IncentiveState = "unset" | "pending" | "partly_paid" | "paid";

export const INCENTIVE_STATE_LABELS: Record<IncentiveState, string> = {
  unset: "Not set",
  pending: "Pending",
  partly_paid: "Partly paid",
  paid: "Paid",
};

/** What one person's incentive amounts to, as the maths needs it. */
export interface IncentiveFigures {
  /** The agreed amount; null while the office has not set one. */
  amount: Amount;
  /** Σ instalments paid so far. */
  paid: Amount;
}

/** Σ instalments, exactly (paise, never binary fractions of rupees). */
export function incentivePaid(payments: readonly { amount: Amount }[]): number {
  return round2(payments.reduce((sum, p) => sum + toAmount(p.amount), 0));
}

/** What is still to pay: agreed − paid, never below zero; 0 while nothing is agreed. */
export function incentivePending({ amount, paid }: IncentiveFigures): number {
  if (amount == null) return 0;
  return Math.max(0, round2(toAmount(amount) - toAmount(paid)));
}

/**
 * `unset` until the office sets an amount; `paid` once the instalments have
 * reached it (an agreed amount of zero has nothing to pay, so it is paid);
 * `partly_paid` once any instalment is in; otherwise `pending`.
 */
export function incentiveState({ amount, paid }: IncentiveFigures): IncentiveState {
  if (amount == null) return "unset";
  const paidSoFar = toAmount(paid);
  if (paidSoFar >= toAmount(amount)) return "paid";
  return paidSoFar > 0 ? "partly_paid" : "pending";
}

export interface IncentiveSummary {
  /** Σ agreed amounts (people with an amount set). */
  total: number;
  /** Σ instalments paid. */
  paid: number;
  /** total − paid. */
  pending: number;
  /** How many people have an amount set. */
  count: number;
  /** Of those, how many still have something to pay. */
  unpaidCount: number;
}

/**
 * Tiles and badges over several incentives — a sale's coordinators, or one
 * person's sales: total, paid and pending, as `incentive_summary()` and the
 * list views add them up.
 */
export function summarizeIncentives(items: readonly IncentiveFigures[]): IncentiveSummary {
  let total = 0;
  let paid = 0;
  let count = 0;
  let unpaidCount = 0;
  for (const item of items) {
    if (item.amount == null) continue;
    count += 1;
    total += toAmount(item.amount);
    paid += toAmount(item.paid);
    if (incentiveState(item) !== "paid") unpaidCount += 1;
  }
  return {
    total: round2(total),
    paid: round2(paid),
    pending: round2(total - paid),
    count,
    unpaidCount,
  };
}

/**
 * The date the incentive was fully paid: the date of the instalment that takes
 * the running total (in date order) up to the agreed amount, else null. Two
 * instalments on one day share that date, so their order does not matter. The
 * database derives `coordinator_incentives.paid_on` the same way so the build
 * before instalments, and every existing reader, still sees one paid date.
 */
export function derivedPaidOn(
  amount: Amount,
  instalments: readonly { amount: Amount; paid_on: string }[],
): string | null {
  if (amount == null) return null;
  const target = toAmount(amount);
  const ordered = [...instalments].sort((a, b) =>
    a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : 0,
  );
  let running = 0;
  for (const instalment of ordered) {
    running = round2(running + toAmount(instalment.amount));
    if (running >= target) return instalment.paid_on;
  }
  return null;
}

/** What recording or editing an instalment would leave. */
export interface InstalmentPlan {
  /** Σ instalments after this one. */
  paidAfter: number;
  /** Still to pay after this one. */
  pendingAfter: number;
  stateAfter: IncentiveState;
}

/**
 * Check an instalment before it is written — the same rules the database
 * enforces, worded for the person: an amount must be set first, the instalment
 * is money (more than zero), dated no later than today, and — with the others —
 * cannot exceed the agreed amount. When editing, pass the instalment's current
 * amount as `replacing` so it is not counted twice.
 */
export function planIncentiveInstalment(input: {
  /** The agreed incentive; null when not set. */
  amount: Amount;
  /** Σ instalments already recorded, the one being edited included. */
  paid: Amount;
  instalment: number;
  /** The instalment's current amount when editing it; 0 for a new one. */
  replacing?: number;
  paidOn: string;
  /** The IST calendar date: an instalment cannot be dated after it. */
  today: string;
}): ActionResult<InstalmentPlan> {
  const { amount, instalment, paidOn, today, replacing = 0 } = input;
  if (amount == null) return fail("Set the incentive amount first.");
  if (!Number.isFinite(instalment) || instalment <= 0) {
    return fail("The instalment must be more than zero.");
  }
  if (!isIsoDate(paidOn)) return fail("Enter the date the instalment was paid.");
  if (paidOn > today) return fail("The payment date cannot be in the future.");

  const others = round2(toAmount(input.paid) - replacing);
  const pending = Math.max(0, round2(toAmount(amount) - others));
  if (instalment > pending) {
    return fail(
      pending > 0
        ? `${formatCurrency(instalment)} is more than the ${formatCurrency(pending)} still to pay on this incentive.`
        : "This incentive is already fully paid.",
    );
  }
  const paidAfter = round2(others + instalment);
  return ok({
    paidAfter,
    pendingAfter: incentivePending({ amount, paid: paidAfter }),
    stateAfter: incentiveState({ amount, paid: paidAfter }),
  });
}

/**
 * Check a new agreed amount against what is already paid: it can be corrected
 * either way, but never below the instalments in, and not cleared while there
 * are any. `null` clears the incentive.
 */
export function checkIncentiveAmount(
  next: number | null,
  paid: Amount,
): ActionResult<{ pendingAfter: number }> {
  const paidSoFar = toAmount(paid);
  if (next === null) {
    return paidSoFar > 0
      ? fail(
          `${formatCurrency(paidSoFar)} has already been paid on this incentive — remove those payments before clearing it.`,
        )
      : ok({ pendingAfter: 0 });
  }
  if (next < paidSoFar) {
    return fail(
      `The incentive cannot be less than the ${formatCurrency(paidSoFar)} already paid.`,
    );
  }
  return ok({ pendingAfter: incentivePending({ amount: next, paid: paidSoFar }) });
}
