import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  FeasibilityBadge,
  FinancingBadge,
  PaymentBadge,
} from "@/components/status-badges";
import { IncentiveLine } from "./incentive-badge";
import { listRowFeasibility, listRowProgress } from "@/lib/domain/project-list";
import { formatCurrency } from "@/lib/format";
import type { ProjectListRow } from "@/lib/types";

const CHIP = "text-[10px]";

/**
 * A project on the kanban board. Flags only what needs attention: a feasibility
 * that is about to lapse or already costing BSS renewals, and a commissioned
 * plant that is not fully paid.
 */
export function ProjectBoardCard({
  project: p,
  showCoordinator,
}: {
  project: ProjectListRow;
  showCoordinator: boolean;
}) {
  const progress = listRowProgress(p);
  const feasibility = listRowFeasibility(p);
  const flagFeasibility =
    feasibility.state === "expiring" || feasibility.state === "extended";

  return (
    <Link
      href={`/projects/${p.id}`}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="gap-2 p-3 transition-colors hover:border-amber-400 hover:shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{p.client_name ?? "Project"}</p>
          {p.is_completed && (
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-label="Commissioned"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {p.plant_capacity ?? "—"} · {formatCurrency(p.total_cost)}
        </p>
        {showCoordinator && (
          <p className="text-xs text-muted-foreground">{p.coordinator_name ?? "—"}</p>
        )}
        <IncentiveLine incentive={p.coordinator_incentive} paidOn={p.incentive_paid_on} />
        <div className="flex flex-wrap gap-1">
          <FinancingBadge
            financing={p.financing_type}
            bank={p.loan_bank_name}
            className={CHIP}
          />
          {flagFeasibility && <FeasibilityBadge status={feasibility} className={CHIP} />}
          {p.payment_pending && (
            <PaymentBadge source={p} isCompleted className={CHIP} />
          )}
        </div>
        <div className="mt-1">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Milestones completed"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {progress.done}/{progress.total} milestones
          </p>
        </div>
      </Card>
    </Link>
  );
}
