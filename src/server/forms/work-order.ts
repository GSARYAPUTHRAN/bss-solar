import { dec, str, text } from "@/server/form";
import {
  ADVANCE_METHOD_NONE,
  advanceDetailsProblem,
  type AdvanceDetails,
} from "@/lib/domain/advance";
import { isIsoDate } from "@/lib/domain/dates";
import {
  ADVANCE_OVER_TOTAL_ERROR,
  amount,
  isFinancingType,
  isPaymentMethod,
  type PaymentSource,
} from "@/lib/domain/payment";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import { isPlanType, planLabelProblem } from "@/lib/domain/plan";
import { fail, ok, type ActionResult } from "@/lib/result";
import type { PlanType } from "@/lib/types";
import type { WorkOrderPatch } from "@/server/data/work-orders.repository";

export const CONTRACT_TERMS_LOCKED_ERROR =
  "The advance and total cost are set by the office after approval — ask the office to change them.";

export const PLAN_CHOICE_ERROR = "Choose Solar plant or Custom plan.";
export const PLAN_FIXED_ERROR = "The plan is fixed once the project has started.";

type ContractTerms = Pick<WorkOrderPatch, "total_cost" | "advance_amount">;

/**
 * What the lock covers: the total cost and advance, and how and when the advance
 * was paid. The details are optional here — a caller that has none stored
 * leaves them out, and they read as "not recorded".
 */
export type LockedTerms = Pick<PaymentSource, "total_cost" | "advance_amount"> &
  Partial<AdvanceDetails>;

