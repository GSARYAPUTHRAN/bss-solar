import { isIsoDate } from "./dates";
import { fail, ok, type ActionResult } from "@/lib/result";

/**
 * The office-maintained facts on a project: when KSEB issued the feasibility,
 * and the coordinator's incentive. Validated here so the server action, its
 * tests and any future caller share one set of rules.
 */
export interface ProjectSettings {
  feasibility_date: string | null;
  /** Rupees; null = no incentive set. */
  coordinator_incentive: number | null;
  incentive_paid_on: string | null;
}

/** Raw form values — trimmed, with empty fields already turned into null. */
export interface ProjectSettingsInput {
  feasibilityDate: string | null;
  incentive: string | null;
  incentivePaidOn: string | null;
}

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
 * Validate the settings form. Dates are calendar dates in IST (`today` comes
 * from the server) and can never be in the future — both record something that
 * has already happened. An empty incentive removes it; a paid-on date needs an
 * incentive to have been paid.
 */
export function parseProjectSettings(
  input: ProjectSettingsInput,
  today: string,
): ActionResult<ProjectSettings> {
  const feasibility = pastOrToday(input.feasibilityDate, "Feasibility date", today);
  if (!feasibility.ok) return feasibility;

  const incentive = incentiveAmount(input.incentive);
  if (!incentive.ok) return incentive;

  const paidOn = pastOrToday(input.incentivePaidOn, "Incentive paid-on date", today);
  if (!paidOn.ok) return paidOn;
  if (paidOn.data !== null && incentive.data === null) {
    return fail("Enter the incentive amount before marking it paid.");
  }

  return ok({
    feasibility_date: feasibility.data,
    coordinator_incentive: incentive.data,
    incentive_paid_on: paidOn.data,
  });
}

type IncentiveFields = Pick<ProjectSettings, "coordinator_incentive" | "incentive_paid_on">;

/** The coordinator hears about a change to their incentive — and only that. */
export function incentiveChanged(before: IncentiveFields, after: IncentiveFields): boolean {
  const amountOf = (v: number | string | null) => (v === null ? null : Number(v));
  return (
    amountOf(before.coordinator_incentive) !== amountOf(after.coordinator_incentive) ||
    before.incentive_paid_on !== after.incentive_paid_on
  );
}
