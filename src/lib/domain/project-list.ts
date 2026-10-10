import { PROJECT_STAGES } from "@/lib/constants";
import {
  FEASIBILITY_WARNING_DAYS,
  classifyFeasibility,
  type FeasibilityStatus,
} from "./kseb";
import { amount } from "./payment";
import { TONES, type StatusRegistry } from "./status";
import type { ProjectListRow } from "@/lib/types";

/**
 * Filters and derived states for the project list and board.
 *
 * Both read rows of the `projects_list` view, which computes the feasibility
 * clock in SQL against the database's IST "today". Everything here classifies
 * those precomputed columns instead of recomputing them with a client clock, so
 * a badge always agrees with the server-side filter that selected its row, and
 * nothing depends on the time a page happens to hydrate.
 *
 * URL filter names/values are shared with other pages (dashboard tiles link to
 * them): /projects?view=list&feasibility=expiring|extended|not_set
 * &financing=loan|self&incentive=pending|paid&status=…
 */

export const PROJECT_STATUS_FILTERS = ["active", "completed", "payment_pending"] as const;
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number];

export const FEASIBILITY_FILTERS = ["expiring", "extended", "not_set"] as const;
export type FeasibilityFilter = (typeof FEASIBILITY_FILTERS)[number];

export const INCENTIVE_FILTERS = ["pending", "paid"] as const;
export type IncentiveFilter = (typeof INCENTIVE_FILTERS)[number];

/** Every list filter the projects page reads from the URL. */
export const PROJECT_LIST_FILTER_KEYS = [
  "status",
  "stage",
  "coordinator",
  "financing",
  "feasibility",
  "incentive",
];

function oneOf<T extends string>(values: readonly T[]) {
  return (value: string | null | undefined): value is T =>
    (values as readonly string[]).includes(value ?? "");
}

export const isProjectStatusFilter = oneOf(PROJECT_STATUS_FILTERS);
export const isFeasibilityFilter = oneOf(FEASIBILITY_FILTERS);
export const isIncentiveFilter = oneOf(INCENTIVE_FILTERS);

export const FEASIBILITY_FILTER_LABELS: Record<FeasibilityFilter, string> = {
  expiring: `Expiring (≤ ${FEASIBILITY_WARNING_DAYS} days)`,
  extended: "Extended (BSS paid)",
  not_set: "Feasibility not set",
};

export const INCENTIVE_FILTER_LABELS: Record<IncentiveFilter, string> = {
  pending: "Incentive pending",
  paid: "Incentive paid",
};

/** The view columns the feasibility classification reads. */
export type FeasibilityColumns = Pick<
  ProjectListRow,
  | "is_completed"
  | "feasibility_date"
  | "feasibility_periods"
  | "feasibility_renewals"
  | "feasibility_valid_until"
  | "feasibility_days_left"
  | "feasibility_extension_cost"
>;

/**
 * A view row's feasibility status, with the same states and precedence as
 * `feasibilityStatus` in kseb.ts (not_set → closed → expiring → extended →
 * on_track). project-list.test.ts pins the two together.
 */
export function listRowFeasibility(row: FeasibilityColumns): FeasibilityStatus {
  if (!row.feasibility_date) {
    return {
      state: "not_set",
      periods: null,
      renewals: 0,
      validUntil: null,
      daysLeft: null,
      extensionCost: 0,
    };
  }

  const renewals = row.feasibility_renewals ?? 0;
  const status = {
    periods: row.feasibility_periods,
    renewals,
    validUntil: row.feasibility_valid_until,
    extensionCost: amount(row.feasibility_extension_cost),
  };
  // The view leaves days-left null once the plant is commissioned.
  const closed = row.is_completed || row.feasibility_days_left === null;
  const daysLeft = closed ? null : row.feasibility_days_left;
  const state = classifyFeasibility({ hasDate: true, closed, daysLeft, renewals });
  return { ...status, state, daysLeft };
}

/**
 * The feasibility filter as a row predicate — the client-side twin of the
 * repository's SQL filter (projects.repository.ts), for the board and for
 * client-mode tables.
 *
 * Only an active project has a running clock, so only it can be expiring or
 * missing its date. "extended" is every project on which BSS has borne a
 * renewal fee, commissioned ones included: the fee stays a cost after the clock
 * stops, and the dashboard's extension-cost total (which counts every project)
 * drills down to this filter.
 */
export function matchesFeasibilityFilter(
  row: FeasibilityColumns,
  filter: FeasibilityFilter,
): boolean {
  switch (filter) {
    case "expiring":
      return (
        !row.is_completed &&
        row.feasibility_days_left !== null &&
        row.feasibility_days_left >= 0 &&
        row.feasibility_days_left <= FEASIBILITY_WARNING_DAYS
      );
    case "extended":
      return (row.feasibility_renewals ?? 0) > 0;
    case "not_set":
      return !row.is_completed && !row.feasibility_date;
  }
}

/** Milestone progress from the view's counts (the list never loads milestones). */
export function listRowProgress(
  row: Pick<ProjectListRow, "milestones_done" | "milestones_total">,
): { done: number; total: number; pct: number } {
  const total = Number(row.milestones_total) || PROJECT_STAGES.length;
  const done = Math.min(Number(row.milestones_done) || 0, total);
  return { done, total, pct: Math.round((done / total) * 100) };
}

export type IncentiveState = "not_set" | "pending" | "paid";

type IncentiveColumns = Pick<ProjectListRow, "coordinator_incentive" | "incentive_paid_on">;

export function incentiveState(row: IncentiveColumns): IncentiveState {
  if (row.coordinator_incentive === null) return "not_set";
  return row.incentive_paid_on ? "paid" : "pending";
}

export function matchesIncentiveFilter(
  row: IncentiveColumns,
  filter: IncentiveFilter,
): boolean {
  return incentiveState(row) === filter;
}

export const INCENTIVE_STATE: StatusRegistry<IncentiveState> = {
  not_set: { label: "Not set", badgeClass: TONES.gray },
  pending: { label: "Pending", badgeClass: TONES.amber },
  paid: { label: "Paid", badgeClass: TONES.emerald },
};
