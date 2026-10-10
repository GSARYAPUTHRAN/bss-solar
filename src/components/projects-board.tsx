"use client";

import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectBoardCard } from "@/components/projects/project-board-card";
import { PROJECT_STAGES, STAGE_LABELS } from "@/lib/constants";
import {
  FEASIBILITY_FILTERS,
  FEASIBILITY_FILTER_LABELS,
  isFeasibilityFilter,
  matchesFeasibilityFilter,
} from "@/lib/domain/project-list";
import type { Coordinator } from "@/server/data";
import type { ProjectListRow, ProjectStage } from "@/lib/types";

const ALL = "all";

type BoardStatus = "active" | "completed" | "payment_pending" | typeof ALL;

const STATUS_OPTIONS: { value: BoardStatus; label: string }[] = [
  { value: "active", label: "Active projects" },
  { value: "completed", label: "Commissioned" },
  { value: "payment_pending", label: "Commissioned · payment pending" },
  { value: ALL, label: "All projects" },
];

function matchesStatus(p: ProjectListRow, status: string): boolean {
  switch (status) {
    case "active":
      return !p.is_completed;
    case "completed":
      return p.is_completed;
    case "payment_pending":
      return Boolean(p.payment_pending);
    default:
      return true;
  }
}

// Phones get tall triggers (≥ 40px tap target); desktop keeps the compact size.
const TRIGGER = "w-full data-[size=default]:h-10 sm:data-[size=default]:h-8";

/**
 * Kanban of projects by current stage. Filters run on the client over a
 * bounded set of `projects_list` rows; feasibility badges come from the view's
 * SQL-computed clock, so they match the list view's filters exactly.
 */
export function ProjectsBoard({
  projects,
  coordinators,
  isAdmin,
}: {
  projects: ProjectListRow[];
  coordinators: Coordinator[];
  isAdmin: boolean;
}) {
  const [coordinator, setCoordinator] = useState(ALL);
  const [status, setStatus] = useState<string>("active");
  const [feasibility, setFeasibility] = useState(ALL);

  const filtered = useMemo(
    () =>
      projects.filter(
        (p) =>
          (coordinator === ALL || p.coordinator_id === coordinator) &&
          matchesStatus(p, status) &&
          (!isFeasibilityFilter(feasibility) || matchesFeasibilityFilter(p, feasibility)),
      ),
    [projects, coordinator, status, feasibility],
  );

  const byStage = useMemo(() => {
    const map = new Map<ProjectStage, ProjectListRow[]>();
    PROJECT_STAGES.forEach((s) => map.set(s.value, []));
    filtered.forEach((p) => map.get(p.current_stage)?.push(p));
    return map;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Project status" className={`${TRIGGER} sm:w-60`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={feasibility} onValueChange={setFeasibility}>
          <SelectTrigger aria-label="Feasibility" className={`${TRIGGER} sm:w-56`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any feasibility</SelectItem>
            {FEASIBILITY_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {FEASIBILITY_FILTER_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <Select value={coordinator} onValueChange={setCoordinator}>
            <SelectTrigger aria-label="Coordinator" className={`${TRIGGER} sm:w-52`}>
              <SelectValue placeholder="Coordinator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All coordinators</SelectItem>
              {coordinators.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
          {filtered.length} projects
        </p>
      </div>

      {/* One column per swipe on phones; the scroll stays inside the board. */}
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 sm:snap-none">
        {PROJECT_STAGES.map((stage, idx) => {
          const items = byStage.get(stage.value) ?? [];
          return (
            <section
              key={stage.value}
              aria-label={STAGE_LABELS[stage.value]}
              className="w-[85vw] max-w-72 shrink-0 snap-start sm:w-72"
            >
              <div className="mb-2 flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold leading-tight">
                    {STAGE_LABELS[stage.value]}
                  </span>
                </div>
                <span className="rounded-full bg-background px-2 text-xs font-medium">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((p) => (
                  <ProjectBoardCard key={p.id} project={p} showCoordinator={isAdmin} />
                ))}
                {items.length === 0 && (
                  <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                    Empty
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
