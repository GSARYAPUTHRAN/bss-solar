import { Badge } from "@/components/ui/badge";
import { incentiveState, type IncentiveState } from "@/lib/domain/incentives";
import {
  INCENTIVE_STATE,
  incentiveStateLabel,
  saleIncentiveState,
} from "@/lib/domain/project-list";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One person's incentive: the agreed amount (null while the office has not set
 * one) and what instalments have paid of it. Lists and the board show the whole
 * sale's figures instead (`IncentiveTotal` / `SaleIncentiveLine`).
 */
interface IncentiveProps {
  amount: number | null;
  paid: number;
  className?: string;
}

/** The sale's figures as the list view gives them (the incentives the viewer may read). */
interface SaleIncentiveProps {
  /** Σ agreed amounts; null when none is set. */
  total: number | null;
  /** Σ instalments paid. */
  paid: number;
  /** How many people have an incentive set. */
  count: number;
  /** Of those, how many still have something to pay. */
  unpaidCount: number;
  className?: string;
}

function StateBadge({
  state,
  total,
  className,
}: {
  state: IncentiveState;
  total: number | null;
  className?: string;
}) {
  return (
    <Badge className={cn("border-transparent", INCENTIVE_STATE[state].badgeClass, className)}>
      {incentiveStateLabel(state, total)}
    </Badge>
  );
}

/** "· ₹4,000 paid" — only while the incentive is part-way; paid and pending say it already. */
function PaidSoFar({ paid }: { paid: number }) {
  return (
    <span className="tabular-nums text-muted-foreground">· {formatCurrency(paid)} paid</span>
  );
}

/** Not set, Pending, Partly paid or Paid ("Nothing owed" for an incentive of zero). */
export function IncentiveBadge({ amount, paid, className }: IncentiveProps) {
  return <StateBadge state={incentiveState({ amount, paid })} total={amount} className={className} />;
}

/** One person's agreed amount with what is paid and its state; an em dash when none is set. */
export function IncentiveAmount({ amount, paid, className }: IncentiveProps) {
  if (amount === null) return <span className={className}>—</span>;
  const state = incentiveState({ amount, paid });
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className="font-medium tabular-nums">{formatCurrency(amount)}</span>
      {state === "partly_paid" && <PaidSoFar paid={paid} />}
      <StateBadge state={state} total={amount} />
    </span>
  );
}

/**
 * "Incentive ₹X · ₹Y paid  Partly paid" as one compact line for phone rows and
 * board cards; nothing when no incentive is set.
 */
export function IncentiveLine({ amount, paid, className }: IncentiveProps) {
  if (amount === null) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="text-muted-foreground">Incentive</span>
      <IncentiveAmount amount={amount} paid={paid} />
    </p>
  );
}

/**
 * The state of everyone's incentives on one sale — Not set, Pending, Partly paid
 * or Paid — from the figures the list view gives (the incentives the caller may
 * see: the office everyone's, a coordinator their own).
 */
export function SaleIncentiveBadge({
  count,
  unpaidCount,
  paid,
  total = null,
  className,
}: Omit<SaleIncentiveProps, "total"> & { total?: number | null }) {
  const state = saleIncentiveState({
    incentive_count: count,
    incentive_unpaid_count: unpaidCount,
    incentive_paid: paid,
  });
  return <StateBadge state={state} total={total} className={className} />;
}

/**
 * The sale's agreed total with what is paid of it and its state; an em dash when
 * no one has one set. Used where a row stands for the whole sale (project lists,
 * the board, the summary card).
 */
export function IncentiveTotal({
  total,
  paid,
  count,
  unpaidCount,
  className,
}: SaleIncentiveProps) {
  if (!count) return <span className={className}>—</span>;
  const state = saleIncentiveState({
    incentive_count: count,
    incentive_unpaid_count: unpaidCount,
    incentive_paid: paid,
  });
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span className="font-medium tabular-nums">{formatCurrency(total)}</span>
      {state === "partly_paid" && <PaidSoFar paid={paid} />}
      <StateBadge state={state} total={total} />
    </span>
  );
}

/**
 * \`IncentiveLine\` for a whole sale: "Incentive ₹X · ₹Y paid  Partly paid" from
 * the list view's figures, nothing when no one has an incentive set. The figures
 * are the viewer's (the office sees everyone's, a coordinator only their own), so
 * a coordinator's line is worded "Your incentive" via \`label\`.
 */
export function SaleIncentiveLine({
  label = "Incentive",
  className,
  ...sale
}: SaleIncentiveProps & { label?: string }) {
  if (!sale.count) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="text-muted-foreground">{label}</span>
      <IncentiveTotal {...sale} />
    </p>
  );
}
