import { createClient } from "@/lib/supabase/server";
import {
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import { OFFICE_ROLES, WORK_ORDER_OWNER_ROLES } from "@/lib/domain/role";
import { ACTIVE_TICKET_STATUSES } from "@/lib/domain/ticket-workflow";
import type { OwnedWork } from "@/lib/domain/team";
import type { Profile, UserRole } from "@/lib/types";

/** A member as a picker/filter option. */
export type Coordinator = Pick<Profile, "id" | "full_name">;
export type ServiceEngineer = Pick<Profile, "id" | "full_name">;
/** An account that can own or share a sale — what the coordinator pickers list. */
export type DirectoryCoordinator = Coordinator & { role: UserRole };

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

  /**
   * Members who can own a work order — backs every "coordinator" picker and
   * filter. Service engineers are deliberately excluded (the DB rejects them as
   * owners too).
   */
  async coordinators(): Promise<Coordinator[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("role", WORK_ORDER_OWNER_ROLES)
      .order("full_name", { ascending: true });
    return (data as Coordinator[]) ?? [];
  },

  /**
   * Accounts that can own or share a sale, for the partner picker and the
   * office's coordinator filter (`coordinator_directory()`): names and roles
   * only, readable by coordinators too — unlike `profiles`, which a coordinator
   * can read only for themself and their partners. Engineers get nothing.
   */
  async coordinatorDirectory(): Promise<DirectoryCoordinator[]> {
    const supabase = await createClient();
    const { data } = await supabase.rpc("coordinator_directory");
    return (data ?? []).map((row) => ({
      id: row.id,
      full_name: row.full_name,
      role: row.role,
    }));
  },

  /** Members a service ticket may be assigned to. */
  async serviceEngineers(): Promise<ServiceEngineer[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "service_engineer")
      .order("full_name", { ascending: true });
    return (data as ServiceEngineer[]) ?? [];
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
    // `id` breaks ties: accounts created together (one script, one import) share
    // a created_at, and an unordered tie can repeat or skip rows across pages.
    query = query
      .order(sortCol, { ascending: params.dir !== "desc" })
      .order("id", { ascending: true })
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
   * Work attached to a member: the sales they log or share. A sale's
   * coordinators live in `work_order_coordinators` (`on delete restrict`), so
   * deleting a member who is on one would fail — and GoTrue reports that only as
   * an opaque "Database error deleting user". Counting memberships (not just
   * `work_orders.coordinator_id`, the first coordinator) also catches a partner
   * who shares a sale someone else logged.
   * `service_tickets.assigned_to` is `on delete set null`, so deleting an
   * engineer would instead silently orphan their open tickets.
   * Counting first lets the caller refuse with something the office can act on
   * (see lib/domain/team.ts). Runs as the office, which reads every membership.
   */
  async ownedWorkCount(id: string): Promise<OwnedWork> {
    const supabase = await createClient();
    const [workOrders, projects, activeTickets] = await Promise.all([
      supabase
        .from("work_order_coordinators")
        .select("work_order_id", { count: "exact", head: true })
        .eq("coordinator_id", id),
      supabase
        .from("projects_list")
        .select("id", { count: "exact", head: true })
        .contains("coordinator_ids", [id]),
      supabase
        .from("service_tickets")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", id)
        .in("status", ACTIVE_TICKET_STATUSES),
    ]);
    return {
      workOrders: workOrders.count ?? 0,
      projects: projects.count ?? 0,
      activeTickets: activeTickets.count ?? 0,
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
