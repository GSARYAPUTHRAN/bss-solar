import { formatCurrency } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  CoordinatorIncentive,
  PlanType,
  ProjectCancellation,
  SaleCoordinator,
} from "@/lib/types";
import { isIsoDate } from "./dates";
import { feasibilityStatus } from "./kseb";
import { round2 } from "./rounding";

/**
 * The office-maintained facts on a project: when KSEB issued the feasibility,
 * and each coordinator's own incentive (amount + when it was paid). Validated
 * here so the server actions, their tests and any future caller share one set of
 * rules. The lifecycle helpers at the end (what cancelling a project touches,
 * what reinstating it would cost) are pure for the same reason.
 */

/** The largest amount `numeric(12,2)` can hold. */
export const MAX_INCENTIVE = 9_999_999_999.99;

// Digits with an optional fraction; thousands separators, spaces and a rupee
// sign are tolerated because that is how people type money.
const AMOUNT = /^-?\d+(\.\d+)?$/;

function pastOrToday(
  value: string | null,
  label: string,
  today: string,
): ActionResult<string | null> {
  if (value === null) return ok(null);
  if (!isIsoDate(value)) return fail(`${label} must be a valid date.`);
  if (value > today) return fail(`${label} cannot be in the future.`);
  return ok(value);
}

function incentiveAmount(value: string | null): ActionResult<number | null> {
  if (value === null) return ok(null);
  const cleaned = value.replace(/[,\s₹]/g, "");
  if (!AMOUNT.test(cleaned)) {
    return fail("Incentive must be an amount in rupees, e.g. 2500.");
  }
  const n = Number(cleaned);
  if (n < 0) return fail("Incentive cannot be negative.");
  if (n > MAX_INCENTIVE) return fail("Incentive is too large.");
  // Paise precision, as stored. `+ 0` folds -0 into 0.
  return ok(Math.round(n * 100) / 100 + 0);
}

/**
 * The KSEB feasibility date: a real calendar date, never in the future (it
 * records something that has happened; `today` is the IST date from the
 * server). Empty clears it.
 */
export function parseFeasibilitySetting(
  value: string | null,
  today: string,
): ActionResult<string | null> {
  return pastOrToday(value, "Feasibility date", today);
}

/**
 * One coordinator's incentive. An empty amount removes it; a paid-on date needs
 * an amount to have been paid and, like the amount's date, cannot be in the
 * future.
 */
export function parseIncentiveSetting(
  input: { amount: string | null; paidOn: string | null },
  today: string,
): ActionResult<CoordinatorIncentive> {
  const amount = incentiveAmount(input.amount);
  if (!amount.ok) return amount;

  const paidOn = pastOrToday(input.paidOn, "Incentive paid-on date", today);
  if (!paidOn.ok) return paidOn;
  if (paidOn.data !== null && amount.data === null) {
    return fail("Enter the incentive amount before marking it paid.");
  }

  return ok({ amount: amount.data, paid_on: paidOn.data });
}

/** The coordinator hears about a change to their incentive — and only that. */
export function incentiveChanged(
  before: CoordinatorIncentive,
  after: CoordinatorIncentive,
): boolean {
  // The database may hand a numeric back as a string.
  const amountOf = (v: number | string | null) => (v === null ? null : Number(v));
  return (
    amountOf(before.amount) !== amountOf(after.amount) ||
    before.paid_on !== after.paid_on
  );
}

export const CUSTOM_PLAN_FEASIBILITY_ERROR = "A custom plan has no KSEB feasibility date.";

export const UNDATED_COMMISSIONING_FEASIBILITY_ERROR =
  "This project was commissioned on a date that was never recorded, so it has no feasibility clock.";

/**
 * Commissioned, but the day was never recorded (an import row with no
 * `commissioned_on` — the import never invents dates). Such a project's
 * feasibility clock has nowhere to stop, so a date entered on it would run to
 * today and keep growing.
 */
export function hasUndatedCommissioning(project: {
  is_completed: boolean;
  completed_at: string | null;
}): boolean {
  return project.is_completed && project.completed_at === null;
}

/**
 * Why a feasibility date cannot be saved on this project, or null.
 *
 * A custom plan has no KSEB process (the database refuses a date too). A
 * commissioned project whose commissioning date was never recorded has no
 * feasibility clock — the import refuses that pairing as well. A cancelled
 * project whose cancellation date was never recorded (an import with no
 * feasibility clock) cannot gain a running clock either — the database
 * insists a cancelled project with a feasibility date says when it stopped.
 * Clearing the date is always fine.
 */
export function feasibilityDateRefusal(
  project: {
    plan_type: PlanType;
    cancellation: ProjectCancellation | null;
    cancelled_on: string | null;
    is_completed: boolean;
    completed_at: string | null;
  },
  date: string | null,
): string | null {
  if (date === null) return null;
  if (project.plan_type === "custom") return CUSTOM_PLAN_FEASIBILITY_ERROR;
  // Checked before the cancellation date: that one is fixable in the app, this
  // one is not, so it is the truer answer.
  if (hasUndatedCommissioning(project)) return UNDATED_COMMISSIONING_FEASIBILITY_ERROR;
  if (project.cancellation !== null && project.cancelled_on === null) {
    return "Record the date it was cancelled first (Project status → Edit) — it stops the feasibility clock.";
  }
  return null;
}

