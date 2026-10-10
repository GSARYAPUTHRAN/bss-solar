import { Section } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { FinancingBadge, PaymentBadge } from "@/components/status-badges";
import { STAGE_LABELS } from "@/lib/constants";
import { formatKw } from "@/lib/domain/capacity";
import type { PaymentSource, PaymentSummary } from "@/lib/domain/payment";
import { formatCurrency } from "@/lib/format";
import type { ProjectDetail } from "@/server/data/projects.repository";
import { IncentiveAmount } from "./incentive-badge";
import { MapsLink, PhoneLink } from "./contact-links";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * The project at a glance. The incentive row is rendered only when the caller
 * passes one — office staff and the owning coordinator (RLS already limits a
 * coordinator to their own projects; this keeps the intent explicit).
 */
export function ProjectSummaryCard({
  project,
  payment,
  paymentSource,
  progress,
  incentive,
  className,
  children,
}: {
  project: ProjectDetail;
  payment: PaymentSummary;
  /** What `payment` was computed from (for the payment badge). */
  paymentSource: PaymentSource;
  progress: { done: number; total: number };
  incentive?: { label: string; amount: number | null; paidOn: string | null };
  className?: string;
  /** Actions (advance, delete) rendered under the facts. */
  children?: React.ReactNode;
}) {
  const wo = project.work_order;

  return (
    <Section title="Project Summary" className={className} contentClassName="space-y-3 text-sm">
      <dl className="space-y-3">
        <Row label="Status">
          {project.is_completed ? (
            <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              Commissioned
            </Badge>
          ) : (
            <Badge variant="secondary">In Progress</Badge>
          )}
        </Row>
        <Row label="Current stage">{STAGE_LABELS[project.current_stage]}</Row>
        <Row label="Progress">
          {progress.done}/{progress.total}
        </Row>
        <Row label="Coordinator">{project.coordinator?.full_name ?? "—"}</Row>
        <Row label="Phone">
          <PhoneLink phone={wo?.client_phone} />
        </Row>
        <Row label="Capacity">
          {wo?.plant_capacity ?? "—"}
          {wo?.plant_capacity_kw != null && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({formatKw(wo.plant_capacity_kw)})
            </span>
          )}
        </Row>
        <Row label="Financing">
          <FinancingBadge financing={wo?.financing_type} bank={wo?.loan_bank_name} />
        </Row>
        <Row label="Total cost">{formatCurrency(payment.totalCost)}</Row>
        <Row label="Received">{formatCurrency(payment.received)}</Row>
        <Row label="Payment">
          <PaymentBadge source={paymentSource} isCompleted={project.is_completed} />
        </Row>
        {incentive && (
          <Row label={incentive.label}>
            <IncentiveAmount
              incentive={incentive.amount}
              paidOn={incentive.paidOn}
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
