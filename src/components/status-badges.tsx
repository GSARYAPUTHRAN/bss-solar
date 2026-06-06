import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-badge";
import { STAGE_LABELS } from "@/lib/constants";
import { TICKET_STATUS, WORK_ORDER_STATUS } from "@/lib/domain/status";
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
