import type { UserRole } from "@/lib/types";

/**
 * Single source of truth for the role hierarchy.
 *
 *   coordinator       field sales; sees only their own work orders/projects.
 *   service_engineer  field service; sees and works only the service tickets
 *                     assigned to them (never work orders, projects or money).
 *   admin             office staff; sees and manages everything. For now an
 *                     admin may also delete (see DELETE_ROLES) — coordinators
 *                     and engineers, never another admin or the Super Admin.
 *   superadmin        exactly one account; everything an admin can, and the
 *                     only one who may delete an admin or change an admin's
 *                     role (see roleChangeAuthority in lib/domain/team.ts).
 *
 * `superadmin` is a strict superset of `admin`, so every admin-gated surface
 * must test with `isOfficeRole`, never `role === "admin"`. The DB mirrors this:
 * `is_admin()` is true for both, and `can_delete()` (the twin of DELETE_ROLES)
 * gates the DELETE policies.
 *
 * The SuperAdmin seat is the top of the hierarchy and is **immutable from the
 * app**: it is never offered in a role picker, and no signed-in user — including
 * the SuperAdmin — can grant or revoke it (a DB trigger enforces the same).
 * Provisioning is SQL-only; see supabase/production-bootstrap.sql.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  coordinator: "Coordinator",
  service_engineer: "Service Engineer",
  admin: "Admin",
  superadmin: "Super Admin",
};

/** Roles with org-wide visibility (admin *or* superadmin). */
export const OFFICE_ROLES: UserRole[] = ["admin", "superadmin"];

/** Roles that work the sales pipeline (/work-orders, /projects). */
export const WORK_ORDER_ROLES: UserRole[] = ["coordinator", ...OFFICE_ROLES];

/** Roles that may open the service-ticket module (engineers see only theirs). */
export const TICKET_ROLES: UserRole[] = ["service_engineer", ...OFFICE_ROLES];

/** Roles that may own a work order (log business). Never an engineer. */
export const WORK_ORDER_OWNER_ROLES: UserRole[] = WORK_ORDER_ROLES;

/**
 * Who may delete records (sales, projects, ledger entries, incentives, team
 * members). This is the ONE switch in TypeScript; its database twin is
 * `can_delete()` (migration 20261125120000), which every DELETE policy asks.
 *
 * Admins hold it for now. To make deletes Super Admin–only again, drop "admin"
 * here AND change `can_delete()`'s list to ('superadmin') in a new migration —
 * every guard (`requireDeleter`), button and piece of copy follows this list.
 */
export const DELETE_ROLES: UserRole[] = ["admin", "superadmin"];

export function canDeleteRole(role: UserRole): boolean {
  return DELETE_ROLES.includes(role);
}

/**
 * Who may delete, for copy: "Admin or Super Admin" today, "Super Admin" once
 * admins lose it. Use it instead of naming a role in a sentence about deletes.
 */
export function deleteRolesLabel(roles: readonly UserRole[] = DELETE_ROLES): string {
  const labels = roles.map((role) => ROLE_LABELS[role]);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

export function isOfficeRole(role: UserRole): boolean {
  return OFFICE_ROLES.includes(role);
}

export function isSuperAdminRole(role: UserRole): boolean {
  return role === "superadmin";
}

export function isServiceEngineerRole(role: UserRole): boolean {
  return role === "service_engineer";
}

export function canUseWorkOrders(role: UserRole): boolean {
  return WORK_ORDER_ROLES.includes(role);
}

/**
 * The roles a role picker may offer. `superadmin` is deliberately absent — the
 * seat cannot be assigned or removed through the app at all.
 */
export const ASSIGNABLE_ROLES: UserRole[] = ["coordinator", "service_engineer", "admin"];

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
  return (
    value === "admin" ||
    value === "coordinator" ||
    value === "superadmin" ||
    value === "service_engineer"
  );
}
