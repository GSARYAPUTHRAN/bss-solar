import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
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

/** A coordinator's own incentives: earned (all set), paid, still pending. */
export function CoordinatorIncentiveSummary({ summary }: { summary: IncentiveSummary }) {
  return (
    <section aria-label="Your incentives" className="grid grid-cols-3 gap-2 sm:gap-3">
      <MiniStat
        label="Earned"
        value={formatCurrencyWhole(summary.total)}
        hint={`${summary.projects} project${summary.projects === 1 ? "" : "s"}`}
      />
      <MiniStat label="Paid" value={formatCurrencyWhole(summary.paid)} tone={PAID_TONE} />
      <MiniStat
        label="Pending"
        value={formatCurrencyWhole(summary.pending)}
        tone={PENDING_TONE}
        href={summary.pending > 0 ? PENDING_HREF : undefined}
      />
    </section>
  );
}

/**
 * The office's view: what is still owed to coordinators — across everyone, or
 * the coordinator the list is filtered to.
 */
export function OfficeIncentiveTile({
  summary,
  coordinatorId,
  coordinatorName,
}: {
  summary: IncentiveSummary;
  coordinatorId?: string | null;
  coordinatorName?: string | null;
}) {
  const href = coordinatorId
    ? `${PENDING_HREF}&coordinator=${encodeURIComponent(coordinatorId)}`
    : PENDING_HREF;
  return (
    <section aria-label="Coordinator incentives" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <MiniStat
        label="Incentives pending"
        value={formatCurrency(summary.pending)}
        tone={summary.pending > 0 ? PENDING_TONE : undefined}
        hint={`${coordinatorName ?? "All coordinators"} · ${summary.pendingProjects} project${summary.pendingProjects === 1 ? "" : "s"} awaiting payment`}
        href={href}
      />
    </section>
  );
}
