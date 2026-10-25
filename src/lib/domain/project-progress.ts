import type { NotificationEvent } from "./notifications";
import type { MilestoneStatus, PlanType, ProjectStage } from "@/lib/types";

/**
 * What a milestone change implies beyond the milestone itself — decided here,
 * purely, so the server actions only carry it out:
 *   - completion timestamps that survive re-saves;
 *   - the feasibility date captured when KSEB clears the feasibility;
 *   - which notifications the change announces.
 */

/** Completing this milestone means KSEB has issued the feasibility. */
export const FEASIBILITY_CAPTURE_STAGE: ProjectStage = "kseb_feasibility_clearance";

/**
 * The completion instant a record should carry: `now` only on a real transition
 * into completed. A record that was already completed keeps exactly what it
 * had — its original instant, or none. Re-saving a milestone note must not move
 * the instant (a project's `completed_at` is what stops the feasibility clock),
 * and must not invent one: an imported commissioned project is completed with
 * the date "not recorded" (the import never invents dates), and saving a note
 * on it must not turn that into the day of the edit.
 */
export function completionStamp(input: {
  /** Whether the record was completed before this change. */
  wasCompleted: boolean;
  /** The instant it carried before (null when none was recorded). */
  previous: string | null;
  /** Whether it is completed after this change. */
  completed: boolean;
  now: string;
}): string | null {
  if (!input.completed) return null;
  return input.wasCompleted ? input.previous : input.now;
}

export function isNewlyCompleted(
  before: MilestoneStatus,
  after: MilestoneStatus,
): boolean {
  return before !== "completed" && after === "completed";
}

/**
 * Whether a milestone change should stamp the project's feasibility date: only
 * the feasibility-clearance milestone, only at the moment it is completed, and
 * never over a date the office has already entered.
 */
export function shouldCaptureFeasibility(input: {
  stage: ProjectStage;
  newlyCompleted: boolean;
  feasibilityDate: string | null;
}): boolean {
  return (
    input.stage === FEASIBILITY_CAPTURE_STAGE &&
    input.newlyCompleted &&
    !input.feasibilityDate
  );
}

export interface ProgressChange {
  actorId: string;
  /** `coordinatorIds`: everyone on the sale; `planType` words the finish ("handed over"). */
  project: {
    id: string;
    coordinatorIds: readonly string[];
    clientName: string;
    planType: PlanType;
  };
  /** The stage whose milestone was just completed, or null. */
  completedStage: ProjectStage | null;
  /** The project has just become commissioned (was not before). */
  commissioned: boolean;
}

/**
 * The notifications a progress change announces. Commissioning supersedes the
 * final milestone's own notice, so one click never tells the coordinator the
 * same news twice.
 */
export function progressEvents(change: ProgressChange): NotificationEvent[] {
  const { actorId, project } = change;
  const base = {
    actorId,
    coordinatorIds: project.coordinatorIds,
    projectId: project.id,
    clientName: project.clientName,
  };
  if (change.commissioned) {
    return [{ ...base, type: "project.commissioned", planType: project.planType }];
  }
  if (change.completedStage) {
    return [
      { ...base, type: "project.milestone_completed", stage: change.completedStage },
    ];
  }
  return [];
}
