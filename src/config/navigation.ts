import type { UserRole } from "@/lib/types";

/** Icon keys are resolved to components client-side (see nav-icons.tsx). */
export type NavIcon =
  | "dashboard"
  | "work-orders"
  | "projects"
  | "tickets"
  | "team";

export interface ModuleNav {
  href: string;
  label: string;
  icon: NavIcon;
  roles: UserRole[];
}

/**
 * Registry of feature modules surfaced in the navigation.
 *
 * Plug-and-play: registering a new module is a single entry here plus its
 * route folder under `app/(app)/<segment>`. Role-based visibility, sidebar,
 * and mobile nav all derive from this list.
 */
export const MODULES: ModuleNav[] = [
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

export function navForRole(role: UserRole): ModuleNav[] {
  return MODULES.filter((module) => module.roles.includes(role));
}
