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
  withStages,
} from "@/lib/domain/payment";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Payment } from "@/lib/types";

export type StagedPayment = Payment & { stage: number };

/**
 * "Stage 2" for contract instalments (the booking advance is stage 0), "KSEB fee
 * 1" for KSEB charges — each purpose is numbered on its own.
 */
export function stageLabel(payment: Pick<StagedPayment, "stage" | "purpose">): string {
  return payment.purpose === "kseb_fees"
    ? `KSEB fee ${payment.stage}`
    : `Stage ${payment.stage}`;
}

function PurposeBadge({ purpose }: { purpose: Payment["purpose"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        purpose === "kseb_fees" &&
          "border-blue-200 text-blue-800 dark:border-blue-500/30 dark:text-blue-300",
      )}
    >
      {PAYMENT_PURPOSE_LABELS[purpose]}
    </Badge>
  );
}

/**
 * The ledger in collection order with stage numbers: a table from `md` up and a
 * stack of cards below it, so field staff on phones never scroll sideways.
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
              <TableHead>Received on</TableHead>
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
                  {formatCurrency(p.amount)}
                </TableCell>
                <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
                <TableCell>
                  <PurposeBadge purpose={p.purpose} />
                </TableCell>
                <TableCell className="max-w-48 whitespace-normal">
                  <span className="break-words">{p.reference ?? "—"}</span>
                  {!compact && p.notes && (
                    <p className="text-xs text-muted-foreground">{p.notes}</p>
                  )}
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
                  {formatDate(p.paid_on)} · {PAYMENT_METHOD_LABELS[p.method]}
                </p>
              </div>
              <p className="shrink-0 text-base font-semibold tabular-nums">
                {formatCurrency(p.amount)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <PurposeBadge purpose={p.purpose} />
              {p.reference && <span className="break-all">{p.reference}</span>}
            </div>
            {!compact && (p.notes || p.recorder) && (
              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {p.notes && <p className="break-words">{p.notes}</p>}
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
