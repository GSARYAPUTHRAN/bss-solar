import type { NotificationEvent } from "./notifications";
import type { MilestoneStatus, ProjectStage } from "@/lib/types";

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
 * The completion instant a record should carry. A record that was already
 * completed keeps its original instant: re-saving a milestone note must not
 * move it, and a project's `completed_at` is what stops the feasibility clock.
 */
export function completionStamp(
  previous: string | null,
  completed: boolean,
  now: string,
): string | null {
  if (!completed) return null;
  return previous ?? now;
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
  project: { id: string; coordinatorId: string; clientName: string };
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
    coordinatorId: project.coordinatorId,
    projectId: project.id,
    clientName: project.clientName,
  };
  if (change.commissioned) {
    return [{ ...base, type: "project.commissioned" }];
  }
  if (change.completedStage) {
    return [
      { ...base, type: "project.milestone_completed", stage: change.completedStage },
    ];
  }
  return [];
}
