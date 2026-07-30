import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-badge";
import { STAGE_LABELS } from "@/lib/constants";
import { TICKET_STATUS, WORK_ORDER_STATUS } from "@/lib/domain/status";
import { paymentSummary, type PaymentSource } from "@/lib/domain/payment";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ProjectStage,
  TicketStatus,
  WorkOrderStatus,
} from "@/lib/types";

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <StatusBadge registry={WORK_ORDER_STATUS} value={status} />;
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
