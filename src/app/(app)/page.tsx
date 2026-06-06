import {
  ClipboardList,
  Clock,
  KanbanSquare,
  CheckCircle2,
  Wrench,
  IndianRupee,
} from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCoordinators } from "@/lib/queries";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { WorkOrdersTable } from "@/components/work-orders-table";
import { ProjectsTable } from "@/components/projects-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/format";
import type { Project, ServiceTicket, WorkOrder } from "@/lib/types";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const isAdmin = profile.role === "admin";

  const [woRes, projRes, ticketRes, coordinators] = await Promise.all([
    supabase
      .from("work_orders")
      .select(
        `*,
         coordinator:profiles!work_orders_coordinator_id_fkey(id, full_name),
         projects(id, current_stage, is_completed)`,
      )
      .order("order_date", { ascending: false }),
    supabase
      .from("projects")
      .select(
        `*,
         work_order:work_orders!projects_work_order_id_fkey(client_name, plant_capacity, total_cost),
         coordinator:profiles!projects_coordinator_id_fkey(id, full_name),
         milestones:project_milestones(status)`,
      )
      .order("created_at", { ascending: false }),
    supabase.from("service_tickets").select("id, status"),
    isAdmin ? getCoordinators() : Promise.resolve([]),
  ]);

  const workOrders: WorkOrder[] = (woRes.data ?? []).map((row) => {
    const record = row as unknown as WorkOrder & {
      projects?: WorkOrder["project"][] | null;
    };
    const projects = record.projects;
    return {
      ...record,
      project: projects && projects.length > 0 ? projects[0] : null,
    };
  });

  const projects = (projRes.data as Project[]) ?? [];
  const tickets = (ticketRes.data as Pick<ServiceTicket, "id" | "status">[]) ?? [];

  const pendingApprovals = workOrders.filter(
    (w) => w.status === "pending",
  ).length;
  const activeProjects = projects.filter((p) => !p.is_completed).length;
  const commissioned = projects.filter((p) => p.is_completed).length;
  const openTickets = tickets.filter(
    (t) => t.status === "open" || t.status === "scheduled" || t.status === "in_progress",
  ).length;
  const pipelineValue = workOrders
    .filter((w) => w.status === "approved")
    .reduce((sum, w) => sum + Number(w.total_cost ?? 0), 0);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile.full_name.split(" ")[0]}`}
        description={
          isAdmin
            ? "Office overview across all coordinators."
            : "Your work orders and projects at a glance."
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Work Orders"
          value={workOrders.length}
          icon={ClipboardList}
        />
        <StatCard
          label="Pending Approvals"
          value={pendingApprovals}
          icon={Clock}
          accent="text-amber-600"
        />
        <StatCard
          label="Active Projects"
          value={activeProjects}
          icon={KanbanSquare}
          accent="text-indigo-600"
        />
        <StatCard
          label="Commissioned"
          value={commissioned}
          icon={CheckCircle2}
          accent="text-emerald-600"
        />
        <StatCard
          label="Open Tickets"
          value={openTickets}
          icon={Wrench}
          accent="text-blue-600"
        />
        <StatCard
          label="Approved Pipeline"
          value={formatCurrency(pipelineValue)}
          icon={IndianRupee}
          accent="text-emerald-600"
        />
      </div>

      <Tabs defaultValue="work-orders">
        <TabsList>
          <TabsTrigger value="work-orders">Work Orders</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
        </TabsList>
        <TabsContent value="work-orders" className="mt-4">
          <WorkOrdersTable
            workOrders={workOrders}
            coordinators={coordinators}
            isAdmin={isAdmin}
          />
        </TabsContent>
        <TabsContent value="projects" className="mt-4">
          <ProjectsTable
            projects={projects}
            coordinators={coordinators}
            isAdmin={isAdmin}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
