"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { profilesRepository } from "@/server/data";
import { enumValue, str, text } from "@/server/form";
import { fail, ok, type ActionResult } from "@/lib/result";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

export async function createTeamMember(formData: FormData) {
  await requireAdmin();

  const fullName = text(formData.get("full_name"));
  const email = text(formData.get("email"));
  const password = text(formData.get("password"));
  const phone = str(formData.get("phone"));
  const role = enumValue<UserRole>(formData.get("role"), "coordinator");

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
  if (role === "admin") updates.role = role;

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
        `/team/new?error=${encodeURIComponent(profileError.message)}`,
      );
    }
  }

  revalidatePath("/team");
  redirect("/team");
}

export async function updateUserRole(
  userId: string,
  role: UserRole,
): Promise<ActionResult> {
  const me = await requireAdmin();

  if (role !== "admin" && role !== "coordinator") {
    return fail("Invalid role");
  }

  // Never let an admin demote themselves (would risk an admin lock-out).
  if (userId === me.id && role !== "admin") {
    return fail("You cannot change your own admin role.");
  }

  // Belt-and-suspenders: never remove the last remaining admin.
  if (role === "coordinator" && (await profilesRepository.adminCount()) <= 1) {
    return fail("At least one administrator is required.");
  }

  const { error } = await profilesRepository.setRole(userId, role);
  if (error) return fail(error);

  revalidatePath("/team");
  return ok(undefined);
}
