import { PROJECT_STAGES } from "@/lib/constants";
import {
  FEASIBILITY_WARNING_DAYS,
  classifyFeasibility,
  type FeasibilityStatus,
} from "./kseb";
import { amount } from "./payment";
import { PLAN_TYPES } from "./plan";
import { TONES, type StatusRegistry } from "./status";
import type { PlanType, ProjectListRow } from "@/lib/types";

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
 * &financing=loan|self&incentive=pending|paid&status=…&plan=solar|custom
 *
 * A project is active, commissioned (or handed over), cancelled, or refunded.
 * Cancelled and refunded projects leave the active and commissioned counts and
 * their payment is no longer pending; "closed" is both of them.
 */

/** The columns the list can be sorted by (the repository validates the URL against this). */
export const PROJECT_SORT_COLUMNS = [
  "created_at",
  "client_name",
  "coordinator_name",
  "current_stage",
  "balance_due",
  "feasibility_days_left",
  "incentive_total",
] as const;
export type ProjectSortColumn = (typeof PROJECT_SORT_COLUMNS)[number];

export function isProjectSortColumn(
  value: string | null | undefined,
): value is ProjectSortColumn {
  return (PROJECT_SORT_COLUMNS as readonly (string | null | undefined)[]).includes(value);
}

export const PROJECT_STATUS_FILTERS = [
  "active",
  "completed",
  "payment_pending",
  "cancelled",
  "refunded",
  "closed",
] as const;
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number];

export const PROJECT_STATUS_FILTER_LABELS: Record<ProjectStatusFilter, string> = {
  active: "Active",
  completed: "Commissioned",
  payment_pending: "Commissioned · payment pending",
  cancelled: "Cancelled",
  refunded: "Refunded",
  closed: "Cancelled or refunded",
};

/** Solar plant or custom plan. */
export const PLAN_FILTERS = PLAN_TYPES;
export type PlanFilter = PlanType;

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
  "plan",
];

function oneOf<T extends string>(values: readonly T[]) {
  return (value: string | null | undefined): value is T =>
    (values as readonly string[]).includes(value ?? "");
}

export const isProjectStatusFilter = oneOf(PROJECT_STATUS_FILTERS);
export const isFeasibilityFilter = oneOf(FEASIBILITY_FILTERS);
export const isIncentiveFilter = oneOf(INCENTIVE_FILTERS);
export const isPlanFilter = oneOf(PLAN_FILTERS);

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
  | "cancellation"
  | "plan_type"
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
  // The view leaves days-left null once the plant is commissioned or the
  // project cancelled / refunded.
  const closed =
    row.is_completed || row.cancellation != null || row.feasibility_days_left === null;
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
 * missing its date; a cancelled or refunded project has none, and a custom plan
 * has no feasibility date to miss. "extended" is every project on which BSS has
 * borne a renewal fee, commissioned or cancelled ones included: the fee stays a
 * cost after the clock stops, and the dashboard's extension-cost total (which
 * counts every project) drills down to this filter.
 */
export function matchesFeasibilityFilter(
  row: FeasibilityColumns,
  filter: FeasibilityFilter,
): boolean {
  switch (filter) {
    case "expiring":
      return (
        !row.is_completed &&
        row.cancellation == null &&
        row.feasibility_days_left !== null &&
        row.feasibility_days_left >= 0 &&
        row.feasibility_days_left <= FEASIBILITY_WARNING_DAYS
      );
    case "extended":
      return (row.feasibility_renewals ?? 0) > 0;
    case "not_set":
      return (
        !row.is_completed &&
        !row.feasibility_date &&
        row.cancellation == null &&
        row.plan_type !== "custom"
      );
  }
}

/**
 * The status filter as a row predicate — the client-side twin of the
 * repository's SQL filter. Active and commissioned exclude cancelled / refunded
 * projects; "closed" is either of them.
 */
