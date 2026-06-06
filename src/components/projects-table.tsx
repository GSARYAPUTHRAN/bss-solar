"use client";

import { DataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/status-badges";
import { PROJECT_STAGES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Coordinator } from "@/server/data";
import type { Project } from "@/lib/types";

function progress(p: Project) {
  const ms = p.milestones ?? [];
  const total = ms.length || 8;
  const done = ms.filter((m) => m.status === "completed").length;
  return `${done}/${total}`;
}

export function ProjectsTable({
  projects,
  coordinators,
  isAdmin,
}: {
  projects: Project[];
  coordinators: Coordinator[];
  isAdmin: boolean;
}) {
  const columns: ColumnDef<Project>[] = [
    {
      id: "client",
      header: "Client",
      cell: (p) => (
        <span className="font-medium hover:underline">
          {p.work_order?.client_name ?? "Project"}
        </span>
      ),
    },
    {
      id: "coordinator",
      header: "Coordinator",
      hidden: !isAdmin,
      cell: (p) => p.coordinator?.full_name ?? "—",
    },
    {
      id: "capacity",
      header: "Capacity",
      cell: (p) => p.work_order?.plant_capacity ?? "—",
    },
    {
      id: "stage",
      header: "Current Stage",
      cell: (p) =>
        p.is_completed ? (
          <Badge className="border-transparent bg-emerald-100 text-emerald-800">
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
      sortAccessor: (p) => new Date(p.created_at).getTime(),
      cell: (p) => formatDate(p.created_at),
    },
  ];

  const filters: FilterDef<Project>[] = [
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

  return (
    <DataTable
      data={projects}
      columns={columns}
      filters={filters}
      search={{
        placeholder: "Search client…",
        predicate: (p, q) =>
          (p.work_order?.client_name ?? "").toLowerCase().includes(q),
      }}
      initialSort={{ id: "created", asc: false }}
      noun="projects"
      emptyMessage="No projects found."
      getRowHref={(p) => `/projects/${p.id}`}
    />
  );
}
