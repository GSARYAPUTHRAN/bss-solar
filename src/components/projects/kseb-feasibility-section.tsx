import { Landmark } from "lucide-react";
import { Section } from "@/components/layout";
import { FeasibilityBadge } from "@/components/status-badges";
import { STAGE_LABELS } from "@/lib/constants";
import { formatKw } from "@/lib/domain/capacity";
import {
  KSEB_FEES,
  customerKsebFees,
  type FeasibilityStatus,
} from "@/lib/domain/kseb";
import { FEASIBILITY_CAPTURE_STAGE } from "@/lib/domain/project-progress";
import { formatCurrency, formatDate } from "@/lib/format";
import type { PlanType, ProjectCancellation } from "@/lib/types";
import { cn } from "@/lib/utils";

/** One label/value line of a breakdown. */
function Line({
  label,
  value,
  emphasis = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-1.5",
        emphasis && "border-t pt-2 font-semibold",
      )}
    >
      <dt className={cn(!emphasis && "text-muted-foreground")}>{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function daysLeftLabel(
  status: FeasibilityStatus,
  stoppedBy: ProjectCancellation | null,
): string {
  if (status.state === "closed") {
    return stoppedBy ? `Stopped — project ${stoppedBy}` : "Closed at commissioning";
  }
  if (status.daysLeft === null) return "—";
  if (status.daysLeft <= 0) return "Expires today";
  return `${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"}`;
}

/**
 * The KSEB side of a project: the feasibility validity clock (and what BSS has
 * paid to keep it alive), and what the customer owes KSEB — the feasibility fee
 * plus registration at ₹1,000 per kW + GST.
 *
 * A custom plan has no KSEB process, so there is nothing to show but that. A
 * cancelled or refunded project's clock has stopped (`cancellation`): what is
 * shown is where it stopped, with the renewals BSS already bore.
 */
export function KsebFeasibilitySection({
  feasibility,
  feasibilityDate,
  capacityKw,
  capacityLabel,
  ksebCollected,
  plan = "solar",
  cancellation = null,
  isCompleted = false,
  className,
}: {
  feasibility: FeasibilityStatus;
  feasibilityDate: string | null;
  capacityKw: number | null;
  capacityLabel: string | null;
  /** Σ KSEB-fee entries recorded in the payments ledger. */
  ksebCollected: number;
  plan?: PlanType;
  /** Cancelled or refunded (the clock stopped there, unless commissioning came first). */
  cancellation?: ProjectCancellation | null;
  isCompleted?: boolean;
  className?: string;
}) {
  if (plan === "custom") {
    return (
      <Section title="KSEB & Feasibility" icon={Landmark} className={className}>
        <p className="text-sm text-muted-foreground">
          Custom plan — no KSEB registration or feasibility.
        </p>
      </Section>
    );
  }

  const fees = customerKsebFees(capacityKw);
  const gstPct = Math.round(KSEB_FEES.gstRate * 100);
  const stoppedBy = isCompleted ? null : cancellation;

  return (
    <Section
      title="KSEB & Feasibility"
      icon={Landmark}
      actions={<FeasibilityBadge status={feasibility} />}
      className={className}
      contentClassName="grid gap-6 text-sm lg:grid-cols-2"
    >
      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Feasibility validity
        </h3>
        <dl>
          <Line
            label="Feasibility date"
            value={feasibilityDate ? formatDate(feasibilityDate) : "Not captured yet"}
          />
          <Line label="Valid until" value={formatDate(feasibility.validUntil)} />
          <Line label="Days left" value={daysLeftLabel(feasibility, stoppedBy)} />
          <Line label="Renewals" value={feasibility.renewals} />
          <Line
            label="BSS extension cost"
            value={formatCurrency(feasibility.extensionCost)}
            emphasis
          />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Valid for {KSEB_FEES.feasibilityValidityDays} days. Each further{" "}
          {KSEB_FEES.feasibilityValidityDays} days until commissioning or
          cancellation costs BSS{" "}
          {formatCurrency(KSEB_FEES.feasibilityRenewalFee)}. The date is captured
          automatically when “{STAGE_LABELS[FEASIBILITY_CAPTURE_STAGE]}” is
          completed.
        </p>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Customer KSEB fees
        </h3>
        <dl>
          <Line label="Feasibility fee" value={formatCurrency(fees.feasibility)} />
          {fees.registration ? (
            <>
              <Line
                label={`Registration · ${formatKw(fees.registration.kw)} × ${formatCurrency(KSEB_FEES.registrationFeePerKw)}`}
                value={formatCurrency(fees.registration.base)}
              />
              <Line
                label={`GST ${gstPct}% on registration`}
                value={formatCurrency(fees.registration.gst)}
              />
            </>
          ) : (
            <Line label="Registration" value="Capacity not in kW" />
          )}
          <Line
            label="Total payable by customer"
            value={fees.total === null ? "—" : formatCurrency(fees.total)}
            emphasis
          />
          <Line label="Collected through BSS" value={formatCurrency(ksebCollected)} />
        </dl>
        {!fees.registration && (
          <p className="mt-2 text-xs text-muted-foreground">
            “{capacityLabel || "No capacity"}” has no kW figure, so registration
            cannot be priced. Correct the plant capacity on the work order.
          </p>
        )}
      </div>
    </Section>
  );
}
