import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { ticketsRepository } from "@/server/data";
import { Page, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { TicketsTable } from "@/components/tickets-table";

export const metadata = { title: "Service Tickets" };

export default async function TicketsPage() {
  await requireAdmin();

  const tickets = await ticketsRepository.list();

  return (
    <Page>
      <PageHeader
        title="Service Tickets"
        description="Maintenance, 6-month checks and ad-hoc service requests."
      >
        <Button asChild>
          <Link href="/tickets/new">
            <Plus className="mr-2 h-4 w-4" /> New Ticket
          </Link>
        </Button>
      </PageHeader>

      <TicketsTable tickets={tickets} />
    </Page>
  );
}
