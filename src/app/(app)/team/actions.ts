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
import {
  deletionBlocker,
  planTeamEdit,
  roleChangeBlocker,
  type TeamAuthPatch,
  type TeamProfilePatch,
} from "@/lib/domain/team";
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

/** `null` before the first submit. */
export type TeamEditState = ActionResult<{ message: string }> | null;

type AdminClient = ReturnType<typeof createAdminClient>;

/** A posted text field, or `undefined` when the form did not carry it. */
function postedText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Everywhere a member's name shows: their row, the sales and projects they are on. */
function revalidateMemberNames() {
  revalidatePath("/team");
  revalidatePath("/work-orders");
  revalidatePath("/projects");
  revalidatePath("/");
}

/**
 * An upstream error as a sentence, with `secret` blotted out in case it echoes
 * the value back (Auth's messages do not, but the password must never surface).
 */
function sentence(message: string, secret: string | undefined): string {
  const safe = secret ? message.split(secret).join("•••") : message;
  return /[.!?]$/.test(safe) ? safe : `${safe}.`;
}

/**
 * Write the sign-in part of an edit to Auth: the e-mail (confirmed on the spot,
 * so no mail is sent), the password, and the name Auth keeps in `user_metadata`
 * (merged, so nothing else in it is lost). Resolves to why Auth refused, or
 * `null`. The signed-in user's own session is never touched.
 */
async function updateSignIn(
  admin: AdminClient,
  id: string,
  patch: TeamAuthPatch,
): Promise<string | null> {
  let error: { message: string; code?: string } | null;
  try {
    ({ error } = await admin.auth.admin.updateUserById(id, {
      ...(patch.email !== undefined && { email: patch.email, email_confirm: true }),
      ...(patch.password !== undefined && { password: patch.password }),
      ...(patch.fullName !== undefined && { user_metadata: { full_name: patch.fullName } }),
    }));
  } catch {
    return "The sign-in service did not respond.";
  }
  if (!error) return null;

  switch (error.code) {
    case "email_exists":
    case "user_already_exists":
      return `${patch.email ?? "That e-mail"} already belongs to another account.`;
    case "same_password":
      return "That is already their password — leave the field blank to keep it.";
    case "user_not_found":
      return "That team member no longer exists.";
    default:
      return `Could not update the account: ${sentence(error.message, patch.password)}`;
  }
}

/**
 * Edit a member's name, phone, e-mail or password from the Team page. Role is not
 * editable here (see `updateUserRole`, and the immutable Super Admin seat).
 *
 * Who may change what is `teamEditAuthority` (lib/domain/team.ts): an admin may
 * not touch another admin's login or the Super Admin at all. It is enforced here
 * against the member as the database has them *now* — the posted form says only
 * which member and what to change, never what they are — and everything is
 * validated and checked for duplicates before the first write.
 *
 * The profile is written first and Auth second; if Auth refuses (a duplicate
 * e-mail that slipped in, a weak password) the profile is put back, so the edit
 * lands whole or not at all. Runs from a dialog that keeps the user's input on
 * error, so it answers with a result rather than redirecting. The password is
 * only ever passed through to Auth: it is not returned, logged or stored.
 */
export async function updateTeamMember(
  _prev: TeamEditState,
  formData: FormData,
): Promise<TeamEditState> {
  const me = await requireAdmin();

  const [target, directory] = await Promise.all([
    profilesRepository.byId(text(formData.get("id"))),
    profilesRepository.accounts(),
  ]);
  if (!target) return fail("That team member no longer exists.");
  // The duplicate checks need the whole team: without it, refuse rather than guess.
  if (directory.error) {
    return fail("Could not check the team's accounts just now — try again.");
  }

  const plan = planTeamEdit({
    viewer: me,
    target: {
      ...target,
      email: directory.accounts.find((a) => a.id === target.id)?.email ?? null,
    },
    posted: {
      fullName: postedText(formData, "full_name"),
      phone: postedText(formData, "phone"),
      email: postedText(formData, "email"),
      password: postedText(formData, "password"),
    },
    accounts: directory.accounts,
  });
  if (!plan.ok) return plan;
  const { profile, auth } = plan.data;
  if (!profile && !auth) return ok({ message: "No changes to save." });

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Admin client unavailable");
  }

  if (profile) {
    const { error } = await admin.from("profiles").update(profile).eq("id", target.id);
    if (error) return fail(`Could not save the changes: ${error.message}`);
  }

  if (auth) {
    const refused = await updateSignIn(admin, target.id, auth);
    if (refused) {
      if (!profile) return fail(`${refused} Nothing was saved.`);

      // Put the profile back as it was.
      const before: TeamProfilePatch = {};
      if (profile.full_name !== undefined) before.full_name = target.full_name;
      if (profile.phone !== undefined) before.phone = target.phone;
      const { error } = await admin.from("profiles").update(before).eq("id", target.id);
      return fail(
        error
          ? `${refused} The new name or phone could not be undone — check ${target.full_name}'s details.`
          : `${refused} Nothing was saved.`,
      );
    }
  }

  revalidateMemberNames();
  return ok({ message: "Saved." });
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

  // Never strand anything: the last administrator, the sales a coordinator logs
  // or merely shares (a partner on someone else's sale counts), or an
  // engineer's open tickets (see lib/domain/team.ts).
  const [adminCount, owned] = await Promise.all([
    profilesRepository.adminCount(),
    profilesRepository.ownedWorkCount(userId),
  ]);
  const blocker = roleChangeBlocker({
    name: target.full_name,
    from: target.role,
    to: role,
    adminCount,
    owned,
  });
  if (blocker) return fail(blocker);

  const { error } = await profilesRepository.setRole(userId, role);
  if (error) return fail(error);

  revalidatePath("/team");
  return ok(undefined);
}

/**
 * Destructive — SuperAdmin only. Removes the auth user; the profile row goes with
 * it via `on delete cascade`.
 *
 * A sale's coordinators (`work_order_coordinators`) reference the member with
 * `on delete restrict`, so a member who still owns or shares business cannot be
 * deleted — take them off those sales or delete that business first.
 * Tickets reference their engineer with `on delete set null`, so an engineer with
 * open tickets is refused too, rather than leaving those jobs silently unowned.
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
  // opaque "Database error deleting user" (or, for tickets, silently unassign).
  const blocker = deletionBlocker(
    target.full_name,
    await profilesRepository.ownedWorkCount(userId),
  );
  if (blocker) redirect(`/team?error=${encodeURIComponent(blocker)}`);

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
