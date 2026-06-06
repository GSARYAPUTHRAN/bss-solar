"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_STAGES, STAGE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Project, ProjectStage } from "@/lib/types";

interface Coordinator {
  id: string;
  full_name: string;
}

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
  const [stage, setStage] = useState("all");
  const [coordinator, setCoordinator] = useState("all");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    let rows = [...projects];
    if (stage !== "all") rows = rows.filter((p) => p.current_stage === stage);
    if (coordinator !== "all")
      rows = rows.filter((p) => p.coordinator_id === coordinator);
    rows.sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sortAsc ? da - db : db - da;
    });
    return rows;
  }, [projects, stage, coordinator, sortAsc]);

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Project stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {PROJECT_STAGES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
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
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              {isAdmin && <TableHead>Coordinator</TableHead>}
              <TableHead>Capacity</TableHead>
              <TableHead>Current Stage</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => setSortAsc((s) => !s)}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  Created <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 6 : 5}
                  className="h-24 text-center text-muted-foreground"
                >
                  No projects found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.work_order?.client_name ?? "Project"}
                    </Link>
                  </TableCell>
                  {isAdmin && (
                    <TableCell>{p.coordinator?.full_name ?? "—"}</TableCell>
                  )}
                  <TableCell>{p.work_order?.plant_capacity ?? "—"}</TableCell>
                  <TableCell>
                    {p.is_completed ? (
                      <Badge className="border-transparent bg-emerald-100 text-emerald-800">
                        Commissioned
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="font-normal">
                        {STAGE_LABELS[p.current_stage as ProjectStage]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{progress(p)}</TableCell>
                  <TableCell>{formatDate(p.created_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} of {projects.length} projects
      </p>
    </Card>
  );
}
