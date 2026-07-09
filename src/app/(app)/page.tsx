import Link from "next/link";
import {
  ClipboardList,
  Clock,
  KanbanSquare,
  CheckCircle2,
  Wrench,
  IndianRupee,
  ArrowRight,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import {
  metricsRepository,
  profilesRepository,
  projectsRepository,
  workOrdersRepository,
} from "@/server/data";
import { Page, PageHeader, StatCard } from "@/components/layout";
import { WorkOrdersTable } from "@/components/work-orders-table";
import { ProjectsTable } from "@/components/projects-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/format";
import { DASHBOARD_RECENT } from "@/lib/constants";

export default async function DashboardPage() {
  const profile = await requireAdmin();

  // KPIs come from a single aggregate query; the tables show a bounded,
  // most-recent slice (full data lives on the dedicated list pages).
  const [metrics, recentWorkOrders, recentProjects, coordinators] =
    await Promise.all([
      metricsRepository.dashboard(),
      workOrdersRepository.recent(DASHBOARD_RECENT),
      projectsRepository.recent(DASHBOARD_RECENT),
      profilesRepository.coordinators(),
    ]);

  return (
    <Page>
      <PageHeader
        title={`Welcome, ${profile.full_name.split(" ")[0]}`}
        description="Office overview across all coordinators."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Work Orders"
          value={metrics.totalWorkOrders}
          icon={ClipboardList}
        />
        <StatCard
          label="Pending Approvals"
          value={metrics.pendingApprovals}
          icon={Clock}
          accent="bg-amber-100 text-amber-700"
        />
        <StatCard
          label="Active Projects"
          value={metrics.activeProjects}
          icon={KanbanSquare}
          accent="bg-indigo-100 text-indigo-700"
        />
        <StatCard
          label="Commissioned"
          value={metrics.commissioned}
          icon={CheckCircle2}
          accent="bg-emerald-100 text-emerald-700"
        />
        <StatCard
          label="Open Tickets"
          value={metrics.openTickets}
          icon={Wrench}
          accent="bg-blue-100 text-blue-700"
        />
        <StatCard
          label="Approved Pipeline"
          value={formatCurrency(metrics.approvedPipeline)}
          icon={IndianRupee}
          accent="bg-emerald-100 text-emerald-700"
        />
      </div>

      <Tabs defaultValue="work-orders">
        <TabsList>
          <TabsTrigger value="work-orders">Recent Work Orders</TabsTrigger>
          <TabsTrigger value="projects">Recent Projects</TabsTrigger>
        </TabsList>
        <TabsContent value="work-orders" className="mt-4 space-y-2">
          <WorkOrdersTable
            workOrders={recentWorkOrders}
            coordinators={coordinators}
            isAdmin
          />
          <ViewAllLink href="/work-orders" label="View all work orders" />
        </TabsContent>
        <TabsContent value="projects" className="mt-4 space-y-2">
          <ProjectsTable
            projects={recentProjects}
            coordinators={coordinators}
            isAdmin
          />
          <ViewAllLink href="/projects" label="View all projects" />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="flex justify-end">
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {label}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
