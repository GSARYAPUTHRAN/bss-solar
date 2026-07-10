"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { homeForRole } from "@/config/navigation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { LOGIN_RATE_LIMIT } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Throttle credential guessing (best-effort; see rate-limit.ts / DEPLOY.md).
  const hdrs = await headers();
  const ip =
    (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const rl = rateLimit(
    `login:${ip}:${email.toLowerCase()}`,
    LOGIN_RATE_LIMIT.max,
    LOGIN_RATE_LIMIT.windowMs,
    Date.now(),
  );
  if (!rl.allowed) {
    const mins = Math.ceil(rl.retryAfterSeconds / 60);
    redirect(
      `/login?error=${encodeURIComponent(
        `Too many sign-in attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      )}`,
    );
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let home = homeForRole("coordinator");
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role) home = homeForRole(profile.role as UserRole);
  }

  revalidatePath("/", "layout");
  redirect(home);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
