import { Field, FieldGrid } from "@/components/layout";
import { PaymentBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { collectedPct, paymentSummary, type PaymentSource } from "@/lib/domain/payment";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectCancellation } from "@/lib/types";

/**
 * Where a contract stands: what was agreed, what has come in (booking advance +
 * ledger instalments), what went back (refunds), what was given up (write-offs)
 * and what is still due. Shared by the project's payments section and the
 * work-order page so both always read the same figures.
 *
 *   collected    = advance + instalments
 *   net received = collected − refunded
 *   balance due  = total − net received − written off
 *
 * The refund and write-off lines appear only once there is one, so a plain
 * contract reads as before. A balance a write-off closed reads "Settled — ₹800
 * written off": it is settled, but not collected.
 *
 * Once the project is cancelled or refunded the balance is no longer
 * receivable: it is shown as what was not collected (muted, never red) and the
 * commissioned-but-unpaid warning is off. The ledger itself is history.
 */
export function ContractSummary({
  source,
  isCompleted,
  cancellation,
  ksebFeesCollected = 0,
  ksebFeesByOffice = 0,
}: {
  /** Include `refunded_total` and `written_off_total` (see `withLedger`) once there are any. */
  source: PaymentSource;
  isCompleted?: boolean | null;
  /** The project's state; null or absent while it is live. */
  cancellation?: ProjectCancellation | null;
  /** KSEB charges the customer paid through BSS — shown, never added to the contract. */
  ksebFeesCollected?: number;
  /** KSEB charges the BSS office paid on the customer's behalf — shown, never added either. */
  ksebFeesByOffice?: number;
}) {
  const summary = paymentSummary(source);
  const pct = collectedPct(source);
  const alarming = Boolean(isCompleted) && !summary.isSettled && !cancellation;
  const settledByWriteOff = !cancellation && summary.writtenOff > 0 && summary.isSettled;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {settledByWriteOff
              ? `Settled — ${formatCurrency(summary.writtenOff)} written off`
              : `${pct}% collected`}
          </p>
          {settledByWriteOff ? (
            <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              Settled
            </Badge>
          ) : (
            <PaymentBadge
              source={source}
              isCompleted={isCompleted}
              cancellation={cancellation}
            />
          )}
        </div>
        <div
          role="progressbar"
          aria-label="Contract value collected"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              cancellation
                ? "bg-muted-foreground/40"
                : summary.isSettled
                  ? "bg-emerald-500"
                  : alarming
                    ? "bg-red-500"
                    : "bg-amber-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <FieldGrid cols={3}>
        <Field label="Contract total" value={formatCurrency(summary.totalCost)} />
        <Field label="Advance (at booking)" value={formatCurrency(summary.advance)} />
        <Field label="Instalments" value={formatCurrency(summary.ledger)} />
        {summary.refunded > 0 ? (
          <>
            <Field label="Collected" value={formatCurrency(summary.collected)} />
            <Field
              label="Refunded"
              value={
                <span className="tabular-nums text-red-700 dark:text-red-300">
                  −{formatCurrency(summary.refunded)}
                </span>
              }
            />
            <Field label="Net received" value={formatCurrency(summary.received)} />
          </>
        ) : (
          <Field label="Total received" value={formatCurrency(summary.received)} />
        )}
        {summary.writtenOff > 0 && (
          <Field label="Written off" value={formatCurrency(summary.writtenOff)} />
        )}
        <Field
          label="Balance due"
          value={
            cancellation ? (
              <span className="tabular-nums text-muted-foreground">
                {formatCurrency(summary.balanceDue)}
                {summary.balanceDue > 0 && " not collected"} — project {cancellation}
              </span>
            ) : (
              <span
                className={cn(
                  "tabular-nums",
                  alarming && "text-red-700 dark:text-red-300",
                )}
              >
                {formatCurrency(summary.balanceDue)}
              </span>
            )
          }
        />
        {ksebFeesCollected > 0 && (
          <Field
            label="KSEB fees collected"
            value={formatCurrency(ksebFeesCollected)}
          />
        )}
        {ksebFeesByOffice > 0 && (
          <Field
            label="KSEB fees paid by office"
            value={formatCurrency(ksebFeesByOffice)}
          />
        )}
      </FieldGrid>
    </div>
  );
}
