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
import {
  parseCancellation,
  parseRemarks,
  progressLockedReason,
} from "@/lib/domain/cancellation";
import { deriveProjectStage } from "@/lib/domain/project";
import {
  completionStamp,
  isNewlyCompleted,
  progressEvents,
  shouldCaptureFeasibility,
} from "@/lib/domain/project-progress";
import {
  CUSTOM_PLAN_FEASIBILITY_ERROR,
  feasibilityDateRefusal,
  hasUndatedCommissioning,
  incentiveChanged,
  parseFeasibilitySetting,
  parseIncentiveSetting,
  UNDATED_COMMISSIONING_FEASIBILITY_ERROR,
  unpaidIncentives,
} from "@/lib/domain/project-settings";
import { MILESTONE_STATUS } from "@/lib/domain/status";
import { str, text } from "@/server/form";
import { withFlash } from "@/lib/flash";
import { formatCurrency, formatDate, todayISO } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/result";
import type { MilestoneStatus, Profile } from "@/lib/types";

/**
 * Project lifecycle. Everything that changes a project is office-only (RLS says
 * the same independently; these guards make a refused write explainable).
 *
 * The milestone and settings forms redirect (inline `?error=` banner, flash
 * toast). The dialogs and per-person forms — cancel/refund, reinstate, one
 * coordinator's incentive — return a result instead, so a refusal stays inside
 * the form with what was typed (the payments ledger works the same way).
 */

/** `null` before the first submit. */
export type ProjectFormState = ActionResult<{ message: string }> | null;

const PROJECT_GONE = "Project not found — it may have been deleted.";

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

