import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TicketStatusBadge } from "@/components/status-badges";
import { TICKET_TYPE_LABELS } from "@/lib/constants";
import { AddressLink, PhoneLink } from "./contact-links";
import { ScheduleHint } from "./schedule-hint";
import { TicketStatusActions } from "./ticket-status-actions";
import type { EngineerTicketRow } from "@/lib/types";

/**
 * One job on an engineer's worklist, laid out for a phone: who and where at a
 * glance, one tap to call or navigate, and the next status step right on the
 * card. The header links to the full ticket; the other controls are separate
 * targets so nothing interactive is nested inside the link.
 */
export function EngineerTicketCard({
  ticket,
  today,
}: {
  ticket: EngineerTicketRow;
  today: string;
}) {
  const ticketLabel = ticket.ticket_no ?? "Service ticket";

  return (
    <Card className="gap-0 p-0">
      <Link
        href={`/tickets/${ticket.id}`}
        className="flex min-h-14 items-start justify-between gap-3 rounded-t-xl px-4 pt-4 pb-2 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Open ${ticketLabel} — ${ticket.client_name ?? "no client"}`}
      >
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            {ticketLabel} · {TICKET_TYPE_LABELS[ticket.ticket_type]}
          </p>
          <p className="truncate text-base font-semibold">
            {ticket.client_name ?? "No client linked"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <TicketStatusBadge status={ticket.status} />
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </Link>

      <div className="space-y-1 px-4 pb-4">
        <ScheduleHint
          status={ticket.status}
          scheduledDate={ticket.scheduled_date}
          today={today}
        />
        {ticket.nature_of_complaint && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {ticket.nature_of_complaint}
          </p>
        )}
        <div className="flex flex-col">
          <AddressLink address={ticket.address} />
          <PhoneLink phone={ticket.client_phone} />
        </div>
        <TicketStatusActions
          ticketId={ticket.id}
          ticketNo={ticket.ticket_no}
          status={ticket.status}
          className="pt-2"
        />
      </div>
    </Card>
  );
}