export interface WorkOrderFormOptions {
  /**
   * The stored total cost, advance and advance details, when the submitter may
   * not change them (see `canEditContractTerms`). The edit form leaves them out;
   * any that are posted anyway must match, or the whole edit is refused. They
   * are written back as stored, so the database's own lock (which compares the
   * columns it is sent) sees no change.
   */
  lockedTerms?: LockedTerms | null;
  /**
   * The stored plan once the work order has a project: its milestones were
   * seeded from it, so it can no longer change. A form that posts another plan
   * is refused; one that posts none keeps this.
   */
  lockedPlan?: PlanType | null;
  /**
   * The label and plan already stored (an edit). A solar label that is
   * unchanged still saves even if it would not pass today's capacity rule — an
   * old row can be edited without retyping its capacity. It counts only while
   * the plan stays what it was: "1 panel" moved from a custom plan to solar is
   * a new solar label and is judged as one.
   */
  previousCapacity?: string | null;
  previousPlan?: PlanType | null;
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

/** The method as posted: a blank or "not recorded" is nothing; anything else is judged later. */
function postedMethod(raw: string): string | null {
  return raw === "" || raw === ADVANCE_METHOD_NONE ? null : raw;
}

/**
 * How and when the advance was paid — all optional, and only meaningful with an
 * advance. The date is a day that has happened; the reference is short text.
 */
function parseAdvanceDetails(
  formData: FormData,
  today: string,
  advance: number,
): ActionResult<AdvanceDetails> {
  const rawMethod = postedMethod(text(formData.get("advance_method")));
  const method = rawMethod === null || isPaymentMethod(rawMethod) ? rawMethod : undefined;
  if (method === undefined) {
    return fail("Choose how the advance was paid, or leave it as not recorded.");
  }

  const paidOn = text(formData.get("advance_paid_on")) || null;
  if (paidOn !== null) {
    if (!isIsoDate(paidOn)) return fail("Enter a valid date for when the advance was received.");
    if (paidOn > today) return fail("The advance date cannot be in the future.");
  }

  const reference = str(formData.get("advance_reference"));
  if (reference !== null && reference.length > PAYMENT_LIMITS.advanceReferenceLength) {
    return fail(
      `The advance reference must be ${PAYMENT_LIMITS.advanceReferenceLength} characters or fewer.`,
    );
  }

  const details = {
    advance_method: method,
    advance_paid_on: paidOn,
    advance_reference: reference,
  };
  const problem = advanceDetailsProblem(advance, details);
  return problem ? fail(problem) : ok(details);
}

/** The stored advance details, refusing any posted value that differs from them. */
function keepAdvanceDetails(
  formData: FormData,
  locked: LockedTerms,
): ActionResult<AdvanceDetails> {
  const stored: AdvanceDetails = {
    advance_method: locked.advance_method ?? null,
    advance_paid_on: locked.advance_paid_on ?? null,
    advance_reference: locked.advance_reference ?? null,
  };
  const method = formData.get("advance_method");
  const paidOn = formData.get("advance_paid_on");
  const reference = formData.get("advance_reference");
  const changed =
    (method !== null && postedMethod(text(method)) !== stored.advance_method) ||
    (paidOn !== null && (text(paidOn) || null) !== stored.advance_paid_on) ||
    (reference !== null && str(reference) !== stored.advance_reference);
  return changed ? fail(CONTRACT_TERMS_LOCKED_ERROR) : ok(stored);
}

/**
 * The plan the form describes. Posted as `plan_type`; a form that posts none
 * means the plan the order already has (an edit), or a solar plant (a new
 * order). Once a project exists the plan is `lockedPlan` and nothing else.
 */
function parsePlan(
  formData: FormData,
  { lockedPlan, previousPlan }: WorkOrderFormOptions,
): ActionResult<PlanType> {
  const posted = text(formData.get("plan_type"));
  if (lockedPlan) {
    return posted && posted !== lockedPlan ? fail(PLAN_FIXED_ERROR) : ok(lockedPlan);
  }
  if (!posted) return ok(previousPlan ?? "solar");
  return isPlanType(posted) ? ok(posted) : fail(PLAN_CHOICE_ERROR);
}

/**
 * Read the shared work-order body (create + edit) from a submitted form.
 *
 * The plan label (`plant_capacity`) depends on the plan: a solar plant's
 * capacity must put a unit on its number ("3kW") because KSEB registration is
 * priced per kW from it; a custom plan describes what was sold, in words. A
 * bank name is only kept for a loan, so switching an order to self-financed
 * cannot leave a stale bank behind. `today` (IST) is the default order date.
 * With `lockedTerms`, the total cost, advance and advance details stay as stored.
 */
export function parseWorkOrderForm(
  formData: FormData,
  today: string,
  options: WorkOrderFormOptions = {},
): ActionResult<WorkOrderPatch> {
  const { lockedTerms = null } = options;
  const clientName = text(formData.get("client_name"));
  if (!clientName) return fail("Client name is required.");

  const plan = parsePlan(formData, options);
  if (!plan.ok) return plan;

  const plantCapacity = text(formData.get("plant_capacity"));
  if (!plantCapacity && plan.data === "solar") return fail("Plant capacity is required.");
  const previous =
    (options.previousPlan ?? "solar") === plan.data ? options.previousCapacity : null;
  const labelProblem = planLabelProblem(plan.data, plantCapacity, { previous });
  if (labelProblem) return fail(labelProblem);

  const terms = lockedTerms
    ? keepContractTerms(formData, lockedTerms)
    : parseContractTerms(formData);
  if (!terms.ok) return terms;

  const advanceDetails = lockedTerms
    ? keepAdvanceDetails(formData, lockedTerms)
    : parseAdvanceDetails(formData, today, terms.data.advance_amount);
  if (!advanceDetails.ok) return advanceDetails;

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
    plan_type: plan.data,
    plant_capacity: plantCapacity,
    advance_amount: terms.data.advance_amount,
    ...advanceDetails.data,
    total_cost: terms.data.total_cost,
    order_date: orderDate,
    consumer_number: str(formData.get("consumer_number")),
    notes: str(formData.get("notes")),
    kseb_section: str(formData.get("kseb_section")),
    financing_type: financing,
    loan_bank_name: financing === "loan" ? str(formData.get("loan_bank_name")) : null,
  });
}
