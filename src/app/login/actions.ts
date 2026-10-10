"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { homeForRole } from "@/config/navigation";
import { createClient } from "@/lib/supabase/server";
import { clearRateLimit, rateLimit } from "@/lib/rate-limit";
import { LOGIN_RATE_LIMIT } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Throttle credential guessing (best-effort; see rate-limit.ts / DEPLOY.md).
  // The attempt is counted BEFORE GoTrue is awaited (rateLimit() checks and
  // counts in one synchronous step), so a burst of parallel requests cannot all
  // pass the check while the earlier ones are still in flight. A success clears
  // the slate, so only failures add up: signing in correctly (several devices,
  // sign-out/in) never locks anyone out.
  const hdrs = await headers();
  const ip =
    (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const key = `login:${ip}:${email.toLowerCase()}`;
  const rl = rateLimit(
    key,
    LOGIN_RATE_LIMIT.max,
    LOGIN_RATE_LIMIT.windowMs,
    Date.now(),
  );
  if (!rl.allowed) {
    const mins = Math.ceil(rl.retryAfterSeconds / 60);
    redirect(
      `/login?error=${encodeURIComponent(
        `Too many failed sign-in attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      )}`,
    );
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // A failure stays counted: the attempt was reserved above.
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  clearRateLimit(key);

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
