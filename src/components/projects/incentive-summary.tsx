import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatCurrencyWhole } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IncentiveSummary } from "@/server/data/projects.repository";

const PENDING_HREF = "/projects?view=list&incentive=pending";

/**
 * A small figure tile; compact enough that three fit across a phone. Below
 * `sm` the figure is `text-sm` so a lakh-scale amount in whole rupees fits a
 * tile on a 360px screen; the card would clip anything wider.
 */
function MiniStat({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  href?: string;
}) {
  const body = (
    <Card
      size="sm"
      className={cn("h-full gap-0.5 px-3", href && "transition-shadow hover:shadow-md")}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
        {label}
      </p>
      <p className={cn("text-sm font-bold tabular-nums sm:text-xl", tone)}>{value}</p>
      {hint && <p className="truncate text-[10px] text-muted-foreground sm:text-xs">{hint}</p>}
    </Card>
  );
  if (!href) return body;
  return (
    <Link
      href={href}
      className="block min-h-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  );
}

const PENDING_TONE = "text-amber-700 dark:text-amber-300";
const PAID_TONE = "text-emerald-700 dark:text-emerald-300";

const projectCount = (n: number) => `${n} project${n === 1 ? "" : "s"}`;

/**
 * Agreed, paid and still-to-pay incentive totals as three tiles. The three come
 * from `incentive_summary()`: Σ agreed amounts, Σ instalments paid and the
 * difference — so what is paid is money that moved, not a tick on a sale.
 */
function IncentiveTiles({
  summary,
  ariaLabel,
  labels,
  agreedHint,
  pendingHint,
  pendingHref,
}: {
  summary: IncentiveSummary;
  ariaLabel: string;
  labels: { agreed: string; paid: string; pending: string };
  agreedHint: string;
  pendingHint?: string;
  pendingHref?: string;
}) {
  return (
    <section aria-label={ariaLabel} className="grid grid-cols-3 gap-2 sm:gap-3">
      <MiniStat
        label={labels.agreed}
        value={formatCurrencyWhole(summary.total)}
        hint={agreedHint}
      />
      <MiniStat label={labels.paid} value={formatCurrencyWhole(summary.paid)} tone={PAID_TONE} />
      <MiniStat
        label={labels.pending}
        value={formatCurrencyWhole(summary.pending)}
        tone={summary.pending > 0 ? PENDING_TONE : undefined}
        hint={pendingHint}
        href={summary.pending > 0 ? pendingHref : undefined}
      />
    </section>
  );
}

/** A coordinator's own incentives: earned (all agreed), paid, still pending. */
export function CoordinatorIncentiveSummary({ summary }: { summary: IncentiveSummary }) {
  return (
    <IncentiveTiles
      summary={summary}
      ariaLabel="Your incentives"
      labels={{ agreed: "Earned", paid: "Paid", pending: "Pending" }}
      agreedHint={projectCount(summary.projects)}
      pendingHref={PENDING_HREF}
    />
  );
}

/**
 * The office's view: what was agreed with coordinators, what has been paid of
 * it and what is still owed — across everyone, or the coordinator the list is
 * filtered to. The pending tile opens the list of sales with something owed.
 */
export function OfficeIncentiveSummary({
  summary,
  coordinatorId,
  coordinatorName,
}: {
  summary: IncentiveSummary;
  coordinatorId?: string | null;
  coordinatorName?: string | null;
}) {
  const scope = coordinatorName ?? "All coordinators";
  return (
    <IncentiveTiles
      summary={summary}
      ariaLabel="Coordinator incentives"
      labels={{ agreed: "Incentives agreed", paid: "Incentives paid", pending: "Incentives pending" }}
      agreedHint={`${scope} · ${projectCount(summary.projects)}`}
      pendingHint={`${summary.pendingProjects} ${summary.pendingProjects === 1 ? "project" : "projects"} awaiting payment`}
      pendingHref={
        coordinatorId
          ? `${PENDING_HREF}&coordinator=${encodeURIComponent(coordinatorId)}`
          : PENDING_HREF
      }
    />
  );
}
