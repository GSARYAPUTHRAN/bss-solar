import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  ClipboardList,
  Clock,
  KanbanSquare,
  CheckCircle2,
  Wallet,
  Wrench,
  IndianRupee,
  ArrowRight,
  CalendarClock,
  Repeat,
  HandCoins,
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
import { FEASIBILITY_WARNING_DAYS } from "@/lib/domain/kseb";

/** Icon tints for the KPI tiles (light + dark variants). */
const ACCENT = {
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300",
} as const;

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

  // Every project is in exactly one of these four.
  const closedProjects = metrics.cancelledProjects + metrics.refundedProjects;
  const totalProjects = metrics.activeProjects + metrics.commissioned + closedProjects;

  return (
    <Page>
      <PageHeader
        title={`Welcome, ${profile.full_name.split(" ")[0]}`}
        description="Office overview across all coordinators."
      />

      <KpiGroup title="Pipeline">
        <StatCard
          label="Total Work Orders"
          value={metrics.totalWorkOrders}
          icon={ClipboardList}
          href="/work-orders"
        />
        <StatCard
          label="Pending Approvals"
          value={metrics.pendingApprovals}
          icon={Clock}
          accent={ACCENT.amber}
          href="/work-orders?status=pending"
        />
        <StatCard
          label="Active Projects"
          value={metrics.activeProjects}
          icon={KanbanSquare}
          accent={ACCENT.indigo}
          hint="Excludes cancelled and refunded"
        />
        <StatCard
          label="Commissioned"
          value={metrics.commissioned}
          icon={CheckCircle2}
          accent={ACCENT.emerald}
        />
        <StatCard
          label="Open Tickets"
          value={metrics.openTickets}
          icon={Wrench}
          accent={ACCENT.blue}
        />
        <StatCard
          label="Approved Pipeline"
          value={formatCurrency(metrics.approvedPipeline)}
          icon={IndianRupee}
          accent={ACCENT.emerald}
          hint="Excludes cancelled and refunded projects"
        />
        {/* Out of every count above; the list holds them for the record. */}
        <StatCard
          label="Cancelled / Refunded"
          value={closedProjects}
          icon={Ban}
          accent={ACCENT.gray}
          hint={`${metrics.cancelledProjects} cancelled · ${metrics.refundedProjects} refunded — out of the pipeline`}
          href="/projects?view=list&status=closed"
        />
      </KpiGroup>

      <KpiGroup title="Needs attention">
        {/* Commissioned and handed over, but the money is not fully in. */}
        <StatCard
          label="Commissioned · Unpaid"
          value={metrics.commissionedUnpaid}
          icon={AlertTriangle}
          accent={ACCENT.red}
          hint="Commissioned plants with a balance"
          href="/projects?view=list&status=payment_pending"
        />
        <StatCard
          label="Outstanding Collections"
          value={formatCurrency(metrics.outstandingAmount)}
          icon={Wallet}
          accent={ACCENT.red}
          hint="Balance due on commissioned plants"
          href="/projects?view=list&status=payment_pending"
        />
        {/* Commission inside the validity, or BSS pays the next ₹1,000 renewal. */}
        <StatCard
          label="Feasibility Expiring"
          value={metrics.feasibilityExpiring}
          icon={CalendarClock}
          accent={ACCENT.red}
          hint={`Validity ends within ${FEASIBILITY_WARNING_DAYS} days`}
          href="/projects?view=list&feasibility=expiring"
        />
        {/* Every project, commissioned ones too: a renewal fee stays a cost
            after the clock stops, and the "extended" filter lists the same set. */}
        <StatCard
          label="Feasibility Extension Cost"
          value={formatCurrency(metrics.feasibilityExtensionCost)}
          icon={Repeat}
          accent={ACCENT.amber}
          hint="Renewal fees borne by BSS"
          href="/projects?view=list&feasibility=extended"
        />
        <StatCard
          label="Incentives Pending"
          value={formatCurrency(metrics.incentivePending)}
          icon={HandCoins}
          accent={ACCENT.indigo}
          hint="Coordinator incentives not yet paid"
          href="/projects?view=list&incentive=pending"
        />
      </KpiGroup>

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
            viewerId={profile.id}
            noun="latest work orders"
          />
          <ViewAllLink
            href="/work-orders"
            label={`View all ${metrics.totalWorkOrders} work orders`}
          />
        </TabsContent>
        <TabsContent value="projects" className="mt-4 space-y-2">
          {/* The table pages through the latest few; it must not read as the total. */}
          <ProjectsTable
            projects={recentProjects}
            coordinators={coordinators}
            isAdmin
            viewerId={profile.id}
            noun="latest projects"
          />
          <ViewAllLink href="/projects" label={`View all ${totalProjects} projects`} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function KpiGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const id = `kpi-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2
        id={id}
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
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
