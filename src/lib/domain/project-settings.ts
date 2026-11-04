import { formatCurrency } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  CoordinatorIncentive,
  PlanType,
  ProjectCancellation,
} from "@/lib/types";
import { isIsoDate } from "./dates";
import { summarizeIncentives, type IncentiveFigures } from "./incentives";
import { feasibilityStatus } from "./kseb";
import { round2 } from "./rounding";

/**
 * The office-maintained facts on a project: when KSEB issued the feasibility,
 * and each coordinator's own incentive (the agreed amount, and the dated
 * instalments paid against it). Validated here so the server actions, their
 * tests and any future caller share one set of rules; what an instalment may be
 * (the cap, the date, the amount set first) is `planIncentiveInstalment` in
 * ./incentives. The lifecycle helpers at the end (what cancelling a project
 * touches, what reinstating it would cost) are pure for the same reason.
 */

/**
 * What the office types for one person's incentive: the agreed amount (null
 * removes it). The paid date is never typed — the database derives it from the
 * instalments.
 */
export type IncentiveSetting = Pick<CoordinatorIncentive, "amount">;

/** The largest amount `numeric(12,2)` can hold. */
export const MAX_INCENTIVE = 9_999_999_999.99;

/** The longest note on an instalment ("Cheque 004211", "Second part"). */
export const INCENTIVE_NOTE_MAX = 200;

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

/** Typed money as a number of rupees; `noun` starts the message ("Incentive …"). */
function rupees(value: string, noun: string): ActionResult<number> {
  const cleaned = value.replace(/[,\s₹]/g, "");
  if (!AMOUNT.test(cleaned)) {
    return fail(`${noun} must be an amount in rupees, e.g. 2500.`);
  }
  const n = Number(cleaned);
  if (n < 0) return fail(`${noun} cannot be negative.`);
  if (n > MAX_INCENTIVE) return fail(`${noun} is too large.`);
  // Paise precision, as stored.
  return ok(round2(n));
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
 * One coordinator's agreed incentive. An empty amount removes it (the database
 * and `checkIncentiveAmount` refuse that while instalments are recorded).
 */
export function parseIncentiveSetting(input: {
  amount: string | null;
}): ActionResult<IncentiveSetting> {
  if (input.amount === null) return ok({ amount: null });
  const amount = rupees(input.amount, "Incentive");
  return amount.ok ? ok({ amount: amount.data }) : amount;
}

/** The coordinator hears about a change to their agreed amount — and only that. */
export function incentiveChanged(
  before: IncentiveSetting,
  after: IncentiveSetting,
): boolean {
  // The database may hand a numeric back as a string.
  const amountOf = (v: number | string | null) => (v === null ? null : Number(v));
  return amountOf(before.amount) !== amountOf(after.amount);
}

/** One instalment as the office typed it, before the incentive's figures are known. */
export interface IncentiveInstalmentInput {
  amount: number;
  /** As typed: `planIncentiveInstalment` decides whether it is a real, past date. */
  paidOn: string;
  note: string | null;
}

/**
 * The text fields of an instalment form as numbers and strings. Only what can be
 * read without knowing the incentive is checked here; the amount cap, the date
 * and "set the amount first" are `planIncentiveInstalment`'s, so the app and the
 * database rules are stated once.
 */
export function parseIncentiveInstalment(input: {
  amount: string | null;
  paidOn: string | null;
  note: string | null;
}): ActionResult<IncentiveInstalmentInput> {
  if (input.amount === null) return fail("Enter the instalment amount.");
  const amount = rupees(input.amount, "Instalment");
  if (!amount.ok) return amount;
  if (input.note !== null && input.note.length > INCENTIVE_NOTE_MAX) {
    return fail(`The note can be at most ${INCENTIVE_NOTE_MAX} characters.`);
  }
  return ok({ amount: amount.data, paidOn: input.paidOn ?? "", note: input.note });
}

/**
 * The database's refusals of an incentive write, worded for the person (they are
 * the same rules `planIncentiveInstalment` and `checkIncentiveAmount` check
 * first, so these are what a second office user's change a moment earlier
 * looks like). Anything else is returned as it came.
 */
export function incentiveWriteMessage(message: string): string {
  if (/^Set the incentive amount first/i.test(message)) {
    return "Set the incentive amount first.";
  }
  if (/^Instalments exceed the incentive/i.test(message)) {
    return "That would take the payments above the agreed incentive — it may have changed meanwhile; reload to see what has been paid.";
  }
  const floor = /^The incentive cannot be less than the (\d+(?:\.\d+)?) already paid/i.exec(
    message,
  );
  if (floor) {
    return `The incentive cannot be less than the ${formatCurrency(Number(floor[1]))} already paid.`;
  }
  return message;
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
export function saleIncentives(
  coordinators: readonly { incentive: IncentiveFigures | null }[],
): ReturnType<typeof summarizeIncentives> {
  return summarizeIncentives(coordinators.flatMap(({ incentive }) => incentive ?? []));
}

/**
 * Incentives still to pay: how many people, and what is left of their agreed
 * amounts (instalments already paid are not owed again) — money the office
 * still owes the team.
 */
export function unpaidIncentives(
  coordinators: readonly { incentive: IncentiveFigures | null }[],
): { count: number; total: number } {
  const { unpaidCount, pending } = saleIncentives(coordinators);
  return { count: unpaidCount, total: pending };
}

/**
 * What marking a project cancelled or refunded touches, line by line, for the
 * confirmation dialog (nothing is a surprise after "Mark refunded"). The ledger
 * is never rewritten, the balance stops being receivable, the feasibility clock
 * stops on `cancelledOn` (renewals already borne stay a cost), and incentives
 * are NOT changed — which is why unpaid ones are called out.
 */
export function cancellationImpact(input: {
  /** What BSS holds now: advance + contract instalments − refunds. */
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
        ? `1 unpaid incentive (${formatCurrency(input.unpaid.total)} still to pay) stays owed — lower or clear it under Coordinator incentives if it won't be paid in full`
        : `${input.unpaid.count} unpaid incentives (${formatCurrency(input.unpaid.total)} still to pay) stay owed — lower or clear them under Coordinator incentives if they won't be paid in full`,
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
