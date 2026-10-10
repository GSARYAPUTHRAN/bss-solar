import { Field, FieldGrid } from "@/components/layout";
import { PaymentBadge } from "@/components/status-badges";
import { collectedPct, paymentSummary, type PaymentSource } from "@/lib/domain/payment";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Where a contract stands: what was agreed, what has come in (booking advance +
 * ledger instalments) and what is still due. Shared by the project's payments
 * section and the work-order page so both always read the same figures.
 */
export function ContractSummary({
  source,
  isCompleted,
  ksebFeesCollected = 0,
}: {
  source: PaymentSource;
  isCompleted?: boolean | null;
  /** KSEB charges collected through BSS — shown, never added to the contract. */
  ksebFeesCollected?: number;
}) {
  const summary = paymentSummary(source);
  const pct = collectedPct(source);
  const alarming = Boolean(isCompleted) && !summary.isSettled;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {pct}% collected
          </p>
          <PaymentBadge source={source} isCompleted={isCompleted} />
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
              summary.isSettled
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
        <Field label="Total received" value={formatCurrency(summary.received)} />
        <Field
          label="Balance due"
          value={
            <span
              className={cn(
                "tabular-nums",
                alarming && "text-red-700 dark:text-red-300",
              )}
            >
              {formatCurrency(summary.balanceDue)}
            </span>
          }
        />
        {ksebFeesCollected > 0 && (
          <Field
            label="KSEB fees collected"
            value={formatCurrency(ksebFeesCollected)}
          />
        )}
      </FieldGrid>
    </div>
  );
}