// --- Lifecycle: cancelling and reinstating ---------------------------------

/**
 * A sale's incentives, summed over the people whose incentive is set (an
 * amount, even zero, is a record; an empty row is not). Each person's is as
 * loaded: the office sees everyone's, so this is the office's view of the sale.
 */
export function incentiveTotals(coordinators: readonly Pick<SaleCoordinator, "incentive">[]): {
  /** How many people have an incentive set. */
  count: number;
  /** Their sum; null when nobody has one. */
  total: number | null;
  /** Of those, how many are not yet paid, and what they add up to. */
  unpaidCount: number;
  unpaidTotal: number;
} {
  let count = 0;
  let total = 0;
  let unpaidCount = 0;
  let unpaidTotal = 0;
  for (const { incentive } of coordinators) {
    if (incentive?.amount == null) continue;
    const amount = Number(incentive.amount);
    count += 1;
    total += amount;
    if (incentive.paid_on === null) {
      unpaidCount += 1;
      unpaidTotal += amount;
    }
  }
  return {
    count,
    total: count > 0 ? round2(total) : null,
    unpaidCount,
    unpaidTotal: round2(unpaidTotal),
  };
}

/** Incentives set but not yet paid — money the office still owes the team. */
export function unpaidIncentives(
  coordinators: readonly Pick<SaleCoordinator, "incentive">[],
): { count: number; total: number } {
  const { unpaidCount, unpaidTotal } = incentiveTotals(coordinators);
  return { count: unpaidCount, total: unpaidTotal };
}

/**
 * What marking a project cancelled or refunded touches, line by line, for the
 * confirmation dialog (nothing is a surprise after "Mark refunded"). The ledger
 * is never rewritten, the balance stops being receivable, the feasibility clock
 * stops on `cancelledOn` (renewals already borne stay a cost), and incentives
 * are NOT changed — which is why unpaid ones are called out.
 */
export function cancellationImpact(input: {
  /** advance + ledger instalments. */
  received: number;
  balanceDue: number;
  feasibilityDate: string | null;
  completedAt: string | null;
  isCompleted: boolean;
  /** The date the clock would stop on; anything but a real date reads as today. */
  cancelledOn: string | null;
  today: string;
  unpaid: { count: number; total: number };
}): string[] {
  const lines = ["Leaves the active pipeline and KPIs"];
  if (input.received > 0) {
    lines.push(`${formatCurrency(input.received)} collected stays in the ledger`);
  }
  if (input.balanceDue > 0) {
    lines.push(`${formatCurrency(input.balanceDue)} balance is no longer counted as outstanding`);
  }
  // A commissioned project's clock stopped at commissioning already.
  if (input.feasibilityDate && !input.isCompleted) {
    const { extensionCost } = feasibilityStatus({
      feasibilityDate: input.feasibilityDate,
      completedAt: input.completedAt,
      isCompleted: input.isCompleted,
      cancelledOn: isIsoDate(input.cancelledOn) ? input.cancelledOn : input.today,
      isCancelled: true,
      today: input.today,
    });
    lines.push(
      extensionCost > 0
        ? `The feasibility clock stops (${formatCurrency(extensionCost)} of renewals already borne stays a cost)`
        : "The feasibility clock stops",
    );
  }
  if (input.unpaid.count > 0) {
    lines.push(
      input.unpaid.count === 1
        ? `1 unpaid incentive (${formatCurrency(input.unpaid.total)}) stays owed — clear it under Coordinator incentives if it won't be paid`
        : `${input.unpaid.count} unpaid incentives (${formatCurrency(input.unpaid.total)}) stay owed — clear them under Coordinator incentives if they won't be paid`,
    );
  }
  return lines;
}

/**
 * What reinstating would do to the feasibility renewals BSS bears. A cancelled
 * project's clock stopped on `cancelledOn`; reopening it on the OLD feasibility
 * date counts the whole cancelled stretch as renewals. Null when there is
 * nothing to warn about (no feasibility date, commissioned already, or the
 * reopened clock costs the same).
 */
export function reinstateClockImpact(input: {
  feasibilityDate: string | null;
  completedAt: string | null;
  isCompleted: boolean;
  cancelledOn: string | null;
  today: string;
}): { feasibilityDate: string; costNow: number; costReopened: number } | null {
  const { feasibilityDate } = input;
  if (!feasibilityDate) return null;
  const common = {
    feasibilityDate,
    completedAt: input.completedAt,
    isCompleted: input.isCompleted,
    today: input.today,
  };
  const stopped = feasibilityStatus({
    ...common,
    cancelledOn: input.cancelledOn,
    isCancelled: true,
  });
  const reopened = feasibilityStatus(common);
  if (reopened.extensionCost <= stopped.extensionCost) return null;
  return {
    feasibilityDate,
    costNow: stopped.extensionCost,
    costReopened: reopened.extensionCost,
  };
}
