import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  ProjectCancellation,
  UserRole,
  WorkOrderStatus,
} from "@/lib/types";
import { isOfficeRole } from "./role";
import { FINANCING, statusLabels } from "./status";
import { round2 } from "./rounding";

/**
 * Collections against a work order.
 *
 * The booking advance is recorded on the work order; every later collection —
 * however many stages the customer pays in — is a row in the payments ledger.
 *
 *   contract received = advance + Σ ledger entries with purpose "contract"
 *   balance due       = total cost − contract received
 *
 * Ledger entries with purpose "kseb_fees" are KSEB charges collected through
 * BSS; they never count towards the contract.
 *
 * The SQL views (`work_orders_list` / `projects_list`) compute the same figures
 * so lists can filter and sort on them; tests/integration/payments.test.ts pins
 * the two together.
 */

type Amount = number | string | null | undefined;

/** The subset of a work order (or list row) the contract maths needs. */
export interface PaymentSource {
  total_cost?: Amount;
  advance_amount?: Amount;
  /** Σ contract ledger entries (the list views expose this precomputed). */
  payments_total?: Amount;
}

export interface PaymentSummary {
  totalCost: number;
  advance: number;
  /** Σ contract ledger entries, excluding the advance. */
  ledger: number;
  /** advance + ledger. */
  received: number;
  /** total − received. Negative when the customer has overpaid. */
  balanceDue: number;
  /** Nothing left to collect (covers exact and over payment). */
  isSettled: boolean;
}

/** Coerce a numeric/decimal column (PostgREST may hand back a string). */
export function amount(value: Amount): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function paymentSummary(source: PaymentSource): PaymentSummary {
  const totalCost = amount(source.total_cost);
  const advance = amount(source.advance_amount);
  const ledger = amount(source.payments_total);
  const received = round2(advance + ledger);
  const balanceDue = round2(totalCost - received);
  return {
    totalCost,
    advance,
    ledger,
    received,
    balanceDue,
    isSettled: balanceDue <= 0,
  };
}

/**
 * The business case this exists for: the plant is commissioned and handed over,
 * but the full contract value has not been collected. A cancelled or refunded
 * project is never pending: its balance is no longer receivable.
 */
export function isPaymentPending(
  project: { is_completed?: boolean | null; cancellation?: ProjectCancellation | null },
  source: PaymentSource,
): boolean {
  return (
    Boolean(project.is_completed) &&
    project.cancellation == null &&
    paymentSummary(source).balanceDue > 0
  );
}

/**
 * What can still be collected: the balance due, or nothing once the project is
 * cancelled or refunded (the ledger stays as history; refunds are recorded in
 * the project's remarks, never as negative payments).
 */
export function collectibleBalance(
  summary: PaymentSummary,
  cancellation?: ProjectCancellation | null,
): number {
  return cancellation == null ? summary.balanceDue : 0;
}

/**
 * Who may change a work order's contract terms — its total cost and booking
 * advance. They decide the balance due, and collections are kept by the office,
 * so once the office has reviewed an order only the office changes them
 * (guard_work_order_update enforces the same in the database). While the order
 * is pending, the coordinator who logged it may still correct them.
 */
export function canEditContractTerms(
  role: UserRole,
  status: WorkOrderStatus,
): boolean {
  return isOfficeRole(role) || status === "pending";
}

/** The booking advance is part of the contract value, never more than it. */
export const ADVANCE_OVER_TOTAL_ERROR = "The advance cannot be more than the total cost.";

/** Share of the contract value collected so far, 0-100. */
export function collectedPct(source: PaymentSource): number {
  const { totalCost, received, isSettled } = paymentSummary(source);
  // Only a settled contract reads 100% — ₹500 outstanding on ₹2,00,000 must not
  // round up to "100%" (that is exactly the commissioned-unpaid case).
  if (isSettled || totalCost <= 0) return 100;
  // Divide whole paise, not binary fractions of rupees: 57000 / 100000 * 100 is
  // 56.99999999999999, which would floor a whole point away.
  const pct = Math.floor((paise(received) * 100) / paise(totalCost));
  return Math.min(99, Math.max(0, pct));
}

function paise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** A ledger entry, as far as the maths is concerned. */
export interface LedgerEntry {
  amount: Amount;
  paid_on: string;
  purpose?: PaymentPurpose | null;
  created_at?: string | null;
}

export interface LedgerTotals {
  /** Σ contract entries. Feed this to `paymentSummary` as `payments_total`. */
  contract: number;
  /** Σ KSEB-fee entries collected through BSS. */
  ksebFees: number;
  /** Number of contract entries. */
  count: number;
  /** Latest contract `paid_on`, or null. */
  lastPaidOn: string | null;
}

/** Totals for a work order's ledger, split by purpose. */
export function ledgerTotals(entries: readonly LedgerEntry[]): LedgerTotals {
  let contract = 0;
  let ksebFees = 0;
  let count = 0;
  let lastPaidOn: string | null = null;
  for (const e of entries) {
    if ((e.purpose ?? "contract") === "contract") {
      contract += amount(e.amount);
      count += 1;
      if (!lastPaidOn || e.paid_on > lastPaidOn) lastPaidOn = e.paid_on;
    } else {
      ksebFees += amount(e.amount);
    }
  }
  return { contract: round2(contract), ksebFees: round2(ksebFees), count, lastPaidOn };
}

/** Plain code-unit order — ISO dates sort correctly, independent of locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order by instant, not by text: Postgres omits the fraction on a whole-second
 * timestamp, so "…09:00:00+00:00" and "…09:00:00.5+00:00" compare wrongly as
 * strings. Unparseable or missing values tie (the sort is stable).
 */
function byInstant(a: string | null | undefined, b: string | null | undefined): number {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}

/**
 * Ledger in collection order with a 1-based stage number per purpose — the
 * advance is "stage 0", so the first ledger payment is stage 1, matching how the
 * office talks about instalments. Ties on `paid_on` keep entry order.
 */
export function withStages<T extends LedgerEntry>(
  entries: readonly T[],
): (T & { stage: number })[] {
  const ordered = [...entries].sort(
    (a, b) =>
      byCodeUnit(a.paid_on, b.paid_on) || byInstant(a.created_at, b.created_at),
  );
  const counters = new Map<PaymentPurpose, number>();
  return ordered.map((e) => {
    const purpose = e.purpose ?? "contract";
    const stage = (counters.get(purpose) ?? 0) + 1;
    counters.set(purpose, stage);
    return { ...e, stage };
  });
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  loan_disbursement: "Loan disbursement",
  other: "Other",
};

export const PAYMENT_PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  contract: "Contract",
  kseb_fees: "KSEB fees",
};

/** Financing labels derive from the FINANCING status registry. */
export const FINANCING_LABELS: Record<FinancingType, string> = statusLabels(FINANCING);

export function isPaymentMethod(v: string): v is PaymentMethod {
  return Object.hasOwn(PAYMENT_METHOD_LABELS, v);
}

export function isPaymentPurpose(v: string): v is PaymentPurpose {
  return Object.hasOwn(PAYMENT_PURPOSE_LABELS, v);
}

export function isFinancingType(v: string): v is FinancingType {
  return Object.hasOwn(FINANCING, v);
}
