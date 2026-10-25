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
  profilesRepository,
  projectsRepository,
  workOrdersRepository,
} from "@/server/data";
import { text } from "@/server/form";
import { readCoordinatorIds } from "@/server/forms/coordinators";
import { checkContractTerms } from "@/server/forms/payment";
import { parseWorkOrderForm } from "@/server/forms/work-order";
import { notify } from "@/server/notifications";
import { todayISO } from "@/lib/format";
import { withFlash } from "@/lib/flash";
import {
  coordinatorChangeEvents,
  coordinatorsLabel,
  describeCoordinatorChange,
  planCoordinatorChange,
  planNewSaleTeam,
  teamAuthority,
} from "@/lib/domain/coordinators";
import type { NotificationEvent } from "@/lib/domain/notifications";
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

/**
 * The refusals of `set_work_order_coordinators` that are already worded for the
 * people who read them (who may add partners, the cap, the person who still has
 * an incentive …). Anything else — a dropped connection, a bug — is not shown
 * raw.
 */
const WORDED_FOR_PEOPLE = new Set(["42501", "22023", "23514", "P0002"]);
const COORDINATORS_NOT_SAVED = "Could not save the coordinators — please try again.";

function coordinatorFailure({ error, code }: { error: string; code?: string }): string {
  if (!code || !WORDED_FOR_PEOPLE.has(code)) return COORDINATORS_NOT_SAVED;
  const message = error.trim();
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

/**
 * Log a work order. A sale can be shared: the coordinator who logs it is always
 * first and may name partners; the office may log it for anyone (the first
 * person named is the one it is logged for).
 *
 * Two steps, not one (D20): the work order is inserted for its first
 * coordinator — the insert policy, the owner guard and the old build all keep
 * working on that — and the partners join through `set_work_order_coordinators`.
 * The team is checked against the directory first, so the second step failing is
 * rare; when it does, the work order exists and the person is told exactly what
 * to redo. Notifications are built from the team the database reports, never the
 * planned one — nobody is told they were added to a sale they are not on.
 */
export async function createWorkOrder(formData: FormData) {
  const profile = await requireWorkOrderRole();

  const parsed = parseWorkOrderForm(formData, todayISO());
  if (!parsed.ok) redirect(withError("/work-orders/new", parsed.error));

  const directory = await profilesRepository.coordinatorDirectory();
  const planned = planNewSaleTeam({
    actor: profile,
    requested: readCoordinatorIds(formData),
    directory,
  });
  if (!planned.ok) redirect(withError("/work-orders/new", planned.error));
  const [first, ...partners] = planned.data;

  const names = new Map(directory.map((member) => [member.id, member.full_name]));
  names.set(profile.id, profile.full_name);
  const nameOf = (id: string) => names.get(id) ?? "A coordinator";

  const { id, error } = await workOrdersRepository.create({
    ...parsed.data,
    coordinator_id: first,
  });
  if (error || !id) {
    redirect(withError("/work-orders/new", error ?? "Work order was not created."));
  }

  let added: string[] = [];
  let partnersFailed: string | null = null;
  if (partners.length > 0) {
    const shared = await workOrdersRepository.setCoordinators(id, planned.data);
    if (shared.error) partnersFailed = coordinatorFailure({ error: shared.error, code: shared.code });
    else added = shared.added;
  }
  const team = [first, ...added];

  const base = {
    actorId: profile.id,
    actorName: profile.full_name,
    workOrderId: id,
    clientName: parsed.data.client_name,
    capacity: parsed.data.plant_capacity,
  };
  const events: NotificationEvent[] = [];
  const others = team.filter((member) => member !== profile.id);
  if (isOfficeRole(profile.role) && others.length > 0) {
    // Logged for them: everyone on the sale hears it, the office actor does not.
    events.push({ ...base, type: "work_order.assigned", coordinatorIds: others });
  } else {
    events.push({
      ...base,
      type: "work_order.submitted",
      partnerNames: added.map(nameOf),
    });
    if (!isOfficeRole(profile.role)) {
      // The office already heard who the partners are (above); the partners are
      // told they were added. Nothing when the partners did not make it.
      events.push(
        ...coordinatorChangeEvents({
          actor: profile,
          workOrderId: id,
          projectId: null,
          clientName: parsed.data.client_name,
          capacity: parsed.data.plant_capacity,
          team: team.map((member) => ({ id: member, full_name: nameOf(member) })),
          added,
          removed: [],
          atCreate: true,
        }),
      );
    }
  }
  notify(...events);

  revalidatePath("/work-orders");
  revalidatePath("/");

  if (partnersFailed) {
    const missing = coordinatorsLabel(partners.map(nameOf));
    redirect(
      withError(
        `/work-orders/${id}`,
        `Work order created, but ${missing} could not be added: ${partnersFailed.replace(/[.\s]+$/, "")}. Add them under Coordinators.`,
      ),
    );
  }
  redirect(
    withFlash(
      "/work-orders",
      added.length > 0
        ? `Work order created and shared with ${coordinatorsLabel(added.map(nameOf))}.`
        : "Work order created.",
    ),
  );
}

/**
 * Edit the details of an existing work order. Open to the sale's coordinators as
 * well as the office: RLS scopes the row to its members, and a DB trigger keeps
 * `status`/`coordinator_id` admin-only, so a coordinator can never approve or
 * reassign through this path.
 *
 * The total cost and advance decide the balance due, so they obey the payments
 * rules: once the order has been reviewed only the office changes them (the
 * coordinator's form leaves them out, and the DB guards the same), and no edit
 * may overpay the contract against the ledger (`checkContractTerms`, the cap
 * every ledger write obeys).
 *
 * The plan (solar or custom) is chosen while the order is pending; once a
 * project exists its milestones were seeded from it and it is fixed.
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
    lockedPlan: workOrder.project ? workOrder.plan_type : null,
    previousCapacity: workOrder.plant_capacity,
    previousPlan: workOrder.plan_type,
  });
  if (!parsed.ok) redirect(withError(editPath, parsed.error));

  const terms = checkContractTerms({ current: workOrder, terms: parsed.data, ledger });
  if (!terms.ok) redirect(withError(editPath, terms.error));

  const { error } = await workOrdersRepository.update(id, parsed.data);
  if (error) redirect(withError(editPath, error));

  // The office approves on these details, so it hears about field edits — and
  // so do the sale's other coordinators.
  if (!isOfficeRole(profile.role)) {
    notify({
      type: "work_order.updated",
      actorId: profile.id,
      actorName: profile.full_name,
      coordinatorIds: workOrder.coordinators.map((member) => member.id),
      workOrderId: id,
      clientName: parsed.data.client_name,
    });
  }

  revalidateWorkOrder(id, workOrder.project?.id);
  redirect(withFlash(`/work-orders/${id}`, "Work order updated."));
}

/**
 * Change who shares a sale. The office may set any list (add, remove, reorder);
 * the coordinator who logged a still-pending order may only add partners.
 * `planCoordinatorChange` gives people the plain refusal before the round trip;
 * `set_work_order_coordinators` decides for real (and alone knows who still has
 * an incentive). People added and removed are told, never the person who made
 * the change.
 */
export async function setWorkOrderCoordinators(formData: FormData) {
  const profile = await requireWorkOrderRole();
  const id = text(formData.get("id"));
  const detail = `/work-orders/${id}`;

  const wo = await workOrdersRepository.byId(id);
  if (!wo) redirect(withError("/work-orders", "Work order not found."));

  const before = wo.coordinators.map((member) => member.id);
  if (teamAuthority(profile, { status: wo.status, coordinatorIds: before }) === "none") {
    redirect(withError(detail, "Only the office can change who shares this work order."));
  }

  const directory = await profilesRepository.coordinatorDirectory();
  const planned = planCoordinatorChange({
    viewer: profile,
    status: wo.status,
    before,
    requested: readCoordinatorIds(formData),
    directory,
  });
  if (!planned.ok) redirect(withError(detail, planned.error));
  const { after } = planned.data;

  if (after.length === before.length && after.every((member, i) => member === before[i])) {
    redirect(withFlash(detail, describeCoordinatorChange([], [])));
  }

  const result = await workOrdersRepository.setCoordinators(id, after);
  if (result.error) {
    redirect(withError(detail, coordinatorFailure({ error: result.error, code: result.code })));
  }

  const names = new Map<string, string>([
    ...directory.map((member): [string, string] => [member.id, member.full_name]),
    ...wo.coordinators.map((member): [string, string] => [member.id, member.full_name]),
  ]);
  const nameOf = (member: string) => names.get(member) ?? "A coordinator";
  const projectId = wo.project?.id ?? null;

  notify(
    ...coordinatorChangeEvents({
      actor: profile,
      workOrderId: id,
      projectId,
      clientName: wo.client_name,
      capacity: wo.plant_capacity,
      team: after.map((member) => ({ id: member, full_name: nameOf(member) })),
      added: result.added,
      removed: result.removed,
      atCreate: false,
    }),
  );

  revalidateWorkOrder(id, projectId);
  redirect(
    withFlash(
      detail,
      result.added.length + result.removed.length === 0
        ? "Coordinator order updated."
        : describeCoordinatorChange(result.added.map(nameOf), result.removed.map(nameOf)),
    ),
  );
}

export async function approveWorkOrder(formData: FormData) {
  const profile = await requireAdmin();
  const id = text(formData.get("id"));

  const wo = await workOrdersRepository.byId(id);
  if (!wo) redirect(withError(`/work-orders/${id}`, "Work order not found."));

  const statusRes = await workOrdersRepository.setStatus(id, "approved");
  if (statusRes.error) redirect(withError(`/work-orders/${id}`, statusRes.error));

  // Create the active project (a DB trigger seeds its milestones: the nine KSEB
  // stages, or one Handover step for a custom plan).
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
      coordinatorIds: wo.coordinators.map((member) => member.id),
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
      coordinatorIds: wo.coordinators.map((member) => member.id),
      workOrderId: wo.id,
      clientName: wo.client_name,
    });
  }

  revalidateWorkOrder(id);
  redirect(withFlash(`/work-orders/${id}`, "Work order rejected."));
}

/**
 * Destructive — SuperAdmin only. Cascades to the project and its milestones,
 * and to the sale's coordinators with their incentives.
 */
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
