import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { ticketsRepository } from "@/server/data";
import { Page, PageHeader, FormError } from "@/components/layout";
import { ServiceTicketForm } from "@/components/service-ticket-form";

export default async function EditTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;

  const ticket = await ticketsRepository.byId(id);
  if (!ticket) notFound();

  return (
    <Page size="wide">
      <PageHeader
        title={`Service Sheet — ${ticket.ticket_no ?? ""}`}
        description="Capture the technical field measurements and resolution."
        backHref={`/tickets/${ticket.id}`}
      />

      <FormError message={error} />

      <ServiceTicketForm ticket={ticket} />
    </Page>
  );
}
