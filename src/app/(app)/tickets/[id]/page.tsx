import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, Pencil } from "lucide-react";
import { requireTicketRole } from "@/lib/auth";
import { ticketsRepository } from "@/server/data";
import { deleteTicket } from "../actions";
import {
  Page,
  PageHeader,
  Section,
  Field,
  FieldGrid,
  FormError,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { TicketStatusBadge } from "@/components/status-badges";
import { AssigneeLabel } from "@/components/tickets/assignee-label";
import { AddressLink, PhoneLink } from "@/components/tickets/contact-links";
import { ScheduleHint } from "@/components/tickets/schedule-hint";
import { ServiceReportButton } from "@/components/tickets/service-report-button";
import { ServiceSheetView } from "@/components/tickets/service-sheet-view";
import { SiteCard } from "@/components/tickets/site-card";
import { TicketStatusActions } from "@/components/tickets/ticket-status-actions";
import { isServiceEngineerRole } from "@/lib/domain/role";
import { isActiveTicket } from "@/lib/domain/ticket-workflow";
import { formatDate, todayISO } from "@/lib/format";
import { TICKET_TYPE_LABELS } from "@/lib/constants";

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireTicketRole();
  const { id } = await params;
  const { error } = await searchParams;

  return isServiceEngineerRole(profile.role) ? (
    <EngineerTicketDetail id={id} error={error} />
  ) : (
    <OfficeTicketDetail id={id} error={error} />
  );
}

/**
 * The engineer's job sheet: site details come from engineer_tickets() (they
 * cannot read the work order), the service sheet from their own ticket row.
 * Status is the only thing they can change; the sheet and charges are read-only.
 */
async function EngineerTicketDetail({ id, error }: { id: string; error?: string }) {
  const [job, ticket] = await Promise.all([
    ticketsRepository.engineerTicket(id),
    ticketsRepository.byId(id),
  ]);
  // Not assigned to them (or gone): indistinguishable from not found, by design.
  if (!job || !ticket) notFound();

  const today = todayISO();

  return (
    <Page size="wide">
      <PageHeader
        title={job.ticket_no ?? "Service Ticket"}
        description={`${TICKET_TYPE_LABELS[job.ticket_type]} · ${job.client_name ?? "No project linked"}`}
        backHref="/tickets"
      >
        <ServiceReportButton
          ticket={ticket}
          client={{
            client_name: job.client_name ?? "",
            address: job.address,
            client_phone: job.client_phone,
          }}
          className="h-10"
        />
      </PageHeader>

      <FormError message={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <Section
          title="Job"
          icon={ClipboardList}
          actions={<TicketStatusBadge status={job.status} />}
          contentClassName="space-y-5"
        >
          <FieldGrid cols={2}>
            <Field
              label="Scheduled"
              value={
                <ScheduleHint
                  status={job.status}
                  scheduledDate={job.scheduled_date}
                  today={today}
                />
              }
            />
            <Field label="Service date" value={formatDate(job.service_date)} />
          </FieldGrid>
          <Field label="Complaint / reason" value={job.nature_of_complaint} />
          {isActiveTicket(job.status) ? (
            <TicketStatusActions
              ticketId={job.id}
              ticketNo={job.ticket_no}
              status={job.status}
              size="large"
            />
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              This ticket is closed. Contact the office if it needs more work.
            </p>
          )}
        </Section>

        <SiteCard site={job} />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Service sheet</h2>
        <p className="text-sm text-muted-foreground">
          Recorded by the office — share your readings and findings with them to
          update it.
        </p>
      </div>
      <ServiceSheetView ticket={ticket} hideComplaint />
    </Page>
  );
}

async function OfficeTicketDetail({ id, error }: { id: string; error?: string }) {
  const ticket = await ticketsRepository.byId(id);
  if (!ticket) notFound();

  const client = ticket.project?.work_order;

  return (
    <Page size="wide">
      <PageHeader
        title={ticket.ticket_no ?? "Service Ticket"}
        description={`${TICKET_TYPE_LABELS[ticket.ticket_type]} · ${client?.client_name ?? "No project linked"}`}
        backHref="/tickets"
      >
        <Button variant="outline" asChild>
          <Link href={`/tickets/${ticket.id}/edit`}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Link>
        </Button>
        <ServiceReportButton ticket={ticket} />
      </PageHeader>

      <FormError message={error} />

      <div className="space-y-4">
        <Section
          title="Overview"
          actions={<TicketStatusBadge status={ticket.status} />}
        >
          <FieldGrid cols={3}>
            <Field label="Client" value={client?.client_name} />
            <Field label="Phone" value={<PhoneLink phone={client?.client_phone} />} />
            <Field
              label="Engineer"
              value={
                <AssigneeLabel
                  name={ticket.assignee?.full_name}
                  status={ticket.status}
                />
              }
            />
            <Field label="Scheduled" value={formatDate(ticket.scheduled_date)} />
            <Field label="Service Date" value={formatDate(ticket.service_date)} />
            <Field label="Address" value={<AddressLink address={client?.address} />} />
          </FieldGrid>
        </Section>

        <ServiceSheetView ticket={ticket} />

        <div className="flex justify-end">
          <ConfirmSubmit
            action={deleteTicket}
            fields={{ id: ticket.id }}
            triggerLabel="Delete Ticket"
            triggerVariant="ghost"
            triggerClassName="text-destructive hover:text-destructive"
            title="Delete this service ticket?"
            description="This permanently removes the ticket and its service sheet. This cannot be undone."
            confirmLabel="Delete ticket"
            loadingText="Deleting…"
          />
        </div>
      </div>
    </Page>
  );
}
