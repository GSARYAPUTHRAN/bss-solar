import {
  ClipboardList,
  Clock,
  KanbanSquare,
  CheckCircle2,
  Wrench,
  IndianRupee,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import {
  profilesRepository,
  projectsRepository,
  ticketsRepository,
  workOrdersRepository,
} from "@/server/data";
import { Page, PageHeader, StatCard } from "@/components/layout";
import { WorkOrdersTable } from "@/components/work-orders-table";
import { ProjectsTable } from "@/components/projects-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/format";

export default async function DashboardPage() {
  const profile = await requireAdmin();

  const [workOrders, projects, tickets, coordinators] = await Promise.all([
    workOrdersRepository.list(),
    projectsRepository.list(),
    ticketsRepository.statuses(),
    profilesRepository.coordinators(),
  ]);

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
    <Page>
      <PageHeader
        title={`Welcome, ${profile.full_name.split(" ")[0]}`}
        description="Office overview across all coordinators."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Work Orders"
          value={workOrders.length}
          icon={ClipboardList}
        />
        <StatCard
          label="Pending Approvals"
          value={pendingApprovals}
          icon={Clock}
          accent="bg-amber-100 text-amber-700"
        />
        <StatCard
          label="Active Projects"
          value={activeProjects}
          icon={KanbanSquare}
          accent="bg-indigo-100 text-indigo-700"
        />
        <StatCard
          label="Commissioned"
          value={commissioned}
          icon={CheckCircle2}
          accent="bg-emerald-100 text-emerald-700"
        />
        <StatCard
          label="Open Tickets"
          value={openTickets}
          icon={Wrench}
          accent="bg-blue-100 text-blue-700"
        />
        <StatCard
          label="Approved Pipeline"
          value={formatCurrency(pipelineValue)}
          icon={IndianRupee}
          accent="bg-emerald-100 text-emerald-700"
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
            isAdmin
          />
        </TabsContent>
        <TabsContent value="projects" className="mt-4">
          <ProjectsTable
            projects={projects}
            coordinators={coordinators}
            isAdmin
          />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
