import type { UserRole } from "@/lib/types";

export type NavIcon =
  | "dashboard"
  | "work-orders"
  | "projects"
  | "tickets"
  | "team";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  roles: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: "dashboard",
    roles: ["admin", "coordinator"],
  },
  {
    href: "/work-orders",
    label: "Work Orders",
    icon: "work-orders",
    roles: ["admin", "coordinator"],
  },
  {
    href: "/projects",
    label: "Projects",
    icon: "projects",
    roles: ["admin", "coordinator"],
  },
  {
    href: "/tickets",
    label: "Service Tickets",
    icon: "tickets",
    roles: ["admin", "coordinator"],
  },
  {
    href: "/team",
    label: "Team",
    icon: "team",
    roles: ["admin"],
  },
];

export function navForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
