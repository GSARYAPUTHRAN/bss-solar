"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { paymentsRepository } from "@/server/data/payments.repository";
import { workOrdersRepository } from "@/server/data/work-orders.repository";
import { loadContract } from "@/server/data/contract";
import { text } from "@/server/form";
import { checkContractCap, parsePaymentForm } from "@/server/forms/payment";
import { notify } from "@/server/notifications";
import { fail, ok, type ActionResult } from "@/lib/result";
import { formatCurrency, todayISO } from "@/lib/format";
import { withFlash } from "@/lib/flash";

/**
 * The payments ledger. The office records and corrects entries; only the
 * SuperAdmin deletes one. RLS enforces the same split independently (migration
 * 20261010120200) — these guards exist so a refused write is explained rather
 * than silently filtered out.
 *
 * Record and edit return a result (they run from a dialog that keeps the
 * user's input on error); delete runs from a confirmation and redirects.
 */

/** `null` before the first submit. */
export type PaymentFormState = ActionResult<{ message: string }> | null;

const WORK_ORDER_GONE = "Work order not found — it may have been deleted.";

/** Everywhere a ledger total shows: both detail pages, both lists, dashboard. */
function revalidateLedger(workOrderId: string, projectId: string | null) {
  revalidatePath(`/work-orders/${workOrderId}`);
  revalidatePath("/work-orders");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/");
}

export async function recordPayment(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const profile = await requireAdmin();

  const parsed = parsePaymentForm(formData, todayISO());
  if (!parsed.ok) return parsed;

  const contract = await loadContract(text(formData.get("work_order_id")), WORK_ORDER_GONE);
  if (!contract.ok) return contract;
  const { workOrder, ledger } = contract;

  const cap = checkContractCap({ contract: workOrder, ledger, entry: parsed.data });
  if (!cap.ok) return cap;

  const { error } = await paymentsRepository.create(
    workOrder.id,
    parsed.data,
    profile.id,
  );
  if (error) return fail(error);

  const projectId = workOrder.project?.id ?? null;
  notify({
    type: "payment.recorded",
    actorId: profile.id,
    coordinatorId: workOrder.coordinator_id,
    workOrderId: workOrder.id,
    projectId,
    clientName: workOrder.client_name,
    amount: parsed.data.amount,
    balanceDue: cap.data.balanceAfter,
  });

  revalidateLedger(workOrder.id, projectId);
  return ok({ message: `Payment of ${formatCurrency(parsed.data.amount)} recorded.` });
}

export async function updatePayment(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  await requireAdmin();

  const id = text(formData.get("id"));
  const parsed = parsePaymentForm(formData, todayISO());
  if (!parsed.ok) return parsed;

  const existing = await paymentsRepository.byId(id);
  if (!existing) return fail("This payment no longer exists — refresh the page.");

  const contract = await loadContract(existing.work_order_id, WORK_ORDER_GONE);
  if (!contract.ok) return contract;
  const { workOrder, ledger } = contract;

  const cap = checkContractCap({
    contract: workOrder,
    ledger,
    entry: parsed.data,
    editingId: id,
  });
  if (!cap.ok) return cap;

  const { error } = await paymentsRepository.update(id, parsed.data);
  if (error) return fail(error);

  revalidateLedger(workOrder.id, workOrder.project?.id ?? null);
  return ok({ message: "Payment updated." });
}

/**
 * Destructive — SuperAdmin only. Lands back on the page that shows the ledger:
 * the project when there is one, else the work order. The posted
 * `work_order_id` is only a fallback for an entry that is already gone, and is
 * looked up before it is used to build the path.
 */
export async function deletePayment(formData: FormData) {
  await requireSuperAdmin();

  const id = text(formData.get("id"));
  const existing = await paymentsRepository.byId(id);
  const workOrder = await workOrdersRepository.byId(
    existing?.work_order_id ?? text(formData.get("work_order_id")),
  );
  const projectId = workOrder?.project?.id ?? null;
  const back = projectId
    ? `/projects/${projectId}`
    : workOrder
      ? `/work-orders/${workOrder.id}`
      : "/work-orders";

  if (!existing) {
    redirect(withFlash(back, "That payment was already deleted.", "error"));
  }

  const { error } = await paymentsRepository.remove(id);
  if (error) redirect(withFlash(back, error, "error"));

  revalidateLedger(existing.work_order_id, projectId);
  redirect(withFlash(back, "Payment deleted."));
}
