import { Badge } from "@/components/ui/badge";
import { INCENTIVE_STATE, incentiveState } from "@/lib/domain/project-list";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface IncentiveProps {
  incentive: number | null;
  paidOn: string | null;
  className?: string;
}

/** Pending, or paid with the date it was paid. */
export function IncentiveBadge({ incentive, paidOn, className }: IncentiveProps) {
  const state = incentiveState({
    coordinator_incentive: incentive,
    incentive_paid_on: paidOn,
  });
  const meta = INCENTIVE_STATE[state];
  return (
    <Badge className={cn("border-transparent", meta.badgeClass, className)}>
      {state === "paid" ? `Paid ${formatDate(paidOn)}` : meta.label}
    </Badge>
  );
}

/** The incentive amount with its state; an em dash when none is set. */
export function IncentiveAmount({ incentive, paidOn, className }: IncentiveProps) {
  if (incentive === null) return <span className={className}>—</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className="font-medium tabular-nums">{formatCurrency(incentive)}</span>
      <IncentiveBadge incentive={incentive} paidOn={paidOn} />
    </span>
  );
}

/**
 * "Incentive ₹X Pending/Paid" as one compact line for phone rows and board
 * cards; nothing when no incentive is set.
 */
export function IncentiveLine({ incentive, paidOn, className }: IncentiveProps) {
  if (incentive === null) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="text-muted-foreground">Incentive</span>
      <IncentiveAmount incentive={incentive} paidOn={paidOn} />
    </p>
  );
}
