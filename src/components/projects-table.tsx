"use client";

import { KanbanSquare } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout";
import { StageBadge } from "@/components/status-badges";
import { PROJECT_STAGES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Coordinator } from "@/server/data";
import type { ProjectListRow } from "@/lib/types";

function progress(p: ProjectListRow) {
  const total = p.milestones_total || PROJECT_STAGES.length;
  return `${p.milestones_done}/${total}`;
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
        <span className="font-medium hover:underline">
          {p.client_name ?? "Project"}
        </span>
      ),
    },
    {
      id: "coordinator",
      header: "Coordinator",
      hidden: !isAdmin,
      cell: (p) => p.coordinator_name ?? "—",
    },
    {
      id: "capacity",
      header: "Capacity",
      cell: (p) => p.plant_capacity ?? "—",
    },
    {
      id: "stage",
      header: "Current Stage",
      cell: (p) =>
        p.is_completed ? (
          <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
            Commissioned
          </Badge>
        ) : (
          <StageBadge stage={p.current_stage} />
        ),
    },
    { id: "progress", header: "Progress", cell: (p) => progress(p) },
    {
      id: "created",
      header: "Created",
      sortable: true,
      sortKey: "created_at",
      sortAccessor: (p) => new Date(p.created_at).getTime(),
      cell: (p) => formatDate(p.created_at),
    },
  ];

  const filters: FilterDef<ProjectListRow>[] = [
    {
      id: "status",
      placeholder: "Status",
      options: [
        { value: "all", label: "All projects" },
        { value: "active", label: "Active" },
        { value: "completed", label: "Commissioned" },
      ],
      predicate: (p, v) =>
        v === "active" ? !p.is_completed : v === "completed" ? p.is_completed : true,
    },
    {
      id: "stage",
      placeholder: "Project stage",
      widthClass: "sm:w-64",
      options: [
        { value: "all", label: "All stages" },
        ...PROJECT_STAGES.map((s) => ({ value: s.value, label: s.label })),
      ],
      predicate: (p, v) => p.current_stage === v,
    },
    {
      id: "coordinator",
      placeholder: "Coordinator",
      widthClass: "sm:w-52",
      hidden: !isAdmin,
      options: [
        { value: "all", label: "All coordinators" },
        ...coordinators.map((c) => ({ value: c.id, label: c.full_name })),
      ],
      predicate: (p, v) => p.coordinator_id === v,
    },
  ];

  const search: SearchDef<ProjectListRow> = {
    placeholder: "Search client or coordinator…",
    columns: ["client_name", "coordinator_name"],
    predicate: (p, q) =>
      (p.client_name ?? "").toLowerCase().includes(q) ||
      (p.coordinator_name ?? "").toLowerCase().includes(q),
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
