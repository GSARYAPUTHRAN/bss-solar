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
import { ROLE_LABELS, isSuperAdminRole, isUserRole } from "@/lib/domain/role";
import type { UserRole } from "@/lib/types";

/**
 * May the caller move the SuperAdmin seat? Only the sitting SuperAdmin can —
 * except while the seat is vacant, when any admin may appoint the first one
 * (bootstrap on a fresh install, and the recovery path if the account is lost).
 * A DB trigger enforces the same rule, and a unique index caps the seat at one.
 */
async function canGrantSuperAdmin(me: { role: UserRole }): Promise<boolean> {
  if (isSuperAdminRole(me.role)) return true;
  return !(await profilesRepository.superAdminExists());
}

export async function createTeamMember(formData: FormData) {
  const me = await requireAdmin();

  const fullName = text(formData.get("full_name"));
  const email = text(formData.get("email"));
  const password = text(formData.get("password"));
  const phone = str(formData.get("phone"));
  const role = enumValue<UserRole>(formData.get("role"), "coordinator");

  if (!isUserRole(role)) {
    redirect(`/team/new?error=${encodeURIComponent("Invalid role")}`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(
      `/team/new?error=${encodeURIComponent(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)}`,
    );
  }
  // The profile row is written with the service-role client below, which bypasses
  // RLS *and* leaves the DB guard inert (auth.uid() is null), so the SuperAdmin
  // rule has to be enforced here.
  if (isSuperAdminRole(role) && !(await canGrantSuperAdmin(me))) {
    redirect(
      `/team/new?error=${encodeURIComponent(
        "Only the SuperAdmin can create another SuperAdmin. Demote the current one first.",
      )}`,
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
      redirect(
        `/team/new?error=${encodeURIComponent(describeRoleError(profileError.message))}`,
      );
    }
  }

  revalidatePath("/team");
  redirect(withFlash("/team", "Team member added."));
}

/** Turn the raw Postgres failure into something an office user can act on. */
function describeRoleError(message: string): string {
  if (message.includes("uniq_profiles_single_superadmin")) {
    return "There can only be one SuperAdmin. Reassign the existing one first.";
  }
  return message;
}

export async function updateUserRole(
  userId: string,
  role: UserRole,
): Promise<ActionResult> {
  const me = await requireAdmin();

  if (!isUserRole(role)) return fail("Invalid role");

  // Never let an admin demote themselves (would risk an admin lock-out).
  if (userId === me.id && role !== me.role) {
    return fail("You cannot change your own role.");
  }

  const target = await profilesRepository.byId(userId);
  if (!target) return fail("That team member no longer exists.");
  if (target.role === role) return ok(undefined);

  // Only the SuperAdmin may move the seat (see canGrantSuperAdmin).
  const touchesSuperAdmin =
    isSuperAdminRole(role) || isSuperAdminRole(target.role);
  if (touchesSuperAdmin && !(await canGrantSuperAdmin(me))) {
    return fail("Only the SuperAdmin can grant or revoke the SuperAdmin role.");
  }

  // Belt-and-suspenders: never remove the last remaining administrator.
  if (role === "coordinator" && (await profilesRepository.adminCount()) <= 1) {
    return fail("At least one administrator is required.");
  }

  // Promoting someone else while holding the seat is a *transfer*: step down
  // first, because a unique index allows only one SuperAdmin at a time.
  const isTransfer = isSuperAdminRole(role) && isSuperAdminRole(me.role);
  if (isTransfer) {
    const stepDown = await profilesRepository.setRole(me.id, "admin");
    if (stepDown.error) return fail(describeRoleError(stepDown.error));
  }

  const { error } = await profilesRepository.setRole(userId, role);
  if (error) {
    // Restore the seat so a failed transfer cannot leave it vacant.
    if (isTransfer) await profilesRepository.setRole(me.id, "superadmin");
    return fail(describeRoleError(error));
  }

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
    const message = /violates foreign key|restrict/i.test(error.message)
      ? `${target.full_name} still owns work orders. Delete or reassign those first.`
      : error.message;
    redirect(`/team?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/team");
  redirect(
    withFlash(
      "/team",
      `${target.full_name} (${ROLE_LABELS[target.role]}) was deleted.`,
    ),
  );
}
