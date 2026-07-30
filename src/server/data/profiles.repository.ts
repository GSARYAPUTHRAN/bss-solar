import { createClient } from "@/lib/supabase/server";
import {
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import { OFFICE_ROLES } from "@/lib/domain/role";
import type { Profile, UserRole } from "@/lib/types";

export type Coordinator = Pick<Profile, "id" | "full_name">;

const PROFILE_SORT_COLUMNS = new Set(["full_name", "created_at"]);

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

  /** Server-side paginated/filtered/sorted page of team members. */
  async page(params: PageParams): Promise<PageResult<Profile>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);

    let query = supabase.from("profiles").select("*", { count: "exact" });

    const q = sanitizeSearch(params.q);
    if (q) {
      const like = `%${q}%`;
      query = query.or(`full_name.ilike.${like},phone.ilike.${like}`);
    }
    if (params.filters.role) {
      query = query.eq("role", params.filters.role as UserRole);
    }

    const sortCol = PROFILE_SORT_COLUMNS.has(params.sort ?? "")
      ? (params.sort as "full_name")
      : "full_name";
    query = query
      .order(sortCol, { ascending: params.dir !== "desc" })
      .range(from, to);

    const { data, count } = await query;
    return {
      rows: (data as Profile[]) ?? [],
      total: count ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  /**
   * Number of accounts with org-wide admin rights — `admin` *and* `superadmin`,
   * since the SuperAdmin is a strict superset. Used to prevent locking out the
   * last administrator.
   */
  async adminCount(): Promise<number> {
    const supabase = await createClient();
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("role", OFFICE_ROLES);
    return count ?? 0;
  },

  /**
   * Work owned by a member. `work_orders.coordinator_id` and
   * `projects.coordinator_id` are `on delete restrict`, so deleting the account
   * would fail — and GoTrue reports that only as an opaque "Database error
   * deleting user". Counting first lets the caller refuse with something the
   * office can act on.
   */
  async ownedWorkCount(
    id: string,
  ): Promise<{ workOrders: number; projects: number }> {
    const supabase = await createClient();
    const [workOrders, projects] = await Promise.all([
      supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true })
        .eq("coordinator_id", id),
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("coordinator_id", id),
    ]);
    return {
      workOrders: workOrders.count ?? 0,
      projects: projects.count ?? 0,
    };
  },

  async byId(id: string): Promise<Profile | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, phone, role, created_at")
      .eq("id", id)
      .maybeSingle();
    return (data as Profile) ?? null;
  },
};
