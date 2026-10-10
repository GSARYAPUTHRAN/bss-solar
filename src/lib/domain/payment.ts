import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
} from "@/lib/types";
import { FINANCING, statusLabels } from "./status";

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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
 * but the full contract value has not been collected.
 */
export function isPaymentPending(
  project: { is_completed?: boolean | null },
  source: PaymentSource,
): boolean {
  return Boolean(project.is_completed) && paymentSummary(source).balanceDue > 0;
}

/** Share of the contract value collected so far, 0-100. */
export function collectedPct(source: PaymentSource): number {
  const { totalCost, received } = paymentSummary(source);
  if (totalCost <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((received / totalCost) * 100)));
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
      a.paid_on.localeCompare(b.paid_on) ||
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
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
