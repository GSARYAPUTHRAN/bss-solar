import { addDays, diffDays, istDateOf } from "./dates";
import { round2 } from "./rounding";

/**
 * KSEB charges and the feasibility clock.
 *
 * Who pays what (as agreed with BSS):
 *   - Feasibility fee — ₹1,000, paid by the customer. A feasibility is valid
 *     for 30 days.
 *   - Feasibility renewals — if the plant is not commissioned within the
 *     validity, every further 30-day period costs ₹1,000, borne by BSS.
 *   - Registration — ₹1,000 per kW + GST, paid by the customer.
 *
 * The feasibility maths is mirrored in SQL (`feasibility_periods()` and the
 * `projects_list` view, migrations 20261010120300 and 20261022120200) and
 * pinned to this module by tests/integration/feasibility.test.ts. Change both
 * together.
 */
export const KSEB_FEES = {
  feasibilityFee: 1000,
  feasibilityValidityDays: 30,
  feasibilityRenewalFee: 1000,
  registrationFeePerKw: 1000,
  gstRate: 0.18,
} as const;

/** "Expiring soon" threshold, in days left in the current validity period. */
export const FEASIBILITY_WARNING_DAYS = 7;

const money = round2;

export interface RegistrationFee {
  kw: number;
  base: number;
  gst: number;
  total: number;
}

/** ₹1,000 per kW + GST. Null when the capacity is unknown. */
export function registrationFee(
  kw: number | string | null | undefined,
): RegistrationFee | null {
  const n = Number(kw);
  if (kw === null || kw === undefined || !Number.isFinite(n) || n <= 0) return null;
  const base = money(n * KSEB_FEES.registrationFeePerKw);
  const gst = money(base * KSEB_FEES.gstRate);
  return { kw: n, base, gst, total: money(base + gst) };
}

export interface CustomerKsebFees {
  feasibility: number;
  registration: RegistrationFee | null;
  /** Null when the registration fee cannot be priced (capacity unknown). */
  total: number | null;
}

/** Everything the customer owes KSEB for one installation. */
export function customerKsebFees(
  kw: number | string | null | undefined,
): CustomerKsebFees {
  const registration = registrationFee(kw);
  return {
    feasibility: KSEB_FEES.feasibilityFee,
    registration,
    total: registration
      ? money(KSEB_FEES.feasibilityFee + registration.total)
      : null,
  };
}

/**
 * Validity periods consumed between `started` and `asOf` (inclusive of the
 * first). Day 0–30 is period 1, day 31–60 period 2, and so on. A future start
 * counts as period 1.
 */
export function feasibilityPeriods(started: string, asOf: string): number {
  const elapsed = Math.max(diffDays(started, asOf), 0);
  return Math.max(1, Math.ceil(elapsed / KSEB_FEES.feasibilityValidityDays));
}

export type FeasibilityState =
  | "not_set"
  | "on_track"
  | "expiring"
  | "extended"
  | "closed";

export interface FeasibilityStatus {
  state: FeasibilityState;
  /** Null until a feasibility date is captured. */
  periods: number | null;
  /** Periods beyond the first — each one cost BSS a renewal fee. */
  renewals: number;
  /** End of the current (or, once commissioned, the final) validity period. */
  validUntil: string | null;
  /** Days left in the current period; null when not running. */
  daysLeft: number | null;
  /** renewals × renewal fee, borne by BSS. */
  extensionCost: number;
}

/**
 * Where a project stands against its feasibility validity.
 *
 * The clock runs from `feasibilityDate` until commissioning (`completedAt`, an
 * instant, read as its IST date), cancellation (`cancelledOn`) — whichever came
 * first — or `today`. Precedence of states: not_set → closed (commissioned,
 * cancelled or refunded) → expiring (≤ 7 days left) → extended (BSS already
 * paying renewals) → on_track.
 */
export function feasibilityStatus(input: {
  feasibilityDate: string | null | undefined;
  completedAt?: string | null;
  isCompleted?: boolean | null;
  /** IST date the project was cancelled / refunded (stops the clock). */
  cancelledOn?: string | null;
  /** Cancelled or refunded; true even when the date was not recorded. */
  isCancelled?: boolean | null;
  today: string;
}): FeasibilityStatus {
  const { feasibilityDate, completedAt, isCompleted, cancelledOn, isCancelled, today } =
    input;
  if (!feasibilityDate) {
    return {
      state: "not_set",
      periods: null,
      renewals: 0,
      validUntil: null,
      daysLeft: null,
      extensionCost: 0,
    };
  }

  const closed =
    Boolean(isCompleted) || Boolean(completedAt) || Boolean(isCancelled) || Boolean(cancelledOn);
  // Mirrors the views' `coalesce(least(completion date, cancelled_on), ist_today())`.
  const stoppedOn = [completedAt ? istDateOf(completedAt) : null, cancelledOn ?? null]
    .filter((date): date is string => Boolean(date))
    .sort()[0];
  const asOf = stoppedOn ?? today;
  const periods = feasibilityPeriods(feasibilityDate, asOf);
  const renewals = periods - 1;
  const validUntil = addDays(
    feasibilityDate,
    periods * KSEB_FEES.feasibilityValidityDays,
  );
  const extensionCost = renewals * KSEB_FEES.feasibilityRenewalFee;

  const daysLeft = closed ? null : diffDays(today, validUntil);
  const state = classifyFeasibility({ hasDate: true, closed, daysLeft, renewals });
  return { state, periods, renewals, validUntil, daysLeft, extensionCost };
}

/**
 * The state rule on its own, for callers that already hold the numbers (the
 * list views precompute days-left and renewals in SQL). Precedence:
 * not_set → closed → expiring (≤ 7 days left) → extended → on_track.
 */
export function classifyFeasibility(input: {
  hasDate: boolean;
  closed: boolean;
  daysLeft: number | null;
  renewals: number;
}): FeasibilityState {
  if (!input.hasDate) return "not_set";
  if (input.closed) return "closed";
  if (input.daysLeft !== null && input.daysLeft <= FEASIBILITY_WARNING_DAYS) {
    return "expiring";
  }
  return input.renewals > 0 ? "extended" : "on_track";
}
