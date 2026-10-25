"use client";

import { KanbanSquare } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout";
import { CoordinatorNames } from "@/components/coordinator-names";
import {
  CancellationBadge,
  FeasibilityBadge,
  FinancingBadge,
  PaymentBadge,
  PlanBadge,
  StageBadge,
} from "@/components/status-badges";
import { IncentiveTotal, SaleIncentiveLine } from "@/components/projects/incentive-badge";
import { PROJECT_STAGES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { FINANCING, statusOptions } from "@/lib/domain/status";
import { PLAN_TYPE, PLAN_TYPES, completionLabel } from "@/lib/domain/plan";
import { teamNote } from "@/lib/domain/work-order-list";
import {
  FEASIBILITY_FILTERS,
  FEASIBILITY_FILTER_LABELS,
  INCENTIVE_FILTERS,
  INCENTIVE_FILTER_LABELS,
  PROJECT_STATUS_FILTERS,
  PROJECT_STATUS_FILTER_LABELS,
  isFeasibilityFilter,
  isIncentiveFilter,
  isPlanFilter,
  isProjectStatusFilter,
  listRowFeasibility,
  listRowProgress,
  matchesCoordinator,
  matchesFeasibilityFilter,
  matchesProjectStatus,
  matchesSaleIncentiveFilter,
} from "@/lib/domain/project-list";
import type { Coordinator } from "@/server/data";
import type { ProjectListRow } from "@/lib/types";

// Secondary columns step aside on phones; the client cell carries a compact
// summary there instead, so the list reads as cards without sideways scrolling.
const FROM_MD = "hidden md:table-cell";
const FROM_LG = "hidden lg:table-cell";

/** Cancelled / refunded, then commissioned (or handed over), else the stage. */
function StageCell({ project: p }: { project: ProjectListRow }) {
  if (p.cancellation) return <CancellationBadge cancellation={p.cancellation} />;
  return p.is_completed ? (
    <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
      {completionLabel(p.plan_type)}
    </Badge>
  ) : (
    <StageBadge stage={p.current_stage} plan={p.plan_type} />
  );
}

/**
 * Feasibility, but only while the clock is running or worth a look. A custom
 * plan has no KSEB process, and a cancelled project with no date has no clock.
 */
function FeasibilityCell({ project }: { project: ProjectListRow }) {
  if (project.plan_type === "custom") return <>—</>;
  const status = listRowFeasibility(project);
  if (status.state === "not_set" && project.cancellation) return <>—</>;
  if (status.state === "closed" && status.renewals === 0) return <>—</>;
  return <FeasibilityBadge status={status} />;
}

function MobileSummary({
  project: p,
  showAll,
  viewerId,
}: {
  project: ProjectListRow;
  showAll: boolean;
  viewerId: string;
}) {
  const feasibility = listRowFeasibility(p);
  const team = teamNote(p, { id: viewerId, office: showAll });
  return (
    <div className="mt-1 space-y-1.5 md:hidden">
      <p className="break-words text-xs text-muted-foreground">
        {[p.plant_capacity, team].filter(Boolean).join(" · ")}
      </p>
      <div className="flex flex-wrap gap-1">
        <StageCell project={p} />
        <PlanBadge plan={p.plan_type} />
        {/* A cancelled project's stage cell already says nothing more is due. */}
        {!p.cancellation && <PaymentBadge source={p} isCompleted={p.is_completed} />}
        {(feasibility.state === "expiring" || feasibility.state === "extended") && (
          <FeasibilityBadge status={feasibility} />
        )}
      </div>
      <SaleIncentiveLine
        total={p.incentive_total}
        count={p.incentive_count}
        unpaidCount={p.incentive_unpaid_count}
        label={showAll ? "Incentive" : "Your incentive"}
      />
    </div>
  );
}

export function ProjectsTable({
  projects,
  coordinators,
  isAdmin,
  viewerId,
  noun = "projects",
  server,
}: {
  projects: ProjectListRow[];
  coordinators: Coordinator[];
  isAdmin: boolean;
  /** The signed-in person, so a shared sale reads "with …" on a phone. */
  viewerId: string;
  /** What the pagination footer calls the rows ("Showing 1–10 of 25 {noun}"). */
  noun?: string;
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
          <MobileSummary project={p} showAll={isAdmin} viewerId={viewerId} />
        </div>
      ),
    },
    {
      // Everyone on the sale; a coordinator sees who they share it with.
      id: "coordinator",
      header: "Coordinators",
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => <CoordinatorNames names={p.coordinator_names} />,
    },
    {
      // A solar plant's kW capacity, or what a custom plan sold.
      id: "capacity",
      header: "Capacity",
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="break-words">{p.plant_capacity ?? "—"}</span>
          <PlanBadge plan={p.plan_type} />
        </span>
      ),
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
      // What the viewer may see: the office the sale's total, a coordinator
      // their own (the view applies RLS to the incentive rows).
      id: "incentive",
      header: (
        <span
          title={isAdmin ? "Total for everyone on the sale" : "Your incentive on the sale"}
        >
          Incentive
        </span>
      ),
      sortable: true,
      sortKey: "incentive_total",
      sortAccessor: (p) => Number(p.incentive_total ?? -1),
      className: FROM_MD,
      headerClassName: FROM_MD,
      cell: (p) => (
        <IncentiveTotal
          total={p.incentive_total}
          count={p.incentive_count}
          unpaidCount={p.incentive_unpaid_count}
        />
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
      cell: (p) => (
        <PaymentBadge source={p} isCompleted={p.is_completed} cancellation={p.cancellation} />
      ),
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
        ...PROJECT_STATUS_FILTERS.map((s) => ({
          value: s,
          label: PROJECT_STATUS_FILTER_LABELS[s],
        })),
      ],
      predicate: (p, v) => !isProjectStatusFilter(v) || matchesProjectStatus(p, v),
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
      id: "plan",
      placeholder: "Plan",
      widthClass: "sm:w-40",
      options: [
        { value: "all", label: "Any plan" },
        ...PLAN_TYPES.map((t) => ({ value: t, label: PLAN_TYPE[t].label })),
      ],
      predicate: (p, v) => !isPlanFilter(v) || p.plan_type === v,
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
      // About the sale's incentives in total. (The server list narrows to the
      // picked coordinator's own incentive; a filter here cannot read another.)
      id: "incentive",
      placeholder: "Incentive",
      widthClass: "sm:w-44",
      options: [
        { value: "all", label: "Any incentive" },
        ...INCENTIVE_FILTERS.map((f) => ({ value: f, label: INCENTIVE_FILTER_LABELS[f] })),
      ],
      predicate: (p, v) => !isIncentiveFilter(v) || matchesSaleIncentiveFilter(p, v),
    },
    {
      // Any member of the sale matches, not only its first coordinator.
      id: "coordinator",
      placeholder: "Coordinator",
      widthClass: "sm:w-48",
      hidden: !isAdmin,
      options: [
        { value: "all", label: "All coordinators" },
        ...coordinators.map((c) => ({ value: c.id, label: c.full_name })),
      ],
      predicate: (p, v) => matchesCoordinator(p, v),
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
        noun={noun}
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
      noun={noun}
      emptyMessage="No projects found."
      getRowHref={(p) => `/projects/${p.id}`}
    />
  );
}
