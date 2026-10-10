import { isActiveTicket } from "@/lib/domain/ticket-workflow";
import type { TicketStatus } from "@/lib/types";

/**
 * Who holds a ticket. "Unassigned" is flagged only while the ticket still
 * needs work — open work that nobody holds needs the office's attention.
 */
export function AssigneeLabel({
  name,
  status,
}: {
  name: string | null | undefined;
  status: TicketStatus;
}) {
  if (name) return <>{name}</>;
  return (
    <span
      className={
        isActiveTicket(status)
          ? "font-medium text-amber-700 dark:text-amber-300"
          : "text-muted-foreground"
      }
    >
      Unassigned
    </span>
  );
}
