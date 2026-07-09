"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { projectsRepository, workOrdersRepository } from "@/server/data";
import { dec, num, str, text } from "@/server/form";
import { todayISO } from "@/lib/format";

export async function createWorkOrder(formData: FormData) {
  const profile = await requireProfile();

  const clientName = text(formData.get("client_name"));
  const plantCapacity = text(formData.get("plant_capacity"));
  // Required money field: reject invalid/missing rather than silently storing 0.
  const totalCost = dec(formData.get("total_cost"));

  const missing =
    !clientName || !plantCapacity || totalCost === null || totalCost < 0;
  if (missing) {
    redirect(
      `/work-orders/new?error=${encodeURIComponent(
        "Client name, plant capacity and a valid total cost are required.",
      )}`,
    );
  }

  // Admins may log on behalf of a coordinator; coordinators log for themselves.
  const selectedCoordinator = str(formData.get("coordinator_id"));
  const coordinatorId =
    profile.role === "admin" && selectedCoordinator
      ? selectedCoordinator
      : profile.id;

  const { error } = await workOrdersRepository.create({
    coordinator_id: coordinatorId,
    client_name: clientName,
    client_phone: str(formData.get("client_phone")),
    address: str(formData.get("address")),
    plant_capacity: plantCapacity,
    advance_amount: num(formData.get("advance_amount")),
    total_cost: totalCost as number,
    order_date: text(formData.get("order_date")) || todayISO(),
  });

  if (error) redirect(`/work-orders/new?error=${encodeURIComponent(error)}`);

  revalidatePath("/work-orders");
  redirect("/work-orders");
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
  redirect(`/work-orders/${id}`);
}

export async function rejectWorkOrder(formData: FormData) {
  await requireAdmin();
  const id = text(formData.get("id"));

  const { error } = await workOrdersRepository.setStatus(id, "rejected");
  if (error) redirect(`/work-orders/${id}?error=${encodeURIComponent(error)}`);

  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${id}`);
  redirect(`/work-orders/${id}`);
}

export async function deleteWorkOrder(formData: FormData) {
  await requireAdmin();
  const id = text(formData.get("id"));

  const { error } = await workOrdersRepository.remove(id);
  if (error) redirect(`/work-orders/${id}?error=${encodeURIComponent(error)}`);

  revalidatePath("/work-orders");
  redirect("/work-orders");
}
