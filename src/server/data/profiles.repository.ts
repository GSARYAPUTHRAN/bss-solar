import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

export type Coordinator = Pick<Profile, "id" | "full_name">;

export const profilesRepository = {
  async list(): Promise<Profile[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    return (data as Profile[]) ?? [];
  },

  async coordinators(): Promise<Coordinator[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .order("full_name", { ascending: true });
    return (data as Coordinator[]) ?? [];
  },

  async setRole(
    id: string,
    role: UserRole,
  ): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", id);
    return { error: error?.message ?? null };
  },

  /** Number of admin accounts (used to prevent locking out the last admin). */
  async adminCount(): Promise<number> {
    const supabase = await createClient();
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    return count ?? 0;
  },
};
