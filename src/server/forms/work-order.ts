import { dec, str, text } from "@/server/form";
import { isValidCapacity } from "@/lib/domain/capacity";
import { isIsoDate } from "@/lib/domain/dates";
import {
  ADVANCE_OVER_TOTAL_ERROR,
  amount,
  isFinancingType,
  type PaymentSource,
} from "@/lib/domain/payment";
import { fail, ok, type ActionResult } from "@/lib/result";
import type { WorkOrderPatch } from "@/server/data/work-orders.repository";

export const CAPACITY_ERROR = "Plant capacity must include a number, e.g. 3kW.";

export const CONTRACT_TERMS_LOCKED_ERROR =
  "The advance and total cost are set by the office after approval — ask the office to change them.";

type ContractTerms = Pick<WorkOrderPatch, "total_cost" | "advance_amount">;

export interface WorkOrderFormOptions {
  /**
   * The stored total cost and advance, when the submitter may not change them
   * (see `canEditContractTerms`). The edit form leaves them out; any that are
   * posted anyway must match, or the whole edit is refused.
   */
  lockedTerms?: Pick<PaymentSource, "total_cost" | "advance_amount"> | null;
}

/** Money is rejected rather than silently coerced to 0. */
function parseContractTerms(formData: FormData): ActionResult<ContractTerms> {
  const totalCost = dec(formData.get("total_cost"));
  if (totalCost === null || totalCost < 0) {
    return fail("Enter a valid total cost (0 or more).");
  }

  // Blank means nothing was collected at booking.
  const advanceRaw = text(formData.get("advance_amount"));
  const advance = advanceRaw ? dec(advanceRaw) : 0;
  if (advance === null || advance < 0) {
    return fail("Enter a valid advance amount (0 or more).");
  }
  if (advance > totalCost) return fail(ADVANCE_OVER_TOTAL_ERROR);

  return ok({ total_cost: totalCost, advance_amount: advance });
}

/** The stored terms, refusing any posted value that differs from them. */
function keepContractTerms(
  formData: FormData,
  locked: NonNullable<WorkOrderFormOptions["lockedTerms"]>,
): ActionResult<ContractTerms> {
  const terms = {
    total_cost: amount(locked.total_cost),
    advance_amount: amount(locked.advance_amount),
  };
  const postedTotal = formData.get("total_cost");
  const postedAdvance = formData.get("advance_amount");
  const changed =
    (postedTotal !== null && dec(postedTotal) !== terms.total_cost) ||
    (postedAdvance !== null &&
      (text(postedAdvance) ? dec(postedAdvance) : 0) !== terms.advance_amount);
  return changed ? fail(CONTRACT_TERMS_LOCKED_ERROR) : ok(terms);
}

/**
 * Read the shared work-order body (create + edit) from a submitted form.
 *
 * The capacity label must carry a number: KSEB registration is priced per kW
 * from it. A bank name is only kept for a loan, so switching an order to
 * self-financed cannot leave a stale bank behind. `today` (IST) is the default
 * order date. With `lockedTerms`, the total cost and advance stay as stored.
 */
export function parseWorkOrderForm(
  formData: FormData,
  today: string,
  { lockedTerms = null }: WorkOrderFormOptions = {},
): ActionResult<WorkOrderPatch> {
  const clientName = text(formData.get("client_name"));
  if (!clientName) return fail("Client name is required.");

  const plantCapacity = text(formData.get("plant_capacity"));
  if (!plantCapacity) return fail("Plant capacity is required.");
  if (!isValidCapacity(plantCapacity)) return fail(CAPACITY_ERROR);

  const terms = lockedTerms
    ? keepContractTerms(formData, lockedTerms)
    : parseContractTerms(formData);
  if (!terms.ok) return terms;

  const orderDate = text(formData.get("order_date")) || today;
  if (!isIsoDate(orderDate)) return fail("Enter a valid order date.");

  const financing = text(formData.get("financing_type")) || "self";
  if (!isFinancingType(financing)) {
    return fail("Choose how the customer is paying: self-financed or bank loan.");
  }

  return ok({
    client_name: clientName,
    client_phone: str(formData.get("client_phone")),
    address: str(formData.get("address")),
    plant_capacity: plantCapacity,
    advance_amount: terms.data.advance_amount,
    total_cost: terms.data.total_cost,
    order_date: orderDate,
    consumer_number: str(formData.get("consumer_number")),
    notes: str(formData.get("notes")),
    kseb_section: str(formData.get("kseb_section")),
    financing_type: financing,
    loan_bank_name: financing === "loan" ? str(formData.get("loan_bank_name")) : null,
  });
}
