"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { projectsRepository } from "@/server/data";
import { enumValue, str, text } from "@/server/form";
import type { MilestoneStatus, ProjectStage } from "@/lib/types";

/** Recompute a project's current stage + completion from its milestones. */
async function recomputeProjectStage(projectId: string) {
  const milestones = await projectsRepository.milestones(projectId);
  if (milestones.length === 0) return;

  const allCompleted = milestones.every((m) => m.status === "completed");
  const started = milestones.filter((m) => m.status !== "pending");

  let currentStage: ProjectStage;
  if (allCompleted) {
    currentStage = milestones[milestones.length - 1].stage;
  } else if (started.length > 0) {
    currentStage = started[started.length - 1].stage;
  } else {
    currentStage = milestones[0].stage;
  }

  await projectsRepository.setProgress(projectId, {
    current_stage: currentStage,
    is_completed: allCompleted,
    completed_at: allCompleted ? new Date().toISOString() : null,
  });
}

export async function updateMilestone(formData: FormData) {
  await requireAdmin();

  const projectId = text(formData.get("project_id"));
  const milestoneId = text(formData.get("milestone_id"));
  const status = enumValue<MilestoneStatus>(formData.get("status"), "pending");
  const notes = str(formData.get("notes"));

  const { error } = await projectsRepository.updateMilestone(milestoneId, {
    status,
    notes,
    completed_at: status === "completed" ? new Date().toISOString() : null,
  });

  if (error) redirect(`/projects/${projectId}?error=${encodeURIComponent(error)}`);

  await recomputeProjectStage(projectId);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

/** Advance a project by completing its first non-completed milestone. */
export async function advanceProject(formData: FormData) {
  await requireAdmin();
  const projectId = text(formData.get("project_id"));

  const milestones = await projectsRepository.milestones(projectId);
  const next = milestones.find((m) => m.status !== "completed");

  if (next) {
    await projectsRepository.updateMilestone(next.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    await recomputeProjectStage(projectId);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
