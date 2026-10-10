import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-badge";
import { STAGE_LABELS } from "@/lib/constants";
import {
  FEASIBILITY_STATE,
  FINANCING,
  TICKET_STATUS,
  WORK_ORDER_STATUS,
} from "@/lib/domain/status";
import { paymentSummary, type PaymentSource } from "@/lib/domain/payment";
import type { FeasibilityStatus } from "@/lib/domain/kseb";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  FinancingType,
  ProjectStage,
  TicketStatus,
  WorkOrderStatus,
} from "@/lib/types";

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <StatusBadge registry={WORK_ORDER_STATUS} value={status} />;
}

/** Self-financed vs bank loan (with the bank, when known). */
export function FinancingBadge({
  financing,
  bank,
  className,
}: {
  financing: FinancingType | null | undefined;
  bank?: string | null;
  className?: string;
}) {
  const meta = FINANCING[financing ?? "self"];
  return (
    <Badge className={cn("border-transparent", meta.badgeClass, className)}>
      {financing === "loan" && bank ? `Loan · ${bank}` : meta.label}
    </Badge>
  );
}

/**
 * Feasibility clock state (see lib/domain/kseb.ts). Shows the days left while it
 * matters, and the renewal count once BSS is paying extensions.
 */
export function FeasibilityBadge({
  status,
  className,
}: {
  status: Pick<FeasibilityStatus, "state" | "daysLeft" | "renewals">;
  className?: string;
}) {
  const meta = FEASIBILITY_STATE[status.state];
  let label = meta.label;
  if (status.state === "expiring" && status.daysLeft !== null) {
    label =
      status.daysLeft <= 0
        ? "Feasibility expires today"
        : `Feasibility · ${status.daysLeft}d left`;
  } else if (status.state === "extended") {
    label = `Extended ×${status.renewals}`;
  } else if (status.state === "closed" && status.renewals > 0) {
    label = `Closed · ${status.renewals} renewal${status.renewals === 1 ? "" : "s"}`;
  }
  return (
    <Badge className={cn("border-transparent", meta.badgeClass, className)}>
      {label}
    </Badge>
  );
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <StatusBadge registry={TICKET_STATUS} value={status} />;
}

export function StageBadge({ stage }: { stage: ProjectStage }) {
  return (
    <Badge variant="outline" className="font-normal">
      {STAGE_LABELS[stage]}
    </Badge>
  );
}

/**
 * Collection state for a work order / project.
 *
 * A commissioned plant with an outstanding balance is the case the business
 * cares about most, so it reads as an alert rather than a neutral figure.
 */
export function PaymentBadge({
  source,
  isCompleted,
  className,
}: {
  source: PaymentSource;
  isCompleted?: boolean | null;
  className?: string;
}) {
  const { balanceDue, isSettled } = paymentSummary(source);

  if (isSettled) {
    return (
      <Badge
        className={cn(
          "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
          className,
        )}
      >
        Paid in full
      </Badge>
    );
  }

  if (isCompleted) {
    return (
      <Badge
        className={cn(
          "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
          className,
        )}
      >
        Payment pending · {formatCurrency(balanceDue)}
      </Badge>
    );
  }

  return (
    <Badge
      className={cn(
        "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
        className,
      )}
    >
      Balance {formatCurrency(balanceDue)}
    </Badge>
  );
}
