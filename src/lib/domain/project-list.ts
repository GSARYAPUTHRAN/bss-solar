import { PROJECT_STAGES } from "@/lib/constants";
import { INCENTIVE_STATE_LABELS, type IncentiveState } from "./incentives";
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
 * &financing=loan|self&incentive=pending|partly_paid|paid&status=…&plan=solar|custom
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

/**
 * `pending`: something is still to pay (a partly paid sale included, so the
 * dashboard's "Incentives pending" figure and this list agree); `partly_paid`:
 * instalments are in but not all of it; `paid`: every incentive set is settled.
 */
export const INCENTIVE_FILTERS = ["pending", "partly_paid", "paid"] as const;
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
  partly_paid: "Incentive partly paid",
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

export type { IncentiveState };

type SaleIncentiveColumns = Pick<
  ProjectListRow,
  "incentive_count" | "incentive_unpaid_count" | "incentive_paid"
>;

/**
 * The state of a whole sale's incentives as the caller sees them (the view's
 * counts and instalment total cover the incentives the caller may read: the
 * office everyone's, a coordinator their own): none set, nothing paid yet, some
 * of it paid, all of it paid. It goes by money, not by people: a sale on which
 * one person has been paid in part is partly paid, as is one where one of two
 * people has been paid in full. An incentive of zero owes nothing, so it is paid.
 */
export function saleIncentiveState(row: SaleIncentiveColumns): IncentiveState {
  const count = Number(row.incentive_count) || 0;
  const unpaid = Number(row.incentive_unpaid_count) || 0;
  if (count === 0) return "unset";
  if (unpaid === 0) return "paid";
  return (Number(row.incentive_paid) || 0) > 0 ? "partly_paid" : "pending";
}

/**
 * The incentive filter on a sale. Without a coordinator, `pending` is any
 * unpaid incentive on the sale, `partly_paid` is "some money is paid and some is
 * still to pay", and `paid` is "every incentive that is set has been paid".
 *
 * With a coordinator (the office narrowing to one person), `pending` / `paid`
 * are about that person's own incentive. The view cannot say whose instalments
 * the paid money is, so `partly_paid` there is "this person is still owed, and
 * the sale has had money paid" — exact on a sale with one coordinator, and on a
 * shared one it matches the sale's own "Partly paid" badge.
 */
export function matchesSaleIncentiveFilter(
  row: SaleIncentiveColumns &
    Pick<ProjectListRow, "incentive_unpaid_coordinator_ids" | "incentive_paid_coordinator_ids">,
  filter: IncentiveFilter,
  coordinatorId?: string | null,
): boolean {
  const count = Number(row.incentive_count) || 0;
  const unpaid = Number(row.incentive_unpaid_count) || 0;
  const owed = coordinatorId
    ? (row.incentive_unpaid_coordinator_ids ?? []).includes(coordinatorId)
    : unpaid > 0;
  switch (filter) {
    case "pending":
      return owed;
    case "partly_paid":
      return owed && (Number(row.incentive_paid) || 0) > 0;
    case "paid":
      return coordinatorId
        ? (row.incentive_paid_coordinator_ids ?? []).includes(coordinatorId)
        : count > 0 && unpaid === 0;
  }
}

export const INCENTIVE_STATE: StatusRegistry<IncentiveState> = {
  unset: { label: INCENTIVE_STATE_LABELS.unset, badgeClass: TONES.gray },
  pending: { label: INCENTIVE_STATE_LABELS.pending, badgeClass: TONES.amber },
  partly_paid: { label: INCENTIVE_STATE_LABELS.partly_paid, badgeClass: TONES.blue },
  paid: { label: INCENTIVE_STATE_LABELS.paid, badgeClass: TONES.emerald },
};

/**
 * What the badge says: the state's label, except that an incentive agreed at
 * zero reads "Nothing owed" rather than "Paid" (nothing was ever paid, and none
 * is due — the views count it as paid for the same reason).
 */
export function incentiveStateLabel(
  state: IncentiveState,
  total: number | string | null | undefined,
): string {
  return state === "paid" && total != null && Number(total) === 0
    ? "Nothing owed"
    : INCENTIVE_STATE[state].label;
}
