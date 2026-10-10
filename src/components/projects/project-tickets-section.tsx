import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { EmptyState, Section } from "@/components/layout";
import { TicketStatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { TICKET_TYPE_LABELS } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ServiceTicket } from "@/lib/types";

export type ProjectTicket = Pick<
  ServiceTicket,
  "id" | "ticket_no" | "ticket_type" | "status" | "scheduled_date" | "total"
>;

/** Service tickets raised against a project (office view). */
export function ProjectTicketsSection({
  projectId,
  tickets,
}: {
  projectId: string;
  tickets: ProjectTicket[];
}) {
  return (
    <Section
      title="Service Tickets"
      actions={
        <Button size="sm" asChild>
          <Link href={`/tickets/new?project_id=${projectId}`}>
            <Plus className="mr-2 h-4 w-4" /> New Ticket
          </Link>
        </Button>
      }
    >
      {tickets.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No service tickets yet"
          description="Service tickets raised for this project will appear here."
        />
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tickets/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:border-primary/60 hover:bg-accent/50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t.ticket_no ?? t.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">
                      {TICKET_TYPE_LABELS[t.ticket_type]} · {formatDate(t.scheduled_date)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums">{formatCurrency(t.total)}</span>
                  <TicketStatusBadge status={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
