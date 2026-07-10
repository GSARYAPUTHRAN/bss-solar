"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { projectsRepository } from "@/server/data";
import { deriveProjectStage } from "@/lib/domain/project";
import { enumValue, str, text } from "@/server/form";
import type { MilestoneStatus } from "@/lib/types";

/** Recompute a project's current stage + completion from its milestones. */
async function recomputeProjectStage(projectId: string) {
  const milestones = await projectsRepository.milestones(projectId);
  const derived = deriveProjectStage(milestones);
  if (!derived) return;

  await projectsRepository.setProgress(projectId, {
    current_stage: derived.currentStage,
    is_completed: derived.isCompleted,
    completed_at: derived.isCompleted ? new Date().toISOString() : null,
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
