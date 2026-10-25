import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  CancellationBadge,
  FeasibilityBadge,
  FinancingBadge,
  PaymentBadge,
  PlanBadge,
} from "@/components/status-badges";
import { SaleIncentiveLine } from "./incentive-badge";
import { completionLabel } from "@/lib/domain/plan";
import { listRowFeasibility, listRowProgress } from "@/lib/domain/project-list";
import { teamNote } from "@/lib/domain/work-order-list";
import { formatCurrency } from "@/lib/format";
import type { ProjectListRow } from "@/lib/types";

const CHIP = "text-[10px]";

/**
 * A project on the kanban board. Flags only what needs attention: a project
 * that was cancelled or refunded, a custom plan, a feasibility that is about to
 * lapse or already costing BSS renewals, and a commissioned plant that is not
 * fully paid.
 *
 * The office (`showCoordinator`) sees everyone on the sale; a coordinator sees
 * who they share it with and their own incentive.
 */
export function ProjectBoardCard({
  project: p,
  showCoordinator,
  viewerId,
}: {
  project: ProjectListRow;
  showCoordinator: boolean;
  /** The signed-in person, so a shared sale leaves themself out of "with …". */
  viewerId: string;
}) {
  const progress = listRowProgress(p);
  const feasibility = listRowFeasibility(p);
  const flagFeasibility =
    feasibility.state === "expiring" || feasibility.state === "extended";
  const team = teamNote(p, { id: viewerId, office: showCoordinator });
  const done = completionLabel(p.plan_type);

  return (
    <Link
      href={`/projects/${p.id}`}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="gap-2 p-3 transition-colors hover:border-amber-400 hover:shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{p.client_name ?? "Project"}</p>
          {/* A cancelled or refunded project carries its own badge instead. */}
          {p.is_completed && !p.cancellation && (
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-label={done}
            />
          )}
        </div>
        <p className="break-words text-xs text-muted-foreground">
          {p.plant_capacity ?? "—"} · {formatCurrency(p.total_cost)}
        </p>
        {team && <p className="break-words text-xs text-muted-foreground">{team}</p>}
        <SaleIncentiveLine
          total={p.incentive_total}
          count={p.incentive_count}
          unpaidCount={p.incentive_unpaid_count}
          label={showCoordinator ? "Incentive" : "Your incentive"}
        />
        <div className="flex flex-wrap gap-1">
          <CancellationBadge cancellation={p.cancellation} />
          <PlanBadge plan={p.plan_type} />
          <FinancingBadge
            financing={p.financing_type}
            bank={p.loan_bank_name}
            className={CHIP}
          />
          {flagFeasibility && <FeasibilityBadge status={feasibility} className={CHIP} />}
          {p.payment_pending && !p.cancellation && (
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
            {progress.done}/{progress.total} {progress.total === 1 ? "milestone" : "milestones"}
          </p>
        </div>
      </Card>
    </Link>
  );
}
