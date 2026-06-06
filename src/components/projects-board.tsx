"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_STAGES, STAGE_LABELS } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";
import type { Project, ProjectStage } from "@/lib/types";

interface Coordinator {
  id: string;
  full_name: string;
}

function progressOf(p: Project) {
  const ms = p.milestones ?? [];
  const total = ms.length || PROJECT_STAGES.length;
  const done = ms.filter((m) => m.status === "completed").length;
  return { done, total, pct: Math.round((done / total) * 100) };
}

export function ProjectsBoard({
  projects,
  coordinators,
  isAdmin,
}: {
  projects: Project[];
  coordinators: Coordinator[];
  isAdmin: boolean;
}) {
  const [coordinator, setCoordinator] = useState("all");
  const [showCompleted, setShowCompleted] = useState("active");

  const filtered = useMemo(() => {
    let rows = [...projects];
    if (coordinator !== "all")
      rows = rows.filter((p) => p.coordinator_id === coordinator);
    if (showCompleted === "active") rows = rows.filter((p) => !p.is_completed);
    if (showCompleted === "completed")
      rows = rows.filter((p) => p.is_completed);
    return rows;
  }, [projects, coordinator, showCompleted]);

  const byStage = useMemo(() => {
    const map = new Map<ProjectStage, Project[]>();
    PROJECT_STAGES.forEach((s) => map.set(s.value, []));
    filtered.forEach((p) => {
      map.get(p.current_stage)?.push(p);
    });
    return map;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={showCompleted} onValueChange={setShowCompleted}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active projects</SelectItem>
            <SelectItem value="completed">Commissioned</SelectItem>
            <SelectItem value="all">All projects</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && (
          <Select value={coordinator} onValueChange={setCoordinator}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder="Coordinator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All coordinators</SelectItem>
              {coordinators.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground sm:ml-auto">
          {filtered.length} projects
        </p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {PROJECT_STAGES.map((stage, idx) => {
          const items = byStage.get(stage.value) ?? [];
          return (
            <div key={stage.value} className="w-72 shrink-0">
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
                {items.map((p) => {
                  const prog = progressOf(p);
                  return (
                    <Link key={p.id} href={`/projects/${p.id}`}>
                      <Card className="gap-2 p-3 transition-colors hover:border-amber-400">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">
                            {p.work_order?.client_name ?? "Project"}
                          </p>
                          {p.is_completed && (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {p.work_order?.plant_capacity} ·{" "}
                          {formatCurrency(p.work_order?.total_cost)}
                        </p>
                        {isAdmin && (
                          <p className="text-xs text-muted-foreground">
                            {p.coordinator?.full_name}
                          </p>
                        )}
                        <div className="mt-1">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-amber-500"
                              style={{ width: `${prog.pct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {prog.done}/{prog.total} milestones
                          </p>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
                {items.length === 0 && (
                  <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                    Empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
