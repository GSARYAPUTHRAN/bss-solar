import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IncentiveInstalment } from "@/server/data/projects.repository";

/**
 * What is agreed, what has been paid of it and what is still to pay — the three
 * figures every view of one person's incentive opens with. Exact rupees and
 * paise: this is money someone is owed, not a summary.
 */
export function IncentiveFigures({
  amount,
  paid,
  pending,
  className,
}: {
  amount: number;
  paid: number;
  pending: number;
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-wrap gap-x-6 gap-y-1 text-sm", className)}>
      <Figure label="Agreed" value={amount} />
      <Figure label="Paid" value={paid} />
      <Figure label="Still to pay" value={pending} emphasise={pending > 0} />
    </dl>
  );
}

function Figure({
  label,
  value,
  emphasise,
}: {
  label: string;
  value: number;
  emphasise?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-medium tabular-nums",
          emphasise && "text-amber-700 dark:text-amber-300",
        )}
      >
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

/**
 * The instalments paid against one incentive, oldest first: when, how much, the
 * note and who recorded it (where the viewer may read profiles). `renderActions`
 * adds per-row controls for the office; omit it for a read-only list.
 */
export function InstalmentList({
  payments,
  label,
  renderActions,
  className,
}: {
  payments: readonly IncentiveInstalment[];
  /** Accessible name of the list ("Payments to Ravi Kumar"). */
  label: string;
  renderActions?: (payment: IncentiveInstalment) => React.ReactNode;
  className?: string;
}) {
  if (payments.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>No payments recorded yet.</p>;
  }
  return (
    <ul aria-label={label} className={cn("divide-y rounded-md border", className)}>
      {payments.map((payment) => (
        <li key={payment.id} className="flex items-start justify-between gap-2 px-3 py-2">
          <div className="min-w-0 space-y-0.5">
            <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <time dateTime={payment.paid_on} className="font-medium">
                {formatDate(payment.paid_on)}
              </time>
              <span className="tabular-nums">{formatCurrency(payment.amount)}</span>
            </p>
            {payment.note && (
              <p className="break-words text-xs text-muted-foreground">{payment.note}</p>
            )}
            {payment.recorded_by_name && (
              <p className="text-xs text-muted-foreground">
                Recorded by {payment.recorded_by_name}
              </p>
            )}
          </div>
          {renderActions && <div className="flex shrink-0 items-center">{renderActions(payment)}</div>}
        </li>
      ))}
    </ul>
  );
}
