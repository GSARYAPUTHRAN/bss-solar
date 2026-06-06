import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  STAGE_LABELS,
  TICKET_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from "@/lib/constants";
import type {
  ProjectStage,
  TicketStatus,
  WorkOrderStatus,
} from "@/lib/types";

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const styles: Record<WorkOrderStatus, string> = {
    pending: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    approved: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    rejected: "bg-red-100 text-red-800 hover:bg-red-100",
  };
  return (
    <Badge className={cn("border-transparent", styles[status])}>
      {WORK_ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const styles: Record<TicketStatus, string> = {
    open: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    scheduled: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    in_progress: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100",
    completed: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    cancelled: "bg-gray-100 text-gray-700 hover:bg-gray-100",
  };
  return (
    <Badge className={cn("border-transparent", styles[status])}>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

export function StageBadge({ stage }: { stage: ProjectStage }) {
  return (
    <Badge variant="outline" className="font-normal">
      {STAGE_LABELS[stage]}
    </Badge>
  );
}
