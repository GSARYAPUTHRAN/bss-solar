import { PROJECT_STAGES } from "@/lib/constants";
import type { MilestoneStatus, ProjectStage } from "@/lib/types";

export interface StageMilestone {
  stage: ProjectStage;
  sort_order: number;
  status: MilestoneStatus;
}

/**
 * Derive a project's current stage + completion from its milestones.
 *
 * The "current stage" is the first milestone that is not yet completed (the
 * ACTIVE stage), in sort order — not the furthest-touched one. This keeps the
 * kanban column and the stage summary aligned with real progress and matches
 * how advanceProject completes milestones front-to-back. Returns null for an
 * empty milestone set so callers can no-op.
 */
export function deriveProjectStage(
  milestones: StageMilestone[],
): { currentStage: ProjectStage; isCompleted: boolean } | null {
  if (milestones.length === 0) return null;
  const sorted = [...milestones].sort((a, b) => a.sort_order - b.sort_order);

  const active = sorted.find((m) => m.status !== "completed");
  if (!active) {
    return { currentStage: sorted[sorted.length - 1].stage, isCompleted: true };
  }
  return { currentStage: active.stage, isCompleted: false };
}

/** Milestone completion progress for a project (used by list, board, detail). */
export function projectProgress(project: {
  milestones?: { status: MilestoneStatus }[] | null;
}): { done: number; total: number; pct: number } {
  const ms = project.milestones ?? [];
  const total = ms.length || PROJECT_STAGES.length;
  const done = ms.filter((m) => m.status === "completed").length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
