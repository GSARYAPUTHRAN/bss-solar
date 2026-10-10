"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requireAdmin,
  requireSuperAdmin,
  requireWorkOrderRole,
} from "@/lib/auth";
import {
  loadContract,
  projectsRepository,
  workOrdersRepository,
} from "@/server/data";
import { text, str } from "@/server/form";
import { checkContractTerms } from "@/server/forms/payment";
import { parseWorkOrderForm } from "@/server/forms/work-order";
import { notify } from "@/server/notifications";
import { todayISO } from "@/lib/format";
import { withFlash } from "@/lib/flash";
import { canEditContractTerms } from "@/lib/domain/payment";
import { isOfficeRole } from "@/lib/domain/role";

function withError(path: string, message: string): string {
  return `${path}?error=${encodeURIComponent(message)}`;
}

/** Every list/detail that renders a work order's figures. */
function revalidateWorkOrder(id: string, projectId?: string | null) {
  revalidatePath("/work-orders");
  revalidatePath(`/work-orders/${id}`);
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

export async function createWorkOrder(formData: FormData) {
  const profile = await requireWorkOrderRole();

  const parsed = parseWorkOrderForm(formData, todayISO());
  if (!parsed.ok) redirect(withError("/work-orders/new", parsed.error));

  // The office may log on behalf of a coordinator; coordinators log for
  // themselves (RLS + a DB trigger reject anything else).
  const selectedCoordinator = str(formData.get("coordinator_id"));
  const coordinatorId =
    isOfficeRole(profile.role) && selectedCoordinator
      ? selectedCoordinator
      : profile.id;

  const { id, error } = await workOrdersRepository.create({
    ...parsed.data,
    coordinator_id: coordinatorId,
  });
  if (error || !id) {
    redirect(withError("/work-orders/new", error ?? "Work order was not created."));
  }

  const base = {
    actorId: profile.id,
    actorName: profile.full_name,
    workOrderId: id,
    clientName: parsed.data.client_name,
    capacity: parsed.data.plant_capacity,
  };
  notify(
    coordinatorId === profile.id
      ? { ...base, type: "work_order.submitted" }
      : { ...base, type: "work_order.assigned", coordinatorId },
  );

  revalidatePath("/work-orders");
  revalidatePath("/");
  redirect(withFlash("/work-orders", "Work order created."));
}

/**
 * Edit the details of an existing work order. Open to the owning coordinator as
 * well as the office: RLS scopes the row to its owner, and a DB trigger keeps
 * `status`/`coordinator_id` admin-only, so a coordinator can never approve or
 * reassign through this path.
 *
 * The total cost and advance decide the balance due, so they obey the payments
 * rules: once the order has been reviewed only the office changes them (the
 * coordinator's form leaves them out, and the DB guards the same), and no edit
 * may overpay the contract against the ledger (`checkContractTerms`, the cap
 * every ledger write obeys).
 *
 * A project reads its client, capacity, financials and KSEB details straight
 * from the work order (live joins, nothing denormalised), so an edit here is
 * immediately visible on the project — the project routes are revalidated so no
 * stale render survives the save.
 */
export async function updateWorkOrder(formData: FormData) {
  const profile = await requireWorkOrderRole();
  const id = text(formData.get("id"));
  const editPath = `/work-orders/${id}/edit`;

  const contract = await loadContract(id, "Work order not found, or you cannot edit it.");
  if (!contract.ok) redirect(withError(editPath, contract.error));
  const { workOrder, ledger } = contract;

  const parsed = parseWorkOrderForm(formData, todayISO(), {
    lockedTerms: canEditContractTerms(profile.role, workOrder.status) ? null : workOrder,
  });
  if (!parsed.ok) redirect(withError(editPath, parsed.error));

  const terms = checkContractTerms({ current: workOrder, terms: parsed.data, ledger });
  if (!terms.ok) redirect(withError(editPath, terms.error));

  const { error } = await workOrdersRepository.update(id, parsed.data);
  if (error) redirect(withError(editPath, error));

  // The office approves on these details, so it hears about field edits.
  if (!isOfficeRole(profile.role)) {
    notify({
      type: "work_order.updated",
      actorId: profile.id,
      actorName: profile.full_name,
      workOrderId: id,
      clientName: parsed.data.client_name,
    });
  }

  revalidateWorkOrder(id, workOrder.project?.id);
  redirect(withFlash(`/work-orders/${id}`, "Work order updated."));
}

export async function approveWorkOrder(formData: FormData) {
  const profile = await requireAdmin();
  const id = text(formData.get("id"));

  const wo = await workOrdersRepository.byId(id);
  if (!wo) redirect(withError(`/work-orders/${id}`, "Work order not found."));

  const statusRes = await workOrdersRepository.setStatus(id, "approved");
  if (statusRes.error) redirect(withError(`/work-orders/${id}`, statusRes.error));

  // Create the active project (a DB trigger seeds the 9 milestones).
  // Guard against duplicates if approve is pressed twice.
  if (!(await projectsRepository.existsForWorkOrder(id))) {
    const projRes = await projectsRepository.createForWorkOrder(
      wo.id,
      wo.coordinator_id,
    );
    if (projRes.error) redirect(withError(`/work-orders/${id}`, projRes.error));
  }

  const projectId = (await workOrdersRepository.byId(id))?.project?.id ?? null;
  // Announce the transition, not a repeated press on an approved order.
  if (wo.status !== "approved") {
    notify({
      type: "work_order.approved",
      actorId: profile.id,
      coordinatorId: wo.coordinator_id,
      workOrderId: wo.id,
      projectId,
      clientName: wo.client_name,
    });
  }

  revalidateWorkOrder(id, projectId);
  redirect(withFlash(`/work-orders/${id}`, "Work order approved — project created."));
}

export async function rejectWorkOrder(formData: FormData) {
  const profile = await requireAdmin();
  const id = text(formData.get("id"));

  const wo = await workOrdersRepository.byId(id);
  if (!wo) redirect(withError(`/work-orders/${id}`, "Work order not found."));

  const { error } = await workOrdersRepository.setStatus(id, "rejected");
  if (error) redirect(withError(`/work-orders/${id}`, error));

  if (wo.status !== "rejected") {
    notify({
      type: "work_order.rejected",
      actorId: profile.id,
      coordinatorId: wo.coordinator_id,
      workOrderId: wo.id,
      clientName: wo.client_name,
    });
  }

  revalidateWorkOrder(id);
  redirect(withFlash(`/work-orders/${id}`, "Work order rejected."));
}

/** Destructive — SuperAdmin only. Cascades to the project and its milestones. */
export async function deleteWorkOrder(formData: FormData) {
  await requireSuperAdmin();
  const id = text(formData.get("id"));

  const { error } = await workOrdersRepository.remove(id);
  if (error) redirect(withError(`/work-orders/${id}`, error));

  revalidatePath("/work-orders");
  revalidatePath("/projects");
  revalidatePath("/");
  redirect(withFlash("/work-orders", "Work order deleted."));
}
