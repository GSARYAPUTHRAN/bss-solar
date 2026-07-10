"use client";

import Link from "next/link";
import { Wrench, Plus } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { EmptyState } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TicketStatusBadge } from "@/components/status-badges";
import { TICKET_TYPE_LABELS } from "@/lib/constants";
import { TICKET_STATUS, statusOptions } from "@/lib/domain/status";
import { formatCurrency, formatDate } from "@/lib/format";
import type { TicketListRow, TicketType } from "@/lib/types";

export function TicketsTable({
  tickets,
  server,
}: {
  tickets: TicketListRow[];
  server?: { total: number; page: number; pageSize: number };
}) {
  const columns: ColumnDef<TicketListRow>[] = [
    {
      id: "ticket_no",
      header: "Ticket No.",
      sortable: true,
      sortKey: "ticket_no",
      sortAccessor: (t) => t.ticket_no ?? "",
      cell: (t) => (
        <span className="font-medium hover:underline">
          {t.ticket_no ?? t.id.slice(0, 8)}
        </span>
      ),
    },
    {
      id: "client",
      header: "Client",
      cell: (t) => t.client_name ?? "—",
    },
    {
      id: "type",
      header: "Type",
      cell: (t) => (
        <Badge variant="outline" className="font-normal">
          {TICKET_TYPE_LABELS[t.ticket_type]}
        </Badge>
      ),
    },
    {
      id: "scheduled",
      header: "Scheduled",
      sortable: true,
      sortKey: "scheduled_date",
      sortAccessor: (t) => t.scheduled_date ?? "",
      cell: (t) => formatDate(t.scheduled_date),
    },
    {
      id: "total",
      header: "Total",
      sortable: true,
      sortKey: "total",
      sortAccessor: (t) => Number(t.total ?? 0),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (t) => formatCurrency(t.total),
    },
    {
      id: "status",
      header: "Status",
      cell: (t) => <TicketStatusBadge status={t.status} />,
    },
  ];

  const filters: FilterDef<TicketListRow>[] = [
    {
      id: "type",
      placeholder: "Type",
      column: "ticket_type",
      widthClass: "sm:w-48",
      options: [
        { value: "all", label: "All types" },
        ...(Object.keys(TICKET_TYPE_LABELS) as TicketType[]).map((t) => ({
          value: t,
          label: TICKET_TYPE_LABELS[t],
        })),
      ],
      predicate: (t, v) => t.ticket_type === v,
    },
    {
      id: "status",
      placeholder: "Status",
      column: "status",
      options: [
        { value: "all", label: "All statuses" },
        ...statusOptions(TICKET_STATUS),
      ],
      predicate: (t, v) => t.status === v,
    },
  ];

  const search: SearchDef<TicketListRow> = {
    placeholder: "Search ticket no. or client…",
    columns: ["ticket_no", "client_name"],
    predicate: (t, q) =>
      (t.ticket_no ?? "").toLowerCase().includes(q) ||
      (t.client_name ?? "").toLowerCase().includes(q),
  };

  const emptyState = (
    <EmptyState
      icon={Wrench}
      title="No service tickets yet"
      description="Raise a routine 6-month check or an ad-hoc service request for a commissioned site."
      action={
        <Button asChild>
          <Link href="/tickets/new">
            <Plus className="mr-2 h-4 w-4" /> New Ticket
          </Link>
        </Button>
      }
    />
  );

  if (server) {
    return (
      <ServerDataTable
        rows={tickets}
        total={server.total}
        page={server.page}
        pageSize={server.pageSize}
        columns={columns}
        filters={filters}
        search={search}
        noun="tickets"
        emptyMessage="No tickets found."
        emptyState={emptyState}
        defaultSort={{ key: "created_at", asc: false }}
        getRowHref={(t) => `/tickets/${t.id}`}
      />
    );
  }

  return (
    <DataTable
      data={tickets}
      columns={columns}
      filters={filters}
      search={search}
      noun="tickets"
      emptyMessage="No tickets found."
      emptyState={emptyState}
      getRowHref={(t) => `/tickets/${t.id}`}
    />
  );
}
