import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { ticketsRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { TicketsTable } from "@/components/tickets-table";

export const metadata = { title: "Service Tickets" };

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();

  const params = parsePageParams(await searchParams, {
    filterKeys: ["type", "status"],
    defaultSort: "created_at",
    defaultDir: "desc",
  });
  const pageResult = await ticketsRepository.page(params);

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

      <TicketsTable
        tickets={pageResult.rows}
        server={{
          total: pageResult.total,
          page: pageResult.page,
          pageSize: pageResult.pageSize,
        }}
      />
    </Page>
  );
}
