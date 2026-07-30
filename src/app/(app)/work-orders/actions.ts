"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requireAdmin,
  requireProfile,
  requireSuperAdmin,
} from "@/lib/auth";
import { projectsRepository, workOrdersRepository } from "@/server/data";
import type { WorkOrderPatch } from "@/server/data";
import { dec, num, str, text } from "@/server/form";
import { todayISO } from "@/lib/format";
import { withFlash } from "@/lib/flash";
import { isOfficeRole } from "@/lib/domain/role";

/**
 * Parse the shared work-order body from a form. Returns the patch, or a message
 * when a required field is missing/invalid (money is rejected rather than
 * silently coerced to 0).
 */
function parseWorkOrderForm(
  formData: FormData,
): { patch: WorkOrderPatch } | { error: string } {
  const clientName = text(formData.get("client_name"));
  const plantCapacity = text(formData.get("plant_capacity"));
  const totalCost = dec(formData.get("total_cost"));

  if (!clientName || !plantCapacity || totalCost === null || totalCost < 0) {
    return {
      error: "Client name, plant capacity and a valid total cost are required.",
    };
  }

  return {
    patch: {
      client_name: clientName,
      client_phone: str(formData.get("client_phone")),
      address: str(formData.get("address")),
      plant_capacity: plantCapacity,
      advance_amount: num(formData.get("advance_amount")),
      total_cost: totalCost,
      order_date: text(formData.get("order_date")) || todayISO(),
      consumer_number: str(formData.get("consumer_number")),
      notes: str(formData.get("notes")),
      kseb_section: str(formData.get("kseb_section")),
      loan_bank_name: str(formData.get("loan_bank_name")),
      first_payment_date: str(formData.get("first_payment_date")),
      first_payment_amount: dec(formData.get("first_payment_amount")),
      second_payment_date: str(formData.get("second_payment_date")),
      second_payment_amount: dec(formData.get("second_payment_amount")),
    },
  };
}

export async function createWorkOrder(formData: FormData) {
  const profile = await requireProfile();

  const parsed = parseWorkOrderForm(formData);
  if ("error" in parsed) {
    redirect(`/work-orders/new?error=${encodeURIComponent(parsed.error)}`);
  }

  // Admins may log on behalf of a coordinator; coordinators log for themselves.
  const selectedCoordinator = str(formData.get("coordinator_id"));
  const coordinatorId =
    isOfficeRole(profile.role) && selectedCoordinator
      ? selectedCoordinator
      : profile.id;

  const { error } = await workOrdersRepository.create({
    ...parsed.patch,
    coordinator_id: coordinatorId,
  });

  if (error) redirect(`/work-orders/new?error=${encodeURIComponent(error)}`);

  revalidatePath("/work-orders");
  redirect(withFlash("/work-orders", "Work order created."));
}

/**
 * Edit the details of an existing work order. Open to the owning coordinator as
 * well as the office: RLS scopes the row to its owner, and a DB trigger keeps
 * `status`/`coordinator_id` admin-only, so a coordinator can never approve or
 * reassign through this path.
 *
 * A project reads its client, capacity, financials and KSEB details straight
 * from the work order (live joins, nothing denormalised), so an edit here is
 * immediately visible on the project — the project routes are revalidated so no
 * stale render survives the save.
 */
export async function updateWorkOrder(formData: FormData) {
  await requireProfile();
  const id = text(formData.get("id"));

  const parsed = parseWorkOrderForm(formData);
  if ("error" in parsed) {
    redirect(
      `/work-orders/${id}/edit?error=${encodeURIComponent(parsed.error)}`,
    );
  }

  const { error } = await workOrdersRepository.update(id, parsed.patch);
  if (error) {
    redirect(`/work-orders/${id}/edit?error=${encodeURIComponent(error)}`);
  }

  const projectId = (await workOrdersRepository.byId(id))?.project?.id;

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");

  redirect(withFlash(`/work-orders/${id}`, "Work order updated."));
}

export async function approveWorkOrder(formData: FormData) {
  await requireAdmin();
  const id = text(formData.get("id"));

  const wo = await workOrdersRepository.byId(id);
  if (!wo) {
    redirect(
      `/work-orders/${id}?error=${encodeURIComponent("Work order not found")}`,
    );
  }

  const statusRes = await workOrdersRepository.setStatus(id, "approved");
  if (statusRes.error) {
    redirect(`/work-orders/${id}?error=${encodeURIComponent(statusRes.error)}`);
  }

  // Create the active project (a DB trigger seeds the 9 milestones).
  // Guard against duplicates if approve is pressed twice.
  if (!(await projectsRepository.existsForWorkOrder(id))) {
    const projRes = await projectsRepository.createForWorkOrder(
      wo.id,
      wo.coordinator_id,
    );
    if (projRes.error) {
      redirect(`/work-orders/${id}?error=${encodeURIComponent(projRes.error)}`);
    }
  }

  revalidatePath("/work-orders");
  revalidatePath("/projects");
  revalidatePath(`/work-orders/${id}`);
  redirect(withFlash(`/work-orders/${id}`, "Work order approved — project created."));
}

export async function rejectWorkOrder(formData: FormData) {
  await requireAdmin();
  const id = text(formData.get("id"));

  const { error } = await workOrdersRepository.setStatus(id, "rejected");
  if (error) redirect(`/work-orders/${id}?error=${encodeURIComponent(error)}`);

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${id}`);
  redirect(withFlash(`/work-orders/${id}`, "Work order rejected."));
}

/** Destructive — SuperAdmin only. Cascades to the project and its milestones. */
export async function deleteWorkOrder(formData: FormData) {
  await requireSuperAdmin();
  const id = text(formData.get("id"));

  const { error } = await workOrdersRepository.remove(id);
  if (error) redirect(`/work-orders/${id}?error=${encodeURIComponent(error)}`);

  revalidatePath("/work-orders");
  revalidatePath("/projects");
  revalidatePath("/");
  redirect(withFlash("/work-orders", "Work order deleted."));
}
