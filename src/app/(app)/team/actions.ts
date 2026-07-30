"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { profilesRepository } from "@/server/data";
import { enumValue, str, text } from "@/server/form";
import { fail, ok, type ActionResult } from "@/lib/result";
import { withFlash } from "@/lib/flash";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import {
  ROLE_LABELS,
  isAssignableRole,
  isSuperAdminRole,
  isUserRole,
} from "@/lib/domain/role";
import type { UserRole } from "@/lib/types";

/**
 * The SuperAdmin is the top of the hierarchy and is immutable from the app: the
 * seat cannot be granted, revoked, or reassigned here by anyone — not an admin,
 * and not the SuperAdmin themselves. A DB trigger rejects it independently, and a
 * unique index caps the seat at one. Provisioning and recovery are SQL-only; see
 * supabase/production-bootstrap.sql.
 */
const SUPERADMIN_IMMUTABLE =
  "The Super Admin role cannot be changed here. It is set directly on the database.";

export async function createTeamMember(formData: FormData) {
  await requireAdmin();

  const fullName = text(formData.get("full_name"));
  const email = text(formData.get("email"));
  const password = text(formData.get("password"));
  const phone = str(formData.get("phone"));
  const role = enumValue<UserRole>(formData.get("role"), "coordinator");

  // The profile row is written with the service-role client below, which bypasses
  // RLS *and* leaves the DB guard inert (auth.uid() is null), so the SuperAdmin
  // rule has to be enforced here.
  if (!isUserRole(role) || !isAssignableRole(role)) {
    redirect(
      `/team/new?error=${encodeURIComponent(
        isSuperAdminRole(role as UserRole) ? SUPERADMIN_IMMUTABLE : "Invalid role",
      )}`,
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(
      `/team/new?error=${encodeURIComponent(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)}`,
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    redirect(
      `/team/new?error=${encodeURIComponent(e instanceof Error ? e.message : "Admin client unavailable")}`,
    );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error || !data.user) {
    redirect(
      `/team/new?error=${encodeURIComponent(error?.message ?? "Could not create user")}`,
    );
  }

  const updates: { phone?: string | null; role?: UserRole } = {};
  if (phone) updates.phone = phone;
  if (role !== "coordinator") updates.role = role;

  if (Object.keys(updates).length > 0) {
    const { error: profileError } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", data.user.id);
    if (profileError) {
      // Roll back the just-created auth user so it isn't orphaned and the
      // email can be reused on retry.
      await admin.auth.admin.deleteUser(data.user.id);
      redirect(`/team/new?error=${encodeURIComponent(profileError.message)}`);
    }
  }

  revalidatePath("/team");
  redirect(withFlash("/team", "Team member added."));
}

export async function updateUserRole(
  userId: string,
  role: UserRole,
): Promise<ActionResult> {
  const me = await requireAdmin();

  if (!isUserRole(role)) return fail("Invalid role");

  // Never let anyone demote themselves (would risk an admin lock-out).
  if (userId === me.id && role !== me.role) {
    return fail("You cannot change your own role.");
  }

  const target = await profilesRepository.byId(userId);
  if (!target) return fail("That team member no longer exists.");
  if (target.role === role) return ok(undefined);

  // The seat is immutable from the app, in both directions and for everyone.
  if (isSuperAdminRole(role) || isSuperAdminRole(target.role)) {
    return fail(SUPERADMIN_IMMUTABLE);
  }

  // Belt-and-suspenders: never remove the last remaining administrator.
  if (role === "coordinator" && (await profilesRepository.adminCount()) <= 1) {
    return fail("At least one administrator is required.");
  }

  const { error } = await profilesRepository.setRole(userId, role);
  if (error) return fail(error);

  revalidatePath("/team");
  return ok(undefined);
}

/**
 * Destructive — SuperAdmin only. Removes the auth user; the profile row goes with
 * it via `on delete cascade`.
 *
 * Work orders reference their coordinator with `on delete restrict`, so a member
 * who still owns business cannot be deleted — reassign or delete that work first.
 */
export async function deleteTeamMember(formData: FormData) {
  const me = await requireSuperAdmin();
  const userId = text(formData.get("user_id"));

  if (userId === me.id) {
    redirect(
      `/team?error=${encodeURIComponent("You cannot delete your own account.")}`,
    );
  }

  const target = await profilesRepository.byId(userId);
  if (!target) {
    redirect(
      `/team?error=${encodeURIComponent("That team member no longer exists.")}`,
    );
  }

  // The SuperAdmin account cannot be removed from the app either. Unreachable
  // today (the seat holds one member and they cannot delete themselves), but the
  // rule should not depend on that coincidence.
  if (isSuperAdminRole(target.role)) {
    redirect(
      `/team?error=${encodeURIComponent(
        "The Super Admin account cannot be deleted here.",
      )}`,
    );
  }

  // Refuse up front rather than letting the FK restrict surface as GoTrue's
  // opaque "Database error deleting user".
  const owned = await profilesRepository.ownedWorkCount(userId);
  if (owned.workOrders > 0 || owned.projects > 0) {
    const parts = [
      owned.workOrders > 0 &&
        `${owned.workOrders} work order${owned.workOrders === 1 ? "" : "s"}`,
      owned.projects > 0 &&
        `${owned.projects} project${owned.projects === 1 ? "" : "s"}`,
    ].filter(Boolean);
    redirect(
      `/team?error=${encodeURIComponent(
        `${target.full_name} still owns ${parts.join(" and ")}. Reassign or delete that business first.`,
      )}`,
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    redirect(
      `/team?error=${encodeURIComponent(e instanceof Error ? e.message : "Admin client unavailable")}`,
    );
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    redirect(
      `/team?error=${encodeURIComponent(
        `Could not delete ${target.full_name}: ${error.message}`,
      )}`,
    );
  }

  revalidatePath("/team");
  redirect(
    withFlash(
      "/team",
      `${target.full_name} (${ROLE_LABELS[target.role]}) was deleted.`,
    ),
  );
}
