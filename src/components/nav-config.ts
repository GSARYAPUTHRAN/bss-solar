import {
  LayoutDashboard,
  ClipboardList,
  KanbanSquare,
  Wrench,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "coordinator"],
  },
  {
    href: "/work-orders",
    label: "Work Orders",
    icon: ClipboardList,
    roles: ["admin", "coordinator"],
  },
  {
    href: "/projects",
    label: "Projects",
    icon: KanbanSquare,
    roles: ["admin", "coordinator"],
  },
  {
    href: "/tickets",
    label: "Service Tickets",
    icon: Wrench,
    roles: ["admin", "coordinator"],
  },
  {
    href: "/team",
    label: "Team",
    icon: Users,
    roles: ["admin"],
  },
];

export function navForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
