import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCoordinators } from "@/lib/queries";
import { PageHeader } from "@/components/page-header";
import { ProjectsBoard } from "@/components/projects-board";
import type { Project } from "@/lib/types";

export default async function ProjectsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("projects")
    .select(
      `*,
       work_order:work_orders!projects_work_order_id_fkey(client_name, plant_capacity, total_cost),
       coordinator:profiles!projects_coordinator_id_fkey(id, full_name),
       milestones:project_milestones(status)`,
    )
    .order("created_at", { ascending: false });

  const projects = (data as Project[]) ?? [];
  const coordinators =
    profile.role === "admin" ? await getCoordinators() : [];

  return (
    <div>
      <PageHeader
        title="Project Tracker"
        description="KSEB / ANERT installation pipeline. Drag-free Kanban grouped by current milestone."
      />
      <ProjectsBoard
        projects={projects}
        coordinators={coordinators}
        isAdmin={profile.role === "admin"}
      />
    </div>
  );
}
