import { isOfficeRole, isServiceEngineerRole } from "@/lib/domain/role";
import type { UserRole } from "@/lib/types";

/** Icon keys are resolved to components client-side (see nav-icons.tsx). */
export type NavIcon =
  | "dashboard"
  | "work-orders"
  | "projects"
  | "tickets"
  | "team"
  | "onboarding";

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
    roles: ["admin"],
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
    // Engineers see only the tickets assigned to them (RLS + engineer_tickets()).
    roles: ["admin", "service_engineer"],
  },
  {
    href: "/team",
    label: "Team",
    icon: "team",
    roles: ["admin"],
  },
  {
    href: "/onboarding",
    label: "Onboarding",
    icon: "onboarding",
    roles: ["admin"],
  },
];

export function navForRole(role: UserRole): ModuleNav[] {
  // Each module lists the *minimum* roles it needs. The SuperAdmin is a strict
  // superset of admin, so it inherits every admin module without every entry
  // above having to repeat it.
  const effective: UserRole[] = isOfficeRole(role) ? [role, "admin"] : [role];
  return MODULES.filter((module) =>
    module.roles.some((r) => effective.includes(r)),
  );
}

/** Default landing route after sign-in. */
export function homeForRole(role: UserRole): string {
  if (isOfficeRole(role)) return "/";
  if (isServiceEngineerRole(role)) return "/tickets";
  return "/work-orders";
}
