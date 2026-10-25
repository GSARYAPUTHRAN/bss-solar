import { Badge } from "@/components/ui/badge";
import {
  INCENTIVE_STATE,
  incentiveState,
  saleIncentiveState,
} from "@/lib/domain/project-list";
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
 * The state of everyone's incentives on one sale — Not set, Pending, Partly paid
 * or Paid — from the counts the list view gives (the incentives the caller may
 * see: the office everyone's, a coordinator their own).
 */
export function SaleIncentiveBadge({
  count,
  unpaidCount,
  className,
}: {
  count: number;
  unpaidCount: number;
  className?: string;
}) {
  const state = saleIncentiveState({
    incentive_count: count,
    incentive_unpaid_count: unpaidCount,
  });
  const meta = INCENTIVE_STATE[state];
  return (
    <Badge className={cn("border-transparent", meta.badgeClass, className)}>
      {meta.label}
    </Badge>
  );
}

/**
 * The sale's incentive total with its state; an em dash when no one has one
 * set. Used where a row stands for the whole sale (project lists, the board,
 * the summary card).
 */
export function IncentiveTotal({
  total,
  count,
  unpaidCount,
  className,
}: {
  total: number | null;
  count: number;
  unpaidCount: number;
  className?: string;
}) {
  if (!count) return <span className={className}>—</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className="font-medium tabular-nums">{formatCurrency(total)}</span>
      <SaleIncentiveBadge count={count} unpaidCount={unpaidCount} />
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

/**
 * `IncentiveLine` for a whole sale: "Incentive ₹X Pending / Partly paid / Paid"
 * from the list view's counts, nothing when no one has an incentive set. The
 * figures are the viewer's (the office sees everyone's, a coordinator only their
 * own), so a coordinator's line is worded "Your incentive" via `label`.
 */
export function SaleIncentiveLine({
  total,
  count,
  unpaidCount,
  label = "Incentive",
  className,
}: {
  total: number | null;
  count: number;
  unpaidCount: number;
  label?: string;
  className?: string;
}) {
  if (!count) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="text-muted-foreground">{label}</span>
      <IncentiveTotal total={total} count={count} unpaidCount={unpaidCount} />
    </p>
  );
}
