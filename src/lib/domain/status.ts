import type {
  MilestoneStatus,
  TicketStatus,
  WorkOrderStatus,
} from "@/lib/types";

/** Presentation metadata for a single enum value. */
export interface StatusMeta {
  label: string;
  /** Tailwind classes for a soft, bordered badge. */
  badgeClass: string;
}

export type StatusRegistry<K extends string> = Record<K, StatusMeta>;

/**
 * Single source of truth for status presentation. Adding a status means
 * editing one registry entry — labels, badge colors, and filter options all
 * derive from here.
 */
// Soft, bordered badges with explicit dark-mode variants so status colours read
// correctly in both themes (the text label remains the primary signifier).
const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
const EMERALD =
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
const RED = "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
const BLUE = "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300";
const INDIGO =
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300";
const GRAY = "bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300";

export const WORK_ORDER_STATUS: StatusRegistry<WorkOrderStatus> = {
  pending: { label: "Pending", badgeClass: AMBER },
  approved: { label: "Approved", badgeClass: EMERALD },
  rejected: { label: "Rejected", badgeClass: RED },
};

export const TICKET_STATUS: StatusRegistry<TicketStatus> = {
  open: { label: "Open", badgeClass: AMBER },
  scheduled: { label: "Scheduled", badgeClass: BLUE },
  in_progress: { label: "In Progress", badgeClass: INDIGO },
  completed: { label: "Completed", badgeClass: EMERALD },
  cancelled: { label: "Cancelled", badgeClass: GRAY },
};

export const MILESTONE_STATUS: StatusRegistry<MilestoneStatus> = {
  pending: { label: "Pending", badgeClass: GRAY },
  in_progress: { label: "In Progress", badgeClass: INDIGO },
  completed: { label: "Completed", badgeClass: EMERALD },
};

/** Derive a `value -> label` map from a registry. */
export function statusLabels<K extends string>(
  registry: StatusRegistry<K>,
): Record<K, string> {
  return Object.fromEntries(
    Object.entries(registry).map(([k, v]) => [k, (v as StatusMeta).label]),
  ) as Record<K, string>;
}

/** Derive select/filter options (`{ value, label }[]`) from a registry. */
export function statusOptions<K extends string>(
  registry: StatusRegistry<K>,
): { value: string; label: string }[] {
  return Object.entries(registry).map(([value, v]) => ({
    value,
    label: (v as StatusMeta).label,
  }));
}
