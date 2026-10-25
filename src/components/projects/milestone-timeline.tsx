import { CheckCircle2, Circle, Clock } from "lucide-react";
import { updateMilestone } from "@/app/(app)/projects/actions";
import { FormSelect } from "@/components/form-select";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { KSEB_FEES } from "@/lib/domain/kseb";
import { stageLabel } from "@/lib/domain/plan";
import { FEASIBILITY_CAPTURE_STAGE } from "@/lib/domain/project-progress";
import { MILESTONE_STATUS, statusOptions } from "@/lib/domain/status";
import { formatDate } from "@/lib/format";
import type { MilestoneStatus, PlanType, ProjectMilestone } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<MilestoneStatus, React.ReactNode> = {
  completed: (
    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
  ),
  in_progress: <Clock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden />,
  pending: <Circle className="h-5 w-5 text-muted-foreground" aria-hidden />,
};

const STATUS_OPTIONS = statusOptions(MILESTONE_STATUS);

/**
 * A project's milestones as a vertical timeline: the nine KSEB/ANERT steps of a
 * solar plant, or the single Handover step of a custom plan. Office staff update
 * each one in place; everyone else reads it. (A cancelled project's page passes
 * `canEdit={false}`: its milestones stay as they were until it is reinstated.)
 */
export function MilestoneTimeline({
  projectId,
  milestones,
  plan,
  canEdit,
  feasibilityCaptured,
}: {
  projectId: string;
  /** In sort order. */
  milestones: ProjectMilestone[];
  plan: PlanType;
  canEdit: boolean;
  /** A feasibility date is already recorded (so completing clearance keeps it). */
  feasibilityCaptured: boolean;
}) {
  return (
    <ol className="space-y-4">
      {milestones.map((m, i) => {
        const label = stageLabel(m.stage, plan);
        const meta = MILESTONE_STATUS[m.status];
        return (
          <li key={m.id} className="relative pl-8">
            {i < milestones.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[9px] top-7 h-[calc(100%+4px)] w-px bg-border"
              />
            )}
            <span className="absolute left-0 top-0.5">{STATUS_ICON[m.status]}</span>
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <p
                  className={cn(
                    "text-sm font-medium",
                    m.status === "completed" && "text-muted-foreground",
                  )}
                >
                  {label}
                </p>
                <Badge className={cn("shrink-0 border-transparent text-xs", meta.badgeClass)}>
                  {meta.label}
                </Badge>
              </div>

              {m.completed_at && (
                <p className="text-xs text-muted-foreground">
                  Completed {formatDate(m.completed_at)}
                </p>
              )}

              {canEdit ? (
                <form action={updateMilestone} className="mt-1 flex flex-col gap-2">
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="milestone_id" value={m.id} />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <FormSelect
                      name="status"
                      aria-label={`Status for ${label}`}
                      defaultValue={m.status}
                      className="w-full sm:w-44"
                      options={STATUS_OPTIONS}
                    />
                    <Textarea
                      name="notes"
                      aria-label={`Notes for ${label}`}
                      defaultValue={m.notes ?? ""}
                      placeholder="Notes…"
                      rows={1}
                      className="flex-1"
                    />
                    <SubmitButton size="sm" variant="secondary" loadingText="Saving…">
                      Save
                    </SubmitButton>
                  </div>
                  {m.stage === FEASIBILITY_CAPTURE_STAGE &&
                    m.status !== "completed" &&
                    !feasibilityCaptured && (
                      <p className="text-xs text-muted-foreground">
                        Completing this records today as the KSEB feasibility
                        date, which starts its {KSEB_FEES.feasibilityValidityDays}-day
                        validity.
                      </p>
                    )}
                </form>
              ) : (
                m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
