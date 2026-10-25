import { fail, ok, type ActionResult } from "@/lib/result";
import type { ProjectCancellation } from "@/lib/types";
import { isIsoDate } from "./dates";
import { TONES, type StatusRegistry } from "./status";

/**
 * Cancelled and refunded projects.
 *
 * A cancelled or refunded sale leaves the active pipeline but is never erased:
 * the payments ledger is untouched, the project keeps its stage, and the
 * office's remarks ("refunded ₹1,50,000 by bank transfer on 3 Feb") stay as
 * the history note even after the project is reinstated. Only the office
 * records, edits or reverses it (projects RLS).
 *
 * The feasibility clock stops on `cancelled_on` exactly as commissioning stops
 * it (see kseb.ts); the database CHECKs that a project with a running clock
 * always has the date. Only an import with no feasibility date may leave it
 * unrecorded ("date not recorded").
 */

export const CANCELLATIONS = [
  "cancelled",
  "refunded",
] as const satisfies readonly ProjectCancellation[];

export const CANCELLATION: StatusRegistry<ProjectCancellation> = {
  cancelled: { label: "Cancelled", badgeClass: TONES.gray },
  refunded: { label: "Refunded", badgeClass: TONES.red },
};

/** Longest remark (mirrors `projects_cancellation_remarks_length`). */
export const CANCELLATION_REMARKS_MAX = 2000;

export function isCancellation(
  value: string | null | undefined,
): value is ProjectCancellation {
  return value === "cancelled" || value === "refunded";
}

/** Whether a project (or list row) has left the pipeline as cancelled/refunded. */
export function isCancelled(row: { cancellation?: ProjectCancellation | null }): boolean {
  return row.cancellation != null;
}

/** The remarks: trimmed, blank = none, at most `CANCELLATION_REMARKS_MAX`. */
export function parseRemarks(value: string | null): ActionResult<string | null> {
  const text = (value ?? "").trim();
  if (text === "") return ok(null);
  if (text.length > CANCELLATION_REMARKS_MAX) {
    return fail(`Remarks can be at most ${CANCELLATION_REMARKS_MAX} characters.`);
  }
  return ok(text);
}

export const CANCELLATION_DATE_REQUIRED_ERROR =
  "Enter the date it was cancelled — it stops the feasibility clock.";

function dateProblem(
  date: string,
  ctx: { today: string; orderDate: string },
): string | null {
  if (date > ctx.today) return "The date cannot be in the future.";
  if (date < ctx.orderDate) {
    return `The date cannot be before the order date (${ctx.orderDate}).`;
  }
  return null;
}

/**
 * Read the cancel / refund dialog. The app's rule for the date (D10):
 *   - a filled date must be a real date, not after `today` and not before the
 *     order date;
 *   - blank, newly cancelling (no `previous`, or one that was live) → `today`;
 *   - blank, editing an existing cancellation → the recorded date is kept, even
 *     an unrecorded (NULL) one, so editing the remarks never invents a date;
 *   - but a blank date never becomes NULL on a project whose feasibility clock
 *     runs — there the date is required, because it is what stops the clock.
 * A kept date is not re-checked against the order date (it was valid when
 * recorded).
 */
export function parseCancellation(
  input: { cancellation: string | null; cancelledOn: string | null; remarks: string | null },
  ctx: {
    /** IST calendar date. */
    today: string;
    orderDate: string;
    hasFeasibilityDate: boolean;
    previous?: {
      cancellation: ProjectCancellation | null;
      cancelled_on: string | null;
    } | null;
  },
): ActionResult<{
  cancellation: ProjectCancellation;
  cancelled_on: string | null;
  cancellation_remarks: string | null;
}> {
  const kind = input.cancellation?.trim() ?? "";
  if (!isCancellation(kind)) return fail("Choose Cancelled or Refunded.");

  const typed = input.cancelledOn?.trim() ?? "";
  let cancelledOn: string | null;
  if (typed !== "") {
    if (!isIsoDate(typed)) return fail("Enter a valid date.");
    const problem = dateProblem(typed, ctx);
    if (problem) return fail(problem);
    cancelledOn = typed;
  } else if (ctx.previous?.cancellation) {
    // Editing: leave the recorded date (or its absence) alone.
    if (ctx.previous.cancelled_on === null && ctx.hasFeasibilityDate) {
      return fail(CANCELLATION_DATE_REQUIRED_ERROR);
    }
    cancelledOn = ctx.previous.cancelled_on;
  } else {
    const problem = dateProblem(ctx.today, ctx);
    if (problem) return fail(problem);
    cancelledOn = ctx.today;
  }

  const remarks = parseRemarks(input.remarks);
  if (!remarks.ok) return remarks;

  return ok({
    cancellation: kind,
    cancelled_on: cancelledOn,
    cancellation_remarks: remarks.data,
  });
}

/**
 * Why a cancelled project's milestones cannot be changed, or null. Enforced in
 * the actions and the UI (workflow, not security): reinstate it first.
 */
export function progressLockedReason(p: {
  cancellation?: ProjectCancellation | null;
}): string | null {
  return isCancelled(p) ? "Reinstate the project before changing its milestones." : null;
}
