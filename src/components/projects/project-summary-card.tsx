import Link from "next/link";
import { CoordinatorNames } from "@/components/coordinator-names";
import { Section } from "@/components/layout";
import {
  CancellationBadge,
  FinancingBadge,
  PaymentBadge,
} from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { formatKw } from "@/lib/domain/capacity";
import type { PaymentSource, PaymentSummary } from "@/lib/domain/payment";
import { completionLabel, stageLabel } from "@/lib/domain/plan";
import { formatCurrency } from "@/lib/format";
import type { ProjectDetail } from "@/server/data/projects.repository";
import { IncentiveAmount, IncentiveTotal } from "./incentive-badge";
import { MapsLink, PhoneLink } from "./contact-links";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * The incentive row the viewer is entitled to: a coordinator's own ("Your
 * incentive"), or the office's view of the whole sale ("Incentives"). Nobody
 * else's pay is ever passed in.
 */
export type SummaryIncentive =
  | { view: "own"; amount: number | null; paidOn: string | null }
  | { view: "sale"; total: number | null; count: number; unpaidCount: number };

/**
 * The project at a glance. The incentive row is rendered only when the caller
 * passes one (RLS already limits what a coordinator can load; this keeps the
 * intent explicit).
 */
export function ProjectSummaryCard({
  project,
  payment,
  paymentSource,
  progress,
  incentive,
  changeCoordinatorsHref,
  className,
  children,
}: {
  project: ProjectDetail;
  payment: PaymentSummary;
  /** What `payment` was computed from (for the payment badge). */
  paymentSource: PaymentSource;
  progress: { done: number; total: number };
  incentive?: SummaryIncentive;
  /** Office: where the sale's coordinators are changed. */
  changeCoordinatorsHref?: string;
  className?: string;
  /** Actions (advance, delete) rendered under the facts. */
  children?: React.ReactNode;
}) {
  const wo = project.work_order;
  const plan = wo?.plan_type ?? "solar";

  return (
    <Section title="Project Summary" className={className} contentClassName="space-y-3 text-sm">
      <dl className="space-y-3">
        <Row label="Status">
          <span className="flex flex-wrap justify-end gap-1.5">
            {project.is_completed ? (
              <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                {completionLabel(plan)}
              </Badge>
            ) : (
              <Badge variant="secondary">In Progress</Badge>
            )}
            <CancellationBadge cancellation={project.cancellation} />
          </span>
        </Row>
        <Row label="Current stage">{stageLabel(project.current_stage, plan)}</Row>
        <Row label="Progress">
          {progress.done}/{progress.total}
        </Row>
        <Row label="Coordinators">
          <span className="flex flex-col items-end gap-1">
            <CoordinatorNames
              names={project.coordinators.map((c) => c.full_name)}
              variant="chips"
              className="justify-end"
            />
            {changeCoordinatorsHref && (
              <Link
                href={changeCoordinatorsHref}
                className="inline-flex min-h-10 items-center text-xs font-medium text-primary hover:underline md:min-h-6"
              >
                Change
              </Link>
            )}
          </span>
        </Row>
        <Row label="Phone">
          <PhoneLink phone={wo?.client_phone} />
        </Row>
        {plan === "custom" ? (
          <Row label="Plan">{wo?.plant_capacity ?? "—"}</Row>
        ) : (
          <Row label="Capacity">
            {wo?.plant_capacity ?? "—"}
            {wo?.plant_capacity_kw != null && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({formatKw(wo.plant_capacity_kw)})
              </span>
            )}
          </Row>
        )}
        <Row label="Financing">
          <FinancingBadge financing={wo?.financing_type} bank={wo?.loan_bank_name} />
        </Row>
        <Row label="Total cost">{formatCurrency(payment.totalCost)}</Row>
        <Row label="Received">{formatCurrency(payment.received)}</Row>
        <Row label="Payment">
          <PaymentBadge
            source={paymentSource}
            isCompleted={project.is_completed}
            cancellation={project.cancellation}
          />
        </Row>
        {incentive?.view === "own" && (
          <Row label="Your incentive">
            <IncentiveAmount
              incentive={incentive.amount}
              paidOn={incentive.paidOn}
              className="justify-end"
            />
          </Row>
        )}
        {incentive?.view === "sale" && (
          <Row label="Incentives">
            <IncentiveTotal
              total={incentive.total}
              count={incentive.count}
              unpaidCount={incentive.unpaidCount}
              className="justify-end"
            />
          </Row>
        )}
      </dl>
      <div className="pt-1 text-xs">
        <MapsLink address={wo?.address} />
      </div>
      {children}
    </Section>
  );
}
