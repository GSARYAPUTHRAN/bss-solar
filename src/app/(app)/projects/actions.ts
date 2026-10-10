"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { projectsRepository, workOrdersRepository } from "@/server/data";
import type {
  MilestoneSlice,
  ProjectBrief,
} from "@/server/data/projects.repository";
import { notify } from "@/server/notifications";
import { deriveProjectStage } from "@/lib/domain/project";
import {
  completionStamp,
  isNewlyCompleted,
  progressEvents,
  shouldCaptureFeasibility,
} from "@/lib/domain/project-progress";
import {
  incentiveChanged,
  parseProjectSettings,
} from "@/lib/domain/project-settings";
import { MILESTONE_STATUS } from "@/lib/domain/status";
import { str, text } from "@/server/form";
import { withFlash } from "@/lib/flash";
import { todayISO } from "@/lib/format";
import type { MilestoneStatus, Profile } from "@/lib/types";

/** Bounce back to `path` with an inline error banner. */
function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function projectPath(id: string): string {
  return `/projects/${id}`;
}

function revalidateProject(id: string) {
  revalidatePath(projectPath(id));
  revalidatePath("/projects");
  // Dashboard KPIs (commissioned, feasibility, incentives) read projects too.
  revalidatePath("/");
}

async function loadProject(id: string): Promise<ProjectBrief> {
  const project = id ? await projectsRepository.brief(id) : null;
  if (!project) failTo("/projects", "Project not found.");
  return project;
}

function isMilestoneStatus(value: string): value is MilestoneStatus {
  return Object.hasOwn(MILESTONE_STATUS, value);
}

/**
 * Everything that follows a milestone change: the project's stage and
 * completion are recomputed, the feasibility date is captured when KSEB clears
 * it, and the coordinator is notified. Runs after the milestone is saved.
 */
async function afterMilestoneChange(
  actor: Profile,
  project: ProjectBrief,
  milestone: MilestoneSlice,
  nextStatus: MilestoneStatus,
): Promise<{ error: string | null }> {
  const newlyCompleted = isNewlyCompleted(milestone.status, nextStatus);

  const derived = deriveProjectStage(await projectsRepository.milestones(project.id));
  let commissioned = false;
  if (derived) {
    const { error } = await projectsRepository.setProgress(project.id, {
      current_stage: derived.currentStage,
      is_completed: derived.isCompleted,
      completed_at: completionStamp(
        project.completed_at,
        derived.isCompleted,
        new Date().toISOString(),
      ),
    });
    if (error) return { error };
    commissioned = derived.isCompleted && !project.is_completed;
  }

  // Completing "KSEB Feasibility Clearance" means KSEB issued the feasibility
  // today, which starts its 30-day validity clock. Captured automatically so
  // the clock is never forgotten; the office can correct it in Project settings.
  if (
    shouldCaptureFeasibility({
      stage: milestone.stage,
      newlyCompleted,
      feasibilityDate: project.feasibility_date,
    })
  ) {
    const { error } = await projectsRepository.captureFeasibilityDate(
      project.id,
      todayISO(),
    );
    if (error) return { error: `Milestone saved, but the feasibility date was not: ${error}` };
  }

  notify(
    ...progressEvents({
      actorId: actor.id,
      project: {
        id: project.id,
        coordinatorId: project.coordinator_id,
        clientName: project.client_name,
      },
      completedStage: newlyCompleted ? milestone.stage : null,
      commissioned,
    }),
  );
  return { error: null };
}

export async function updateMilestone(formData: FormData) {
  const actor = await requireAdmin();

  const projectId = text(formData.get("project_id"));
  const milestoneId = text(formData.get("milestone_id"));
  const status = text(formData.get("status"));
  const notes = str(formData.get("notes"));
  const back = projectPath(projectId);

  if (!isMilestoneStatus(status)) failTo(back, "Choose a valid milestone status.");

  const project = await loadProject(projectId);
  const milestone = (await projectsRepository.milestones(project.id)).find(
    (m) => m.id === milestoneId,
  );
  if (!milestone) failTo(back, "That milestone does not belong to this project.");

  const { error } = await projectsRepository.updateMilestone(milestone.id, {
    status,
    notes,
    completed_at: completionStamp(
      milestone.completed_at,
      status === "completed",
      new Date().toISOString(),
    ),
  });
  if (error) failTo(back, error);

  const after = await afterMilestoneChange(actor, project, milestone, status);
  revalidateProject(project.id);
  if (after.error) failTo(back, after.error);
  redirect(back);
}

/** Advance a project by completing its first non-completed milestone. */
export async function advanceProject(formData: FormData) {
  const actor = await requireAdmin();
  const project = await loadProject(text(formData.get("project_id")));
  const back = projectPath(project.id);

  const next = (await projectsRepository.milestones(project.id)).find(
    (m) => m.status !== "completed",
  );
  if (!next) redirect(back);

  const { error } = await projectsRepository.updateMilestone(next.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
  });
  if (error) failTo(back, error);

  const after = await afterMilestoneChange(actor, project, next, "completed");
  revalidateProject(project.id);
  if (after.error) failTo(back, after.error);
  redirect(back);
}

/**
 * Office-maintained project facts: the KSEB feasibility date and the
 * coordinator's incentive (amount + when it was paid). The coordinator is told
 * whenever their incentive changes.
 */
export async function updateProjectSettings(formData: FormData) {
  const actor = await requireAdmin();
  const project = await loadProject(text(formData.get("project_id")));
  const back = projectPath(project.id);

  const parsed = parseProjectSettings(
    {
      feasibilityDate: str(formData.get("feasibility_date")),
      incentive: str(formData.get("coordinator_incentive")),
      incentivePaidOn: str(formData.get("incentive_paid_on")),
    },
    todayISO(),
  );
  if (!parsed.ok) failTo(back, parsed.error);
  const settings = parsed.data;

  const { error } = await projectsRepository.updateSettings(project.id, settings);
  if (error) failTo(back, error);

  if (incentiveChanged(project, settings)) {
    notify({
      type: "incentive.updated",
      actorId: actor.id,
      coordinatorId: project.coordinator_id,
      projectId: project.id,
      clientName: project.client_name,
      amount: settings.coordinator_incentive,
      paidOn: settings.incentive_paid_on,
    });
  }

  revalidateProject(project.id);
  redirect(withFlash(back, "Project settings saved."));
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
  const project = await loadProject(text(formData.get("project_id")));

  const { error } = await projectsRepository.remove(project.id);
  if (error) failTo(projectPath(project.id), error);

  const reverted = await workOrdersRepository.setStatus(
    project.work_order_id,
    "pending",
  );
  if (reverted.error) {
    failTo(
      `/work-orders/${project.work_order_id}`,
      `Project deleted, but the work order could not be returned to pending: ${reverted.error}`,
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
