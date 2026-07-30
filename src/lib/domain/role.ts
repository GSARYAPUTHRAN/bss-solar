import type { UserRole } from "@/lib/types";

/**
 * Single source of truth for the role hierarchy.
 *
 *   coordinator — field sales; sees only their own work orders/projects.
 *   admin       — office staff; sees and manages everything except deletes.
 *   superadmin  — exactly one account; additionally owns every destructive
 *                 action (deleting users, projects and work orders).
 *
 * `superadmin` is a strict superset of `admin`, so every admin-gated surface
 * must test with `isOfficeRole`, never `role === "admin"`. The DB mirrors this:
 * `is_admin()` is true for both, and `is_superadmin()` gates DELETE policies.
 *
 * The SuperAdmin seat is the top of the hierarchy and is **immutable from the
 * app**: it is never offered in a role picker, and no signed-in user — including
 * the SuperAdmin — can grant or revoke it (a DB trigger enforces the same).
 * Provisioning is SQL-only; see supabase/production-bootstrap.sql.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  coordinator: "Coordinator",
  admin: "Admin",
  superadmin: "Super Admin",
};

/** Roles with org-wide visibility (admin *or* superadmin). */
export const OFFICE_ROLES: UserRole[] = ["admin", "superadmin"];

export function isOfficeRole(role: UserRole): boolean {
  return OFFICE_ROLES.includes(role);
}

export function isSuperAdminRole(role: UserRole): boolean {
  return role === "superadmin";
}

/**
 * The roles a role picker may offer. `superadmin` is deliberately absent — the
 * seat cannot be assigned or removed through the app at all.
 */
export const ASSIGNABLE_ROLES: UserRole[] = ["coordinator", "admin"];

export function roleOptions(): { value: UserRole; label: string }[] {
  return ASSIGNABLE_ROLES.map((value) => ({
    value,
    label: ROLE_LABELS[value],
  }));
}

export function isAssignableRole(role: UserRole): boolean {
  return ASSIGNABLE_ROLES.includes(role);
}

/** Type guard for values arriving from a form/URL. */
export function isUserRole(value: string): value is UserRole {
  return value === "admin" || value === "coordinator" || value === "superadmin";
}
