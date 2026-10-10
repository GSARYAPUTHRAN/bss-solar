import type { Payment, WorkOrder } from "@/lib/types";
import { paymentsRepository } from "./payments.repository";
import { workOrdersRepository } from "./work-orders.repository";

/** A work order with its payments ledger, or why it could not be read. */
export type LoadedContract =
  | { ok: true; workOrder: WorkOrder; ledger: Payment[] }
  | { ok: false; error: string };

/**
 * Everything the contract rules are checked against — the payment cap on a
 * ledger write, and the terms of a work-order edit. A work order that is
 * missing (or hidden by RLS) answers `notFound`; a failed read refuses the
 * write, since the rules cannot be checked without the ledger, with a message
 * the user can retry instead of a trip to the error boundary.
 */
export async function loadContract(
  workOrderId: string,
  notFound: string,
): Promise<LoadedContract> {
  try {
    const [workOrder, ledger] = await Promise.all([
      workOrdersRepository.byId(workOrderId),
      paymentsRepository.listForWorkOrder(workOrderId),
    ]);
    return workOrder ? { ok: true, workOrder, ledger } : { ok: false, error: notFound };
  } catch {
    return { ok: false, error: "Could not read the payment ledger — please try again." };
  }
}
