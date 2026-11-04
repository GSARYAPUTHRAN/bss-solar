import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_PURPOSE_LABELS,
  ledgerEffect,
  withStages,
} from "@/lib/domain/payment";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Payment } from "@/lib/types";

/** `stage` is null for a refund or a write-off: neither is a stage of anything. */
export type StagedPayment = Payment & { stage: number | null };

/**
 * "Stage 2" for contract instalments (the booking advance is stage 0), "KSEB fee
 * 1" for KSEB charges — each purpose is numbered on its own. A refund and a
 * write-off are named for what they are.
 */
export function stageLabel(payment: Pick<StagedPayment, "stage" | "purpose">): string {
  if (payment.purpose === "refund") return "Refund";
  if (payment.purpose === "write_off") return "Write-off";
  return payment.purpose === "kseb_fees"
    ? `KSEB fee ${payment.stage}`
    : `Stage ${payment.stage}`;
}

/**
 * The entry as a lower-case noun for a sentence or an accessible name — "stage 2
 * payment", "KSEB fee 1 payment", "refund", "write-off".
 */
export function entryName(payment: Pick<StagedPayment, "stage" | "purpose">): string {
  const label = stageLabel(payment).toLowerCase();
  return payment.purpose === "refund" || payment.purpose === "write_off"
    ? label
    : `${label} payment`;
}

const PURPOSE_TONES: Partial<Record<Payment["purpose"], string>> = {
  kseb_fees: "border-blue-200 text-blue-800 dark:border-blue-500/30 dark:text-blue-300",
  refund: "border-red-200 text-red-800 dark:border-red-500/30 dark:text-red-300",
  write_off: "text-muted-foreground",
};

/** A KSEB fee the office paid on the customer's behalf wears this tag. */
const OFFICE_PAID_TONE =
  "border-violet-200 text-violet-800 dark:border-violet-500/30 dark:text-violet-300";

function PurposeBadge({ payment }: { payment: Pick<Payment, "purpose" | "paid_by_office"> }) {
  const { purpose, paid_by_office } = payment;
  return (
    <>
      <Badge variant="outline" className={cn("font-normal", PURPOSE_TONES[purpose])}>
        {PAYMENT_PURPOSE_LABELS[purpose]}
      </Badge>
      {purpose === "kseb_fees" && paid_by_office && (
        <Badge variant="outline" className={cn("font-normal", OFFICE_PAID_TONE)}>
          Paid by office
        </Badge>
      )}
    </>
  );
}

/**
 * The amount as the history shows it: a refund is money going out, so it is red
 * with a minus; a write-off is not money at all, so it is plain and muted.
 */
function LedgerAmount({ payment }: { payment: Pick<Payment, "amount" | "purpose"> }) {
  const amount = formatCurrency(payment.amount);
  if (ledgerEffect(payment.purpose) === "out") {
    return <span className="text-red-700 dark:text-red-300">−{amount}</span>;
  }
  if (payment.purpose === "write_off") {
    return <span className="text-muted-foreground">{amount}</span>;
  }
  return <>{amount}</>;
}

/**
 * What goes under "Reference": the reference, and — unless `compact` — the
 * notes. A write-off's note is its reason, which is the point of the entry, so
 * it reads "Written off — reason" however compact the ledger is.
 */
function ReferenceDetail({
  payment,
  compact,
}: {
  payment: Pick<Payment, "purpose" | "reference" | "notes">;
  compact: boolean;
}) {
  if (payment.purpose === "write_off") {
    return <span className="break-words">Written off — {payment.notes}</span>;
  }
  return (
    <>
      <span className="break-words">{payment.reference ?? "—"}</span>
      {!compact && noteOf(payment) && (
        <p className="text-xs text-muted-foreground">{noteOf(payment)}</p>
      )}
    </>
  );
}

/** The note under an entry. A write-off's note is its reason, shown as "Written off — reason" instead. */
function noteOf(payment: Pick<Payment, "purpose" | "notes">): string | null {
  return payment.purpose === "write_off" ? null : payment.notes;
}

/** A write-off moves no money, so it has no method. */
function methodOf(payment: Pick<Payment, "purpose" | "method">): string {
  return payment.purpose === "write_off" ? "—" : PAYMENT_METHOD_LABELS[payment.method];
}

/**
 * The ledger in collection order with stage numbers: a table from `md` up and a
 * stack of cards below it, so field staff on phones never scroll sideways.
 * Refunds, write-offs and KSEB fees the office paid are told apart at a glance
 * (see `LedgerAmount`, `ReferenceDetail`, `PurposeBadge`).
 *
 * `renderActions` adds per-row controls (edit/delete); omit it for a read-only
 * ledger. `compact` drops the recorder and notes for summary contexts.
 */
export function PaymentLedger({
  payments,
  renderActions,
  compact = false,
}: {
  payments: readonly Payment[];
  renderActions?: (payment: StagedPayment) => ReactNode;
  compact?: boolean;
}) {
  const staged = withStages(payments);

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Reference</TableHead>
              {!compact && <TableHead>Recorded by</TableHead>}
              {renderActions && (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {staged.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{stageLabel(p)}</TableCell>
                <TableCell>{formatDate(p.paid_on)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <LedgerAmount payment={p} />
                </TableCell>
                <TableCell>{methodOf(p)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <PurposeBadge payment={p} />
                  </div>
                </TableCell>
                <TableCell className="max-w-48 whitespace-normal">
                  <ReferenceDetail payment={p} compact={compact} />
                </TableCell>
                {!compact && (
                  <TableCell className="text-muted-foreground">
                    {p.recorder?.full_name ?? "—"}
                  </TableCell>
                )}
                {renderActions && (
                  <TableCell>
                    <div className="flex justify-end gap-1">{renderActions(p)}</div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label="Payments">
        {staged.map((p) => (
          <li key={p.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{stageLabel(p)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(p.paid_on)}
                  {p.purpose !== "write_off" && ` · ${methodOf(p)}`}
                </p>
              </div>
              <p className="shrink-0 text-base font-semibold tabular-nums">
                <LedgerAmount payment={p} />
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <PurposeBadge payment={p} />
              {p.purpose === "write_off" ? (
                <span className="break-words">Written off — {p.notes}</span>
              ) : (
                p.reference && <span className="break-all">{p.reference}</span>
              )}
            </div>
            {!compact && (noteOf(p) || p.recorder) && (
              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {noteOf(p) && <p className="break-words">{noteOf(p)}</p>}
                {p.recorder && <p>Recorded by {p.recorder.full_name}</p>}
              </div>
            )}
            {renderActions && (
              <div className="mt-2 flex justify-end gap-2 border-t pt-2">
                {renderActions(p)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
