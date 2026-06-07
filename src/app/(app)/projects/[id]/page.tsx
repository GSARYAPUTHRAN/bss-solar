import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Clock,
  FastForward,
  Plus,
  Wrench,
} from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { projectsRepository, ticketsRepository } from "@/server/data";
import { updateMilestone, advanceProject } from "../actions";
import { Page, PageHeader, Section, EmptyState, FormError } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FormSelect } from "@/components/form-select";
import { TicketStatusBadge } from "@/components/status-badges";
import {
  MILESTONE_STATUS_LABELS,
  STAGE_LABELS,
  TICKET_TYPE_LABELS,
} from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import type { MilestoneStatus, ProjectMilestone } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<MilestoneStatus, React.ReactNode> = {
  completed: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
  in_progress: <Clock className="h-5 w-5 text-amber-600" />,
  pending: <Circle className="h-5 w-5 text-muted-foreground" />,
};

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireProfile();
  const { id } = await params;
  const { error } = await searchParams;
  const isAdmin = profile.role === "admin";

  const project = await projectsRepository.byId(id);
  if (!project) notFound();

  const milestones = (project.milestones ?? []).sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const doneCount = milestones.filter((m) => m.status === "completed").length;

  const tickets = isAdmin
    ? await ticketsRepository.listByProject(id)
    : [];
  const wo = project.work_order;

  return (
    <Page size="wide">
      <PageHeader
        title={wo?.client_name ?? "Project"}
        description={`${wo?.plant_capacity ?? ""} · Started ${formatDate(project.started_at)}`}
        backHref="/projects"
      />

      <FormError message={error} />

      <div className="grid gap-4 md:grid-cols-3">
        <Section
          title="Project Summary"
          className="md:col-span-1"
          contentClassName="space-y-3 text-sm"
        >
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              {project.is_completed ? (
                <Badge className="border-transparent bg-emerald-100 text-emerald-800">
                  Commissioned
                </Badge>
              ) : (
                <Badge variant="secondary">In Progress</Badge>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current stage</span>
              <span className="text-right font-medium">
                {STAGE_LABELS[project.current_stage]}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">
                {doneCount}/{milestones.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Coordinator</span>
              <span className="font-medium">{project.coordinator?.full_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-medium">{wo?.client_phone ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total cost</span>
              <span className="font-medium">{formatCurrency(wo?.total_cost)}</span>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">{wo?.address}</p>

            {isAdmin && !project.is_completed && (
              <form action={advanceProject} className="pt-2">
                <input type="hidden" name="project_id" value={project.id} />
                <SubmitButton variant="outline" className="w-full" loadingText="Updating…">
                  <FastForward className="mr-2 h-4 w-4" /> Complete Next Milestone
                </SubmitButton>
              </form>
            )}
        </Section>

        <Section title="KSEB / ANERT Milestones" className="md:col-span-2">
            <ol className="space-y-4">
              {milestones.map((m: ProjectMilestone, i) => (
                <li key={m.id} className="relative pl-8">
                  {i < milestones.length - 1 && (
                    <span className="absolute left-[9px] top-7 h-[calc(100%+4px)] w-px bg-border" />
                  )}
                  <span className="absolute left-0 top-0.5">
                    {STATUS_ICON[m.status]}
                  </span>
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          m.status === "completed" && "text-muted-foreground",
                        )}
                      >
                        {STAGE_LABELS[m.stage]}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-xs",
                          m.status === "completed" &&
                            "border-emerald-200 text-emerald-700",
                          m.status === "in_progress" &&
                            "border-amber-200 text-amber-700",
                        )}
                      >
                        {MILESTONE_STATUS_LABELS[m.status]}
                      </Badge>
                    </div>

                    {m.completed_at && (
                      <p className="text-xs text-muted-foreground">
                        Completed {formatDate(m.completed_at)}
                      </p>
                    )}

                    {isAdmin ? (
                      <form
                        action={updateMilestone}
                        className="mt-1 flex flex-col gap-2"
                      >
                        <input
                          type="hidden"
                          name="project_id"
                          value={project.id}
                        />
                        <input type="hidden" name="milestone_id" value={m.id} />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <FormSelect
                            name="status"
                            defaultValue={m.status}
                            className="w-full sm:w-44"
                            options={(
                              Object.keys(
                                MILESTONE_STATUS_LABELS,
                              ) as MilestoneStatus[]
                            ).map((s) => ({
                              value: s,
                              label: MILESTONE_STATUS_LABELS[s],
                            }))}
                          />
                          <Textarea
                            name="notes"
                            defaultValue={m.notes ?? ""}
                            placeholder="Notes…"
                            rows={1}
                            className="flex-1"
                          />
                          <SubmitButton size="sm" variant="secondary" loadingText="Saving…">
                            Save
                          </SubmitButton>
                        </div>
                      </form>
                    ) : (
                      m.notes && (
                        <p className="text-xs text-muted-foreground">{m.notes}</p>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ol>
        </Section>
      </div>

      {isAdmin && (
        <Section
          title="Service Tickets"
          actions={
            <Button size="sm" asChild>
              <Link href={`/tickets/new?project_id=${project.id}`}>
                <Plus className="mr-2 h-4 w-4" /> New Ticket
              </Link>
            </Button>
          }
        >
          {tickets.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No service tickets yet"
              description="Service tickets raised for this project will appear here."
            />
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => (
                <Link
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:border-primary/60 hover:bg-accent/50"
                >
                  <div className="flex items-center gap-3">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {t.ticket_no ?? t.id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {TICKET_TYPE_LABELS[t.ticket_type]} ·{" "}
                        {formatDate(t.scheduled_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{formatCurrency(t.total)}</span>
                    <TicketStatusBadge status={t.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>
      )}
    </Page>
  );
}
