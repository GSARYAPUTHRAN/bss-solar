"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { projectsRepository, workOrdersRepository } from "@/server/data";
import { deriveProjectStage } from "@/lib/domain/project";
import { enumValue, str, text } from "@/server/form";
import { withFlash } from "@/lib/flash";
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

/**
 * Destructive — SuperAdmin only. Removes the project and its milestones; service
 * tickets keep their history with a null project.
 *
 * The backing work order is returned to `pending` so the schema invariant
 * "approved work order ⇒ has a project" holds. Re-approving it rebuilds a fresh
 * project with the 9 milestones.
 */
export async function deleteProject(formData: FormData) {
  await requireSuperAdmin();
  const projectId = text(formData.get("project_id"));

  const project = await projectsRepository.byId(projectId);
  if (!project) {
    redirect(
      `/projects?error=${encodeURIComponent("Project not found")}`,
    );
  }

  const { error } = await projectsRepository.remove(projectId);
  if (error) {
    redirect(`/projects/${projectId}?error=${encodeURIComponent(error)}`);
  }

  const reverted = await workOrdersRepository.setStatus(
    project.work_order_id,
    "pending",
  );
  if (reverted.error) {
    redirect(
      `/work-orders/${project.work_order_id}?error=${encodeURIComponent(
        `Project deleted, but the work order could not be returned to pending: ${reverted.error}`,
      )}`,
    );
  }

  revalidatePath("/projects");
  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${project.work_order_id}`);
  revalidatePath("/");
  redirect(
    withFlash("/projects", "Project deleted — its work order is pending again."),
  );
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
