import {
  ClipboardList,
  IndianRupee,
  KanbanSquare,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { categoryOf, type NotificationCategory } from "@/lib/domain/notifications";

interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  /** Soft tile colours with explicit dark-mode variants (as the status badges). */
  toneClass: string;
}

/**
 * How each notification category looks. Icons match the sidebar modules so a
 * field user recognises "this is about a work order / a ticket" at a glance.
 */
export const NOTIFICATION_CATEGORY: Record<NotificationCategory, CategoryMeta> = {
  sales: {
    label: "Work order",
    icon: ClipboardList,
    toneClass: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  },
  project: {
    label: "Project",
    icon: KanbanSquare,
    toneClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  payment: {
    label: "Payment",
    icon: IndianRupee,
    toneClass:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  service: {
    label: "Service",
    icon: Wrench,
    toneClass: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  kseb: {
    label: "KSEB",
    icon: Zap,
    toneClass: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  },
};

export function categoryMeta(type: string): CategoryMeta {
  return NOTIFICATION_CATEGORY[categoryOf(type)];
}
