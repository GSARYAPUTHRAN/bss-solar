"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { paymentsRepository } from "@/server/data/payments.repository";
import type { PaymentInput } from "@/server/data/payments.repository";
import { loadContract, type LoadedContract } from "@/server/data/contract";
import { text } from "@/server/form";
import {
  checkLedgerChange,
  parsePaymentForm,
  parseWriteOffForm,
  recordedMessage,
} from "@/server/forms/payment";
import { notify } from "@/server/notifications";
import { fail, ok, type ActionResult } from "@/lib/result";
import { todayISO } from "@/lib/format";
import { withFlash } from "@/lib/flash";
import { collectibleBalance, paymentSummary, withLedger } from "@/lib/domain/payment";
import type { Profile } from "@/lib/types";

/**
 * The payments ledger. The office records and corrects entries — payments, KSEB
 * fees, refunds and write-offs; only the SuperAdmin deletes one. RLS enforces
 * the same split independently (migration 20261010120200) — these guards exist
 * so a refused write is explained rather than silently filtered out.
 *
 * Every write goes through `checkLedgerChange`, the one place the caps live:
 * the contract cannot be overpaid, a refund cannot exceed what was collected, a
 * write-off cannot exceed the balance due.
 *
 * Record, write off and edit return a result (they run from a dialog that keeps
 * the user's input on error); delete runs from a confirmation and redirects.
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

/**
 * Everyone on the sale hears of the money; what is "still due" is what can
 * still be collected — nothing once the project is cancelled or refunded.
 */
function announce(
  actor: Profile,
  { workOrder, ledger }: Extract<LoadedContract, { ok: true }>,
  entry: PaymentInput,
) {
  const cancellation = workOrder.project?.cancellation ?? null;
  const afterEntry = paymentSummary(withLedger(workOrder, [...ledger, entry]));
  notify({
    type: "payment.recorded",
    actorId: actor.id,
    coordinatorIds: workOrder.coordinators.map((member) => member.id),
    workOrderId: workOrder.id,
    projectId: workOrder.project?.id ?? null,
    clientName: workOrder.client_name,
    amount: entry.amount,
    purpose: entry.purpose,
    paidByOffice: entry.paid_by_office,
    balanceDue: collectibleBalance(afterEntry, cancellation),
    cancellation,
  });
}

/**
 * Check a new entry against the ledger and store it. Shared by recording a
 * payment, KSEB fee or refund and by writing a balance off: the caps are the
 * same, so the two cannot drift apart.
 */
async function addEntry(
  actor: Profile,
  workOrderId: string,
  entry: PaymentInput,
): Promise<PaymentFormState> {
  const contract = await loadContract(workOrderId, WORK_ORDER_GONE);
  if (!contract.ok) return contract;
  const { workOrder, ledger } = contract;

  const allowed = checkLedgerChange({
    terms: workOrder,
    ledger,
    change: { kind: "add", entry },
  });
  if (!allowed.ok) return allowed;

  const { error } = await paymentsRepository.create(workOrder.id, entry, actor.id);
  if (error) return fail(error);

  announce(actor, contract, entry);
  revalidateLedger(workOrder.id, workOrder.project?.id ?? null);
  return ok({ message: recordedMessage(entry, allowed.data.balanceAfter) });
}

/** A contract payment, a KSEB fee (customer's or the office's) or a refund. */
export async function recordPayment(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const profile = await requireAdmin();

  const parsed = parsePaymentForm(formData, todayISO());
  if (!parsed.ok) return parsed;

  return addEntry(profile, text(formData.get("work_order_id")), parsed.data);
}

/**
 * Give up part or all of the balance still due — the customer is a few rupees
 * short and the office lets it go. Office only, a reason is required, and it can
 * never exceed the balance. No money moves: the sale simply stops being owed.
 */
export async function writeOffBalance(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const profile = await requireAdmin();

  const parsed = parseWriteOffForm(formData, todayISO());
  if (!parsed.ok) return parsed;

  return addEntry(profile, text(formData.get("work_order_id")), parsed.data);
}

export async function updatePayment(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  await requireAdmin();

  const id = text(formData.get("id"));
  const existing = await paymentsRepository.byId(id);
  if (!existing) return fail("This payment no longer exists — refresh the page.");

  // A write-off keeps its own shape (an amount, a date and a reason); an entry
  // is never turned into one, nor a write-off into money.
  const isWriteOff = existing.purpose === "write_off";
  const parsed = isWriteOff
    ? parseWriteOffForm(formData, todayISO())
    : parsePaymentForm(formData, todayISO());
  if (!parsed.ok) return parsed;

  const contract = await loadContract(existing.work_order_id, WORK_ORDER_GONE);
  if (!contract.ok) return contract;
  const { workOrder, ledger } = contract;

  const allowed = checkLedgerChange({
    terms: workOrder,
    ledger,
    change: { kind: "replace", id, entry: parsed.data },
  });
  if (!allowed.ok) return allowed;

  const { error } = await paymentsRepository.update(id, parsed.data);
  if (error) return fail(error);

  revalidateLedger(workOrder.id, workOrder.project?.id ?? null);
  return ok({ message: isWriteOff ? "Write-off updated." : "Payment updated." });
}

/**
 * Destructive — SuperAdmin only. Lands back on the page that shows the ledger:
 * the project when there is one, else the work order. The posted
 * `work_order_id` is only a fallback for an entry that is already gone, and is
 * looked up before it is used to build the path.
 *
 * An entry other entries rely on stays: a payment a refund was paid out of, a
 * refund a write-off was sized against. The ledger is replayed without it and
 * the delete is refused if that would leave one of them over its limit.
 */
export async function deletePayment(formData: FormData) {
  await requireSuperAdmin();

  const id = text(formData.get("id"));
  const existing = await paymentsRepository.byId(id);
  const contract = await loadContract(
    existing?.work_order_id ?? text(formData.get("work_order_id")),
    WORK_ORDER_GONE,
  );
  const workOrder = contract.ok ? contract.workOrder : null;
  const projectId = workOrder?.project?.id ?? null;
  const back = projectId
    ? `/projects/${projectId}`
    : workOrder
      ? `/work-orders/${workOrder.id}`
      : "/work-orders";

  if (!existing) {
    redirect(withFlash(back, "That payment was already deleted.", "error"));
  }
  if (!contract.ok) redirect(withFlash(back, contract.error, "error"));

  const allowed = checkLedgerChange({
    terms: contract.workOrder,
    ledger: contract.ledger,
    change: { kind: "remove", id },
  });
  if (!allowed.ok) redirect(withFlash(back, allowed.error, "error"));

  const { error } = await paymentsRepository.remove(id);
  if (error) redirect(withFlash(back, error, "error"));

  revalidateLedger(existing.work_order_id, projectId);
  redirect(withFlash(back, "Payment deleted."));
}
