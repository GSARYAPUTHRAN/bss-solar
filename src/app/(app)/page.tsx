import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  KanbanSquare,
  CheckCircle2,
  Wallet,
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
          accent="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        />
        <StatCard
          label="Active Projects"
          value={metrics.activeProjects}
          icon={KanbanSquare}
          accent="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
        />
        <StatCard
          label="Commissioned"
          value={metrics.commissioned}
          icon={CheckCircle2}
          accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        />
        <StatCard
          label="Open Tickets"
          value={metrics.openTickets}
          icon={Wrench}
          accent="bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
        />
        <StatCard
          label="Approved Pipeline"
          value={formatCurrency(metrics.approvedPipeline)}
          icon={IndianRupee}
          accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        />
        {/* Commissioned and handed over, but the money is not fully in. */}
        <StatCard
          label="Commissioned · Unpaid"
          value={metrics.commissionedUnpaid}
          icon={AlertTriangle}
          accent="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          hint="Commissioned plants with a balance"
          href="/projects?view=list&status=payment_pending"
        />
        <StatCard
          label="Outstanding Collections"
          value={formatCurrency(metrics.outstandingAmount)}
          icon={Wallet}
          accent="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          hint="Balance due on commissioned plants"
          href="/projects?view=list&status=payment_pending"
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
