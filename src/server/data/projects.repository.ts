import { createClient } from "@/lib/supabase/server";
import { LIST_QUERY_LIMIT, PROJECT_PICKER_LIMIT } from "@/lib/constants";
import {
  rangeFor,
  sanitizeSearch,
  type PageParams,
  type PageResult,
} from "@/lib/pagination";
import type {
  MilestoneStatus,
  Project,
  ProjectListRow,
  ProjectMilestone,
  ProjectStage,
} from "@/lib/types";

const PROJECT_SORT_COLUMNS = new Set([
  "created_at",
  "client_name",
  "coordinator_name",
  "current_stage",
]);

const SELECT_LIST = `*,
  work_order:work_orders!projects_work_order_id_fkey(client_name, plant_capacity, total_cost),
  coordinator:profiles!projects_coordinator_id_fkey(id, full_name),
  milestones:project_milestones(status)`;

const SELECT_DETAIL = `*,
  work_order:work_orders!projects_work_order_id_fkey(client_name, client_phone, address, plant_capacity, total_cost, advance_amount),
  coordinator:profiles!projects_coordinator_id_fkey(id, full_name),
  milestones:project_milestones(*)`;

export interface ProjectOption {
  id: string;
  client_name: string;
  plant_capacity: string;
}

type MilestoneSlice = Pick<
  ProjectMilestone,
  "id" | "stage" | "sort_order" | "status"
>;

export const projectsRepository = {
  async list(limit: number = LIST_QUERY_LIMIT): Promise<Project[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(SELECT_LIST)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as Project[]) ?? [];
  },

  /** Most-recent slice (flattened rows) for dashboard/overview contexts. */
  async recent(limit: number): Promise<ProjectListRow[]> {
    const { rows } = await this.page({
      page: 1,
      pageSize: limit,
      q: "",
      sort: null,
      dir: "desc",
      filters: {},
    });
    return rows;
  },

  /** Server-side paginated/filtered/sorted page from the flattened view. */
  async page(params: PageParams): Promise<PageResult<ProjectListRow>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);

    let query = supabase.from("projects_list").select("*", { count: "exact" });

    const q = sanitizeSearch(params.q);
    if (q) {
      const like = `%${q}%`;
      query = query.or(
        `client_name.ilike.${like},coordinator_name.ilike.${like}`,
      );
    }
    if (params.filters.status === "active") {
      query = query.eq("is_completed", false);
    } else if (params.filters.status === "completed") {
      query = query.eq("is_completed", true);
    }
    if (params.filters.stage) {
      query = query.eq("current_stage", params.filters.stage as ProjectStage);
    }
    if (params.filters.coordinator) {
      query = query.eq("coordinator_id", params.filters.coordinator);
    }

    const sortCol = PROJECT_SORT_COLUMNS.has(params.sort ?? "")
      ? (params.sort as "created_at")
      : "created_at";
    query = query
      .order(sortCol, { ascending: params.dir === "asc" })
      .range(from, to);

    const { data, count } = await query;
    return {
      rows: (data as ProjectListRow[]) ?? [],
      total: count ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  async byId(id: string): Promise<Project | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(SELECT_DETAIL)
      .eq("id", id)
      .maybeSingle();
    return (data as Project) ?? null;
  },

  async options(): Promise<ProjectOption[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select(
        `id,
         work_order:work_orders!projects_work_order_id_fkey(client_name, plant_capacity)`,
      )
      .order("created_at", { ascending: false })
      .limit(PROJECT_PICKER_LIMIT);

    return (
      (data as
        | {
            id: string;
            work_order: { client_name: string; plant_capacity: string } | null;
          }[]
        | null) ?? []
    ).map((p) => ({
      id: p.id,
      client_name: p.work_order?.client_name ?? "Project",
      plant_capacity: p.work_order?.plant_capacity ?? "",
    }));
  },

  async existsForWorkOrder(workOrderId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select("id")
      .eq("work_order_id", workOrderId)
      .maybeSingle();
    return Boolean(data);
  },

  async createForWorkOrder(
    workOrderId: string,
    coordinatorId: string,
  ): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase.from("projects").insert({
      work_order_id: workOrderId,
      coordinator_id: coordinatorId,
    });
    return { error: error?.message ?? null };
  },

  async setProgress(
    id: string,
    patch: {
      current_stage: ProjectStage;
      is_completed: boolean;
      completed_at: string | null;
    },
  ): Promise<void> {
    const supabase = await createClient();
    await supabase.from("projects").update(patch).eq("id", id);
  },

  /** Ordered milestone slices for stage recomputation / advancement. */
  async milestones(projectId: string): Promise<MilestoneSlice[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_milestones")
      .select("id, stage, sort_order, status")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });
    return (data as MilestoneSlice[]) ?? [];
  },

  async updateMilestone(
    milestoneId: string,
    patch: {
      status: MilestoneStatus;
      notes?: string | null;
      completed_at: string | null;
    },
  ): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_milestones")
      .update(patch)
      .eq("id", milestoneId);
    return { error: error?.message ?? null };
  },
};
