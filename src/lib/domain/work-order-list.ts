import { coordinatorsLabel } from "./coordinators";
import { paymentSummary, type PaymentSource } from "./payment";
import type { PlanType, WorkOrder, WorkOrderListRow } from "@/lib/types";

/**
 * Filters of the work-order list.
 *
 * Both the server (`workOrdersRepository.page`, against the `work_orders_list`
 * view) and the client-side table read these, so a row's badge always agrees
 * with the filter that selected it. A work order is pending, approved or
 * rejected; once approved its project may be cancelled or refunded, and then it
 * is no longer part of the active pipeline ("Approved (active)").
 *
 * URL: /work-orders?status=pending|approved|rejected|cancelled|refunded
 * &payment=pending|settled&plan=solar|custom&coordinator=<id>&financing=…
 */

export const WORK_ORDER_STATUS_FILTERS = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "refunded",
] as const;
export type WorkOrderStatusFilter = (typeof WORK_ORDER_STATUS_FILTERS)[number];

export const WORK_ORDER_STATUS_FILTER_LABELS: Record<WorkOrderStatusFilter, string> = {
  pending: "Pending",
  approved: "Approved (active)",
  rejected: "Rejected",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export function isWorkOrderStatusFilter(
  value: string | null | undefined,
): value is WorkOrderStatusFilter {
  return (WORK_ORDER_STATUS_FILTERS as readonly (string | null | undefined)[]).includes(value);
}

/** The status dropdown's options, in filter order. */
export function workOrderStatusOptions(): { value: WorkOrderStatusFilter; label: string }[] {
  return WORK_ORDER_STATUS_FILTERS.map((value) => ({
    value,
    label: WORK_ORDER_STATUS_FILTER_LABELS[value],
  }));
}

/**
 * The status filter as a row predicate — the client-side twin of the
 * repository's SQL filter. "Approved" is the active pipeline: an approved order
 * whose project was cancelled or refunded is counted under that instead.
 */
export function matchesWorkOrderStatus(
  row: Pick<WorkOrderListRow, "status" | "cancellation">,
  filter: WorkOrderStatusFilter,
): boolean {
  switch (filter) {
    case "pending":
    case "rejected":
      return row.status === filter;
    case "approved":
      return row.status === "approved" && row.cancellation == null;
    case "cancelled":
    case "refunded":
      return row.cancellation === filter;
  }
}

export const WORK_ORDER_PAYMENT_FILTERS = ["pending", "settled"] as const;
export type WorkOrderPaymentFilter = (typeof WORK_ORDER_PAYMENT_FILTERS)[number];

export function isWorkOrderPaymentFilter(
  value: string | null | undefined,
): value is WorkOrderPaymentFilter {
  return (WORK_ORDER_PAYMENT_FILTERS as readonly (string | null | undefined)[]).includes(value);
}

/**
 * The payment filter as a row predicate. "Balance outstanding" is money still
 * to collect: a cancelled or refunded project's balance is no longer
 * receivable, so it is never outstanding. "Paid in full" is unchanged.
 */
export function matchesWorkOrderPayment(
  row: PaymentSource & Pick<WorkOrderListRow, "cancellation">,
  filter: WorkOrderPaymentFilter,
): boolean {
  const { isSettled } = paymentSummary(row);
  return filter === "pending" ? !isSettled && row.cancellation == null : isSettled;
}

/** How the work order's page describes the project it became. */
export interface LinkedProjectNote {
  text: string;
  /** `active` and `done` read as good news (green); `closed` is muted. */
  tone: "active" | "done" | "closed";
}

/**
 * The strip on an approved work order that points at its project: still in
 * progress, finished (commissioned, or handed over for a custom plan), or out
 * of the pipeline (cancelled or refunded).
 */
export function linkedProjectNote(
  project: Pick<NonNullable<WorkOrder["project"]>, "is_completed" | "cancellation">,
  plan: PlanType | null | undefined,
): LinkedProjectNote {
  if (project.cancellation) {
    return {
      text: `This work order's project was ${project.cancellation}.`,
      tone: "closed",
    };
  }
  if (project.is_completed) {
    return {
      text: `This work order's project is ${plan === "custom" ? "handed over" : "commissioned"}.`,
      tone: "done",
    };
  }
  return { text: "This work order is an active project.", tone: "active" };
}

/**
 * The line a phone adds under the client's name (the Coordinators column is
 * wide-screen only). The office reads who the sale belongs to; a coordinator
 * reads who they share it with — never themself, and nothing for a sale that is
 * theirs alone.
 */
export function teamNote(
  row: Pick<WorkOrderListRow, "coordinator_ids" | "coordinator_names">,
  viewer: { id: string; office: boolean },
): string | null {
  const names = row.coordinator_names ?? [];
  if (viewer.office) return names.length > 0 ? coordinatorsLabel(names) : null;
  const ids = row.coordinator_ids ?? [];
  const others = names.filter((_, i) => ids[i] !== viewer.id);
  return others.length > 0 ? `with ${coordinatorsLabel(others)}` : null;
}