/** Cancelling or reinstating also changes the work order's page and list rows. */
function revalidateSale(project: Pick<ProjectBrief, "id" | "work_order_id">) {
  revalidateProject(project.id);
  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${project.work_order_id}`);
}

async function loadProject(id: string): Promise<ProjectBrief> {
  const project = id ? await projectsRepository.brief(id) : null;
  if (!project) failTo("/projects", "Project not found.");
  return project;
}

/** Everyone on the sale hears about it (the actor is dropped when delivering). */
function coordinatorIdsOf(project: ProjectBrief): string[] {
  return project.coordinators.map((c) => c.id);
}

function isMilestoneStatus(value: string): value is MilestoneStatus {
  return Object.hasOwn(MILESTONE_STATUS, value);
}

/**
 * Everything that follows a milestone change: the project's stage and
 * completion are recomputed, the feasibility date is captured when KSEB clears
 * it, and the sale's coordinators are notified. Runs after the milestone is
 * saved.
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
      completed_at: completionStamp({
        wasCompleted: project.is_completed,
        previous: project.completed_at,
        completed: derived.isCompleted,
        now: new Date().toISOString(),
      }),
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
        coordinatorIds: coordinatorIdsOf(project),
        clientName: project.client_name,
        planType: project.plan_type,
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
  const locked = progressLockedReason(project);
  if (locked) failTo(back, locked);

  const milestone = (await projectsRepository.milestones(project.id)).find(
    (m) => m.id === milestoneId,
  );
  if (!milestone) failTo(back, "That milestone does not belong to this project.");

  const { error } = await projectsRepository.updateMilestone(milestone.id, {
    status,
    notes,
    completed_at: completionStamp({
      wasCompleted: milestone.status === "completed",
      previous: milestone.completed_at,
      completed: status === "completed",
      now: new Date().toISOString(),
    }),
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

  const locked = progressLockedReason(project);
  if (locked) failTo(back, locked);

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
 * The KSEB feasibility date, the one project fact the office keeps here (each
 * coordinator's incentive has its own form — updateCoordinatorIncentive). A
 * custom plan has no KSEB process, so no date.
 */
export async function updateProjectSettings(formData: FormData) {
  await requireAdmin();
  const project = await loadProject(text(formData.get("project_id")));
  const back = projectPath(project.id);

  const parsed = parseFeasibilitySetting(str(formData.get("feasibility_date")), todayISO());
  if (!parsed.ok) failTo(back, parsed.error);
  const refusal = feasibilityDateRefusal(project, parsed.data);
  if (refusal) failTo(back, refusal);

  const { error } = await projectsRepository.setFeasibilityDate(project.id, parsed.data);
  if (error) failTo(back, error);

  revalidateProject(project.id);
  redirect(withFlash(back, "Project settings saved."));
}

/**
 * One coordinator's incentive on a sale: amount, and when it was paid. Private
 * to that person and the office. The coordinator is told whenever theirs
 * changes — clearing it included ("Incentive removed").
 */
export async function updateCoordinatorIncentive(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await requireAdmin();

  const project = await projectsRepository.brief(text(formData.get("project_id")));
  if (!project) return fail(PROJECT_GONE);

  const person = project.coordinators.find(
    (c) => c.id === text(formData.get("coordinator_id")),
  );
  if (!person) return fail("That person is not a coordinator on this project.");

  const parsed = parseIncentiveSetting(
    { amount: str(formData.get("amount")), paidOn: str(formData.get("paid_on")) },
    todayISO(),
  );
  if (!parsed.ok) return parsed;

  const { error } = await projectsRepository.setCoordinatorIncentive(
    project.work_order_id,
    person.id,
    parsed.data,
  );
  if (error) return fail(error);

  if (incentiveChanged(person.incentive ?? { amount: null, paid_on: null }, parsed.data)) {
    notify({
      type: "incentive.updated",
      actorId: actor.id,
      coordinatorId: person.id,
      projectId: project.id,
      clientName: project.client_name,
      amount: parsed.data.amount,
      paidOn: parsed.data.paid_on,
    });
  }

  revalidateProject(project.id);
  return ok({ message: `Incentive saved for ${person.full_name}.` });
}

/**
 * Mark a project cancelled or refunded, or correct that record (kind, date,
 * remarks). The ledger, milestones and incentives are left exactly as they are
 * — the office decides about money separately. Everyone on the sale hears when
 * the status itself changes.
 */
export async function setProjectCancellation(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await requireAdmin();

  const project = await projectsRepository.brief(text(formData.get("project_id")));
  if (!project) return fail(PROJECT_GONE);

  const parsed = parseCancellation(
    {
      cancellation: str(formData.get("cancellation")),
      cancelledOn: str(formData.get("cancelled_on")),
      remarks: str(formData.get("cancellation_remarks")),
    },
    {
      today: todayISO(),
      orderDate: project.order_date,
      hasFeasibilityDate: project.feasibility_date !== null,
      previous: {
        cancellation: project.cancellation,
        cancelled_on: project.cancelled_on,
      },
    },
  );
  if (!parsed.ok) return parsed;

  const { error } = await projectsRepository.setCancellation(project.id, parsed.data);
  if (error) return fail(error);

  const statusChanged = project.cancellation !== parsed.data.cancellation;
  if (statusChanged) {
    notify({
      type: "project.cancelled",
      actorId: actor.id,
      coordinatorIds: coordinatorIdsOf(project),
      projectId: project.id,
      clientName: project.client_name,
      cancellation: parsed.data.cancellation,
      remarks: parsed.data.cancellation_remarks,
    });
  }

  revalidateSale(project);
  if (!statusChanged) return ok({ message: "Cancellation details saved." });

  // Incentives are not touched; say so while the office is looking at them.
  const unpaid = unpaidIncentives(project.coordinators);
  return ok({
    message: `Project marked ${parsed.data.cancellation}.${
      unpaid.count > 0
        ? ` ${formatCurrency(unpaid.total)} of coordinator incentives is still unpaid — clear it if it is no longer due.`
        : ""
    }`,
  });
}

/**
 * Bring a cancelled or refunded project back into the pipeline at its current
 * stage. The remarks stay (editable) as the history note. Reopening the clock on
 * the old feasibility date counts the whole cancelled stretch as renewals, so
 * the office may enter a fresh date in the same step (one update — the clock
 * never runs on the old date in between). A custom plan has no such date, nor
 * does a project commissioned on a day that was never recorded.
 */
export async function reinstateProject(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const actor = await requireAdmin();

  const project = await projectsRepository.brief(text(formData.get("project_id")));
  if (!project) return fail(PROJECT_GONE);
  const previous = project.cancellation;
  if (!previous) return fail("This project is not cancelled.");

  const remarks = parseRemarks(str(formData.get("cancellation_remarks")));
  if (!remarks.ok) return remarks;

  let feasibilityDate: string | undefined;
  const typed = str(formData.get("feasibility_date"));
  if (typed !== null) {
    if (project.plan_type === "custom") return fail(CUSTOM_PLAN_FEASIBILITY_ERROR);
    const date = parseFeasibilitySetting(typed, todayISO());
    if (!date.ok) return date;
    // Reopening clears the cancellation, so a commissioning date that was never
    // recorded would leave the new clock running to today.
    if (date.data !== null && hasUndatedCommissioning(project)) {
      return fail(UNDATED_COMMISSIONING_FEASIBILITY_ERROR);
    }
    if (date.data !== null && date.data < project.order_date) {
      return fail(
        `The new feasibility date cannot be before the order date (${project.order_date}).`,
      );
    }
    feasibilityDate = date.data ?? undefined;
  }

  const { error } = await projectsRepository.reinstate(project.id, {
    remarks: remarks.data,
    ...(feasibilityDate ? { feasibility_date: feasibilityDate } : {}),
  });
  if (error) return fail(error);

  notify({
    type: "project.reinstated",
    actorId: actor.id,
    coordinatorIds: coordinatorIdsOf(project),
    projectId: project.id,
    clientName: project.client_name,
    previous,
  });

  revalidateSale(project);
  return ok({
    message: `Project reinstated — it is back in the active pipeline.${
      feasibilityDate ? ` New feasibility date ${formatDate(feasibilityDate)}.` : ""
    }`,
  });
}

/**
 * Destructive — SuperAdmin only. Removes the project and its milestones; service
 * tickets keep their history with a null project.
 *
 * The backing work order is returned to `pending` so the schema invariant
 * "approved work order ⇒ has a project" holds. Re-approving it rebuilds a fresh
 * project with its milestones.
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
