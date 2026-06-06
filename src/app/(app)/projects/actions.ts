"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import type { MilestoneStatus, ProjectMilestone, ProjectStage } from "@/lib/types";

async function recomputeProjectStage(projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_milestones")
    .select("stage, sort_order, status")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  const milestones = (data as Pick<
    ProjectMilestone,
    "stage" | "sort_order" | "status"
  >[]) ?? [];

  if (milestones.length === 0) return;

  const allCompleted = milestones.every((m) => m.status === "completed");

  // Current stage = furthest milestone that has been started (in_progress/completed),
  // falling back to the first stage if nothing has started yet.
  const started = milestones.filter((m) => m.status !== "pending");
  let currentStage: ProjectStage;
  if (allCompleted) {
    currentStage = milestones[milestones.length - 1].stage;
  } else if (started.length > 0) {
    currentStage = started[started.length - 1].stage;
  } else {
    currentStage = milestones[0].stage;
  }

  await supabase
    .from("projects")
    .update({
      current_stage: currentStage,
      is_completed: allCompleted,
      completed_at: allCompleted ? new Date().toISOString() : null,
    })
    .eq("id", projectId);
}

export async function updateMilestone(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/projects");
  const supabase = await createClient();

  const projectId = String(formData.get("project_id") ?? "");
  const milestoneId = String(formData.get("milestone_id") ?? "");
  const status = String(formData.get("status") ?? "pending") as MilestoneStatus;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { error } = await supabase
    .from("project_milestones")
    .update({
      status,
      notes,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", milestoneId);

  if (error) {
    redirect(`/projects/${projectId}?error=${encodeURIComponent(error.message)}`);
  }

  await recomputeProjectStage(projectId);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

/** Advance a project by completing its current (first non-completed) milestone. */
export async function advanceProject(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/projects");
  const supabase = await createClient();
  const projectId = String(formData.get("project_id") ?? "");

  const { data } = await supabase
    .from("project_milestones")
    .select("id, sort_order, status")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  const milestones =
    (data as Pick<ProjectMilestone, "id" | "sort_order" | "status">[]) ?? [];
  const next = milestones.find((m) => m.status !== "completed");

  if (next) {
    await supabase
      .from("project_milestones")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", next.id);
    await recomputeProjectStage(projectId);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
