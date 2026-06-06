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
export const WORK_ORDER_STATUS: StatusRegistry<WorkOrderStatus> = {
  pending: { label: "Pending", badgeClass: "bg-amber-100 text-amber-800" },
  approved: {
    label: "Approved",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  rejected: { label: "Rejected", badgeClass: "bg-red-100 text-red-800" },
};

export const TICKET_STATUS: StatusRegistry<TicketStatus> = {
  open: { label: "Open", badgeClass: "bg-amber-100 text-amber-800" },
  scheduled: { label: "Scheduled", badgeClass: "bg-blue-100 text-blue-800" },
  in_progress: {
    label: "In Progress",
    badgeClass: "bg-indigo-100 text-indigo-800",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  cancelled: { label: "Cancelled", badgeClass: "bg-gray-100 text-gray-700" },
};

export const MILESTONE_STATUS: StatusRegistry<MilestoneStatus> = {
  pending: { label: "Pending", badgeClass: "bg-gray-100 text-gray-700" },
  in_progress: {
    label: "In Progress",
    badgeClass: "bg-indigo-100 text-indigo-800",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
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
