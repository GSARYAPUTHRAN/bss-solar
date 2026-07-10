import { cache } from "react";
import { redirect } from "next/navigation";
import { homeForRole } from "@/config/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "./types";

/**
 * Resolve the current user's profile. Wrapped in React.cache so the layout and
 * page in a single request share one `auth.getUser()` + profiles read instead
 * of duplicating both round-trips.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, created_at")
    .eq("id", user.id)
    .single();

  return (data as Profile) ?? null;
});

export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  return requireRole("admin");
}

/**
 * Ensure the current user is authenticated and holds one of the given roles,
 * otherwise redirect. Returns the profile for convenience.
 */
export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect(homeForRole(profile.role));
  return profile;
}
