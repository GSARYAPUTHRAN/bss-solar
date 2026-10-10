import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTicketRole } from "@/lib/auth";
import { profilesRepository, ticketsRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { isServiceEngineerRole } from "@/lib/domain/role";
import {
  ENGINEER_TICKET_SCOPES,
  parseEngineerScope,
} from "@/lib/domain/ticket-workflow";
import { todayISO } from "@/lib/format";
import { Page, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { TicketsTable } from "@/components/tickets-table";
import { EngineerTicketList } from "@/components/tickets/engineer-ticket-list";

export const metadata = { title: "Service Tickets" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const profile = await requireTicketRole();
  const sp = await searchParams;

  return isServiceEngineerRole(profile.role) ? (
    <EngineerTickets searchParams={sp} />
  ) : (
    <OfficeTickets searchParams={sp} />
  );
}

/** A service engineer's own worklist — RLS/engineer_tickets() scope it to them. */
async function EngineerTickets({ searchParams }: { searchParams: SearchParams }) {
  const scope = parseEngineerScope(
    Array.isArray(searchParams.show) ? searchParams.show[0] : searchParams.show,
  );
  const { statuses, sort, dir } = ENGINEER_TICKET_SCOPES[scope];
  const params = parsePageParams(searchParams, {
    filterKeys: ["type"],
    defaultSort: sort,
    defaultDir: dir,
  });
  const result = await ticketsRepository.pageForEngineer(params, statuses);

  return (
    <Page>
      <PageHeader
        title="My service tickets"
        description="Jobs assigned to you. Tap a ticket for site details, or start and complete work right from the list."
      />
      <EngineerTicketList
        result={result}
        scope={scope}
        q={params.q}
        today={todayISO()}
      />
    </Page>
  );
}

async function OfficeTickets({ searchParams }: { searchParams: SearchParams }) {
  const params = parsePageParams(searchParams, {
    filterKeys: ["type", "status", "engineer"],
    defaultSort: "created_at",
    defaultDir: "desc",
  });
  const [pageResult, engineers] = await Promise.all([
    ticketsRepository.page(params),
    profilesRepository.serviceEngineers(),
  ]);

  return (
    <Page>
      <PageHeader
        title="Service Tickets"
        description="Maintenance, 6-month checks and ad-hoc service requests, each assigned to a service engineer."
      >
        <Button asChild>
          <Link href="/tickets/new">
            <Plus className="mr-2 h-4 w-4" /> New Ticket
          </Link>
        </Button>
      </PageHeader>

      <TicketsTable
        tickets={pageResult.rows}
        engineers={engineers}
        server={{
          total: pageResult.total,
          page: pageResult.page,
          pageSize: pageResult.pageSize,
        }}
      />
    </Page>
  );
}