export function matchesProjectStatus(
  row: Pick<ProjectListRow, "is_completed" | "payment_pending" | "cancellation">,
  filter: ProjectStatusFilter,
): boolean {
  switch (filter) {
    case "active":
      return !row.is_completed && row.cancellation == null;
    case "completed":
      return row.is_completed && row.cancellation == null;
    case "payment_pending":
      return row.payment_pending === true && row.cancellation == null;
    case "cancelled":
      return row.cancellation === "cancelled";
    case "refunded":
      return row.cancellation === "refunded";
    case "closed":
      return row.cancellation != null;
  }
}

/** Whether `id` is one of the sale's coordinators (the coordinator filter). */
export function matchesCoordinator(
  row: { coordinator_ids: readonly string[] | null },
  id: string,
): boolean {
  return row.coordinator_ids?.includes(id) ?? false;
}

/** Milestone progress from the view's counts (the list never loads milestones). */
export function listRowProgress(
  row: Pick<ProjectListRow, "milestones_done" | "milestones_total">,
): { done: number; total: number; pct: number } {
  const total = Number(row.milestones_total) || PROJECT_STAGES.length;
  const done = Math.min(Number(row.milestones_done) || 0, total);
  return { done, total, pct: Math.round((done / total) * 100) };
}

/** `partly_paid`: a shared sale on which only some of the people have been paid. */
export type IncentiveState = "not_set" | "pending" | "partly_paid" | "paid";

type IncentiveColumns = Pick<ProjectListRow, "coordinator_incentive" | "incentive_paid_on">;

/** One person's incentive: never `partly_paid`. */
export function incentiveState(row: IncentiveColumns): IncentiveState {
  if (row.coordinator_incentive === null) return "not_set";
  return row.incentive_paid_on ? "paid" : "pending";
}

/** @deprecated Reads the single-incentive compat columns; use `matchesSaleIncentiveFilter`. */
export function matchesIncentiveFilter(
  row: IncentiveColumns,
  filter: IncentiveFilter,
): boolean {
  return incentiveState(row) === filter;
}

type SaleIncentiveCounts = Pick<ProjectListRow, "incentive_count" | "incentive_unpaid_count">;

/**
 * The state of a whole sale's incentives as the caller sees them (the view's
 * counts cover the incentives the caller may read: the office everyone's, a
 * coordinator their own): none set, none paid, only some paid, all paid.
 */
export function saleIncentiveState(row: SaleIncentiveCounts): IncentiveState {
  const count = Number(row.incentive_count) || 0;
  const unpaid = Number(row.incentive_unpaid_count) || 0;
  if (count === 0) return "not_set";
  if (unpaid >= count) return "pending";
  return unpaid > 0 ? "partly_paid" : "paid";
}

/**
 * The incentive filter on a sale. With a coordinator (the office narrowing to
 * one person), `pending` / `paid` are about that person's own incentive; without
 * one, `pending` is any unpaid incentive on the sale and `paid` is "every
 * incentive that is set has been paid".
 */
export function matchesSaleIncentiveFilter(
  row: Pick<
    ProjectListRow,
    | "incentive_count"
    | "incentive_unpaid_count"
    | "incentive_unpaid_coordinator_ids"
    | "incentive_paid_coordinator_ids"
  >,
  filter: IncentiveFilter,
  coordinatorId?: string | null,
): boolean {
  const count = Number(row.incentive_count) || 0;
  const unpaid = Number(row.incentive_unpaid_count) || 0;
  if (filter === "pending") {
    return coordinatorId
      ? (row.incentive_unpaid_coordinator_ids ?? []).includes(coordinatorId)
      : unpaid > 0;
  }
  return coordinatorId
    ? (row.incentive_paid_coordinator_ids ?? []).includes(coordinatorId)
    : count > 0 && unpaid === 0;
}

export const INCENTIVE_STATE: StatusRegistry<IncentiveState> = {
  not_set: { label: "Not set", badgeClass: TONES.gray },
  pending: { label: "Pending", badgeClass: TONES.amber },
  partly_paid: { label: "Partly paid", badgeClass: TONES.blue },
  paid: { label: "Paid", badgeClass: TONES.emerald },
};
