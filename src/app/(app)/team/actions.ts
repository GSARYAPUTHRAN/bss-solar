"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

export async function updateUserRole(userId: string, role: UserRole) {
  await requireAdmin();
  if (role !== "admin" && role !== "coordinator") {
    return { error: "Invalid role" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/team");
  return { error: null };
}
