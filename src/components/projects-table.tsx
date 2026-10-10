"use client";

import { KanbanSquare } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout";
import {
  FeasibilityBadge,
  FinancingBadge,
  PaymentBadge,
  StageBadge,
} from "@/components/status-badges";
import { IncentiveAmount, IncentiveLine } from "@/components/projects/incentive-badge";
import { PROJECT_STAGES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { FINANCING, statusOptions } from "@/lib/domain/status";
import { isPaymentPending } from "@/lib/domain/payment";
import {
  FEASIBILITY_FILTERS,
  FEASIBILITY_FILTER_LABELS,
  INCENTIVE_FILTERS,
  INCENTIVE_FILTER_LABELS,
  isFeasibilityFilter,
  isIncentiveFilter,
  listRowFeasibility,
  listRowProgress,
  matchesFeasibilityFilter,
  matchesIncentiveFilter,
} from "@/lib/domain/project-list";
import type { Coordinator } from "@/server/data";
import type { ProjectListRow } from "@/lib/types";

// Secondary columns step aside on phones; the client cell carries a compact
// summary there instead, so the list reads as cards without sideways scrolling.
const FROM_MD = "hidden md:table-cell";
const FROM_LG = "hidden lg:table-cell";

function StageCell({ project: p }: { project: ProjectListRow }) {
  return p.is_completed ? (
    <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
      Commissioned
    </Badge>
  ) : (
    <StageBadge stage={p.current_stage} />
  );
}

/** Feasibility, but only while the clock is running or worth a look. */
function FeasibilityCell({ project }: { project: ProjectListRow }) {
  const status = listRowFeasibility(project);
  if (status.state === "closed" && status.renewals === 0) return <>—</>;
  return <FeasibilityBadge status={status} />;
}

function MobileSummary({ project: p }: { project: ProjectListRow }) {
  const feasibility = listRowFeasibility(p);
  return (
    <div className="mt-1 space-y-1.5 md:hidden">
      <p className="text-xs text-muted-foreground">
        {[p.plant_capacity, p.coordinator_name].filter(Boolean).join(" · ")}
      </p>
      <div className="flex flex-wrap gap-1">
        <StageCell project={p} />
        <PaymentBadge source={p} isCompleted={p.is_completed} />
        {(feasibility.state === "expiring" || feasibility.state === "extended") && (
          <FeasibilityBadge status={feasibility} />
        )}
      </div>
      <IncentiveLine incentive={p.coordinator_incentive} paidOn={p.incentive_paid_on} />
    </div>
  );
}

export function ProjectsTable({
  projects,
  coordinators,
  isAdmin,
  server,
}: {
  projects: ProjectListRow[];
  coordinators: Coordinator[];
  isAdmin: boolean;
  server?: { total: number; page: number; pageSize: number };
}) {
  const columns: ColumnDef<ProjectListRow>[] = [
    {
      id: "client_name",
      header: "Client",
      sortable: true,
      sortKey: "client_name",
      sortAccessor: (p) => (p.client_name ?? "").toLowerCase(),
      cell: (p) => (
        <div className="min-w-0">
          <span className="font-medium hover:underline">{p.client_name ?? "Project"}</span>
          <MobileSummary project={p} />
        </div>
      ),
    },
    {
      id: "coordinator",
      header: "Coordinator",
      hidden: !isAdmin,
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => p.coordinator_name ?? "—",
    },
    {
      id: "capacity",
      header: "Capacity",
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => p.plant_capacity ?? "—",
    },
    {
      id: "stage",
      header: "Current Stage",
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => <StageCell project={p} />,
    },
    {
      id: "progress",
      header: "Progress",
      className: FROM_LG,
      headerClassName: FROM_LG,
      cell: (p) => {
        const { done, total } = listRowProgress(p);
        return `${done}/${total}`;
      },
    },
    {
      id: "financing",
      header: "Financing",
      className: FROM_LG,
      headerClassName: FROM_LG,
      cell: (p) => <FinancingBadge financing={p.financing_type} bank={p.loan_bank_name} />,
    },
    {
      id: "feasibility",
      header: "Feasibility",
      sortable: true,
      sortKey: "feasibility_days_left",
      // Running clocks first, most urgent first; finished/unset ones last.
      sortAccessor: (p) => p.feasibility_days_left ?? Number.MAX_SAFE_INTEGER,
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => <FeasibilityCell project={p} />,
    },
    {
      id: "incentive",
      header: "Incentive",
      sortable: true,
      sortKey: "coordinator_incentive",
      sortAccessor: (p) => Number(p.coordinator_incentive ?? -1),
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => (
        <IncentiveAmount incentive={p.coordinator_incentive} paidOn={p.incentive_paid_on} />
      ),
    },
    {
      id: "payment",
      header: "Payment",
      sortable: true,
      sortKey: "balance_due",
      sortAccessor: (p) => Number(p.balance_due ?? 0),
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => <PaymentBadge source={p} isCompleted={p.is_completed} />,
    },
    {
      id: "created",
      header: "Created",
      sortable: true,
      sortKey: "created_at",
      sortAccessor: (p) => new Date(p.created_at).getTime(),
      className: FROM_LG,
      headerClassName: FROM_LG,
      cell: (p) => formatDate(p.created_at),
    },
  ];

  // Filter ids are the shared URL parameter names (see lib/domain/project-list).
  const filters: FilterDef<ProjectListRow>[] = [
    {
      id: "status",
      placeholder: "Status",
      widthClass: "sm:w-56",
      options: [
        { value: "all", label: "All projects" },
        { value: "active", label: "Active" },
        { value: "completed", label: "Commissioned" },
        { value: "payment_pending", label: "Commissioned · payment pending" },
      ],
      predicate: (p, v) =>
        v === "active"
          ? !p.is_completed
          : v === "completed"
            ? p.is_completed
            : v === "payment_pending"
              ? isPaymentPending(p, p)
              : true,
    },
    {
      id: "stage",
      placeholder: "Project stage",
      widthClass: "sm:w-56",
      options: [
        { value: "all", label: "All stages" },
        ...PROJECT_STAGES.map((s) => ({ value: s.value, label: s.label })),
      ],
      predicate: (p, v) => p.current_stage === v,
    },
    {
      id: "feasibility",
      placeholder: "Feasibility",
      widthClass: "sm:w-48",
      options: [
        { value: "all", label: "Any feasibility" },
        ...FEASIBILITY_FILTERS.map((f) => ({ value: f, label: FEASIBILITY_FILTER_LABELS[f] })),
      ],
      predicate: (p, v) => !isFeasibilityFilter(v) || matchesFeasibilityFilter(p, v),
    },
    {
      id: "financing",
      placeholder: "Financing",
      widthClass: "sm:w-40",
      options: [{ value: "all", label: "Any financing" }, ...statusOptions(FINANCING)],
      predicate: (p, v) => (p.financing_type ?? "self") === v,
    },
    {
      id: "incentive",
      placeholder: "Incentive",
      widthClass: "sm:w-44",
      options: [
        { value: "all", label: "Any incentive" },
        ...INCENTIVE_FILTERS.map((f) => ({ value: f, label: INCENTIVE_FILTER_LABELS[f] })),
      ],
      predicate: (p, v) => !isIncentiveFilter(v) || matchesIncentiveFilter(p, v),
    },
    {
      id: "coordinator",
      placeholder: "Coordinator",
      widthClass: "sm:w-48",
      hidden: !isAdmin,
      options: [
        { value: "all", label: "All coordinators" },
        ...coordinators.map((c) => ({ value: c.id, label: c.full_name })),
      ],
      predicate: (p, v) => p.coordinator_id === v,
    },
  ];

  const search: SearchDef<ProjectListRow> = {
    placeholder: "Search client, coordinator or consumer no.…",
    columns: ["client_name", "coordinator_name", "consumer_number"],
    predicate: (p, q) =>
      (p.client_name ?? "").toLowerCase().includes(q) ||
      (p.coordinator_name ?? "").toLowerCase().includes(q) ||
      (p.consumer_number ?? "").toLowerCase().includes(q),
  };

  if (server) {
    return (
      <ServerDataTable
        rows={projects}
        total={server.total}
        page={server.page}
        pageSize={server.pageSize}
        columns={columns}
        filters={filters}
        search={search}
        noun="projects"
        emptyMessage="No projects found."
        emptyState={
          <EmptyState
            icon={KanbanSquare}
            title="No projects yet"
            description="A project starts automatically when a work order is approved. Approve one, or import existing projects from Onboarding."
          />
        }
        defaultSort={{ key: "created_at", asc: false }}
        getRowHref={(p) => `/projects/${p.id}`}
      />
    );
  }

  return (
    <DataTable
      data={projects}
      columns={columns}
      filters={filters}
      search={search}
      initialSort={{ id: "created", asc: false }}
      noun="projects"
      emptyMessage="No projects found."
      getRowHref={(p) => `/projects/${p.id}`}
    />
  );
}
