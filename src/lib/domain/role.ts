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
 * Options for a role picker. The SuperAdmin seat is only offered to whoever may
 * actually grant it — the current SuperAdmin, or any admin while it is vacant.
 */
export function roleOptions(
  canGrantSuperAdmin: boolean,
): { value: UserRole; label: string }[] {
  const options: { value: UserRole; label: string }[] = [
    { value: "coordinator", label: ROLE_LABELS.coordinator },
    { value: "admin", label: ROLE_LABELS.admin },
  ];
  if (canGrantSuperAdmin) {
    options.push({ value: "superadmin", label: ROLE_LABELS.superadmin });
  }
  return options;
}

/** Type guard for values arriving from a form/URL. */
export function isUserRole(value: string): value is UserRole {
  return value === "admin" || value === "coordinator" || value === "superadmin";
}
