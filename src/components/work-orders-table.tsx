"use client";

import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { EmptyState } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { PaymentBadge, WorkOrderStatusBadge } from "@/components/status-badges";
import { WORK_ORDER_STATUS, statusOptions } from "@/lib/domain/status";
import { paymentSummary } from "@/lib/domain/payment";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Coordinator } from "@/server/data";
import type { WorkOrderListRow } from "@/lib/types";

export function WorkOrdersTable({
  workOrders,
  coordinators,
  isAdmin,
  server,
}: {
  workOrders: WorkOrderListRow[];
  coordinators: Coordinator[];
  isAdmin: boolean;
  server?: { total: number; page: number; pageSize: number };
}) {
  const columns: ColumnDef<WorkOrderListRow>[] = [
    {
      id: "client_name",
      header: "Client",
      sortable: true,
      sortKey: "client_name",
      sortAccessor: (w) => w.client_name.toLowerCase(),
      cell: (w) => (
        <>
          <span className="font-medium hover:underline">{w.client_name}</span>
          <div className="text-xs text-muted-foreground">
            {w.consumer_number ?? w.client_phone ?? "—"}
          </div>
        </>
      ),
    },
    {
      id: "coordinator",
      header: "Coordinator",
      hidden: !isAdmin,
      cell: (w) => w.coordinator_name ?? "—",
    },
    { id: "capacity", header: "Capacity", cell: (w) => w.plant_capacity },
    {
      id: "advance_amount",
      header: "Advance",
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (w) => formatCurrency(w.advance_amount),
    },
    {
      id: "total_cost",
      header: "Total",
      sortable: true,
      sortKey: "total_cost",
      sortAccessor: (w) => Number(w.total_cost ?? 0),
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (w) => formatCurrency(w.total_cost),
    },
    {
      id: "balance_due",
      header: "Balance",
      sortable: true,
      sortKey: "balance_due",
      sortAccessor: (w) => paymentSummary(w).balanceDue,
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: (w) => formatCurrency(paymentSummary(w).balanceDue),
    },
    {
      id: "order_date",
      header: "Order Date",
      sortable: true,
      sortKey: "order_date",
      sortAccessor: (w) => new Date(w.order_date).getTime(),
      cell: (w) => formatDate(w.order_date),
    },
    {
      id: "status",
      header: "Status",
      cell: (w) => (
        <div className="flex flex-col items-start gap-1">
          <WorkOrderStatusBadge status={w.status} />
          {w.status === "approved" && (
            <PaymentBadge source={w} isCompleted={w.is_completed} />
          )}
        </div>
      ),
    },
  ];

  const filters: FilterDef<WorkOrderListRow>[] = [
    {
      id: "status",
      placeholder: "Status",
      column: "status",
      options: [
        { value: "all", label: "All statuses" },
        ...statusOptions(WORK_ORDER_STATUS),
      ],
      predicate: (w, v) => w.status === v,
    },
    {
      id: "payment",
      placeholder: "Payment",
      widthClass: "sm:w-48",
      options: [
        { value: "all", label: "Any payment state" },
        { value: "pending", label: "Balance outstanding" },
        { value: "settled", label: "Paid in full" },
      ],
      predicate: (w, v) =>
        v === "pending"
          ? !paymentSummary(w).isSettled
          : paymentSummary(w).isSettled,
    },
    {
      id: "coordinator",
      placeholder: "Coordinator",
      column: "coordinator_id",
      widthClass: "sm:w-52",
      hidden: !isAdmin,
      options: [
        { value: "all", label: "All coordinators" },
        ...coordinators.map((c) => ({ value: c.id, label: c.full_name })),
      ],
      predicate: (w, v) => w.coordinator_id === v,
    },
  ];

  const search: SearchDef<WorkOrderListRow> = {
    placeholder: "Search client, phone, consumer no., address…",
    columns: [
      "client_name",
      "client_phone",
      "address",
      "coordinator_name",
      "consumer_number",
    ],
    predicate: (w, q) =>
      w.client_name.toLowerCase().includes(q) ||
      (w.client_phone ?? "").toLowerCase().includes(q) ||
      (w.address ?? "").toLowerCase().includes(q) ||
      (w.coordinator_name ?? "").toLowerCase().includes(q) ||
      (w.consumer_number ?? "").toLowerCase().includes(q),
  };

  const emptyState = (
    <EmptyState
      icon={ClipboardList}
      title="No work orders yet"
      description="Log business captured in the field to start the KSEB/ANERT pipeline."
      action={
        <Button asChild>
          <Link href="/work-orders/new">
            <Plus className="mr-2 h-4 w-4" /> New Work Order
          </Link>
        </Button>
      }
    />
  );

  if (server) {
    return (
      <ServerDataTable
        rows={workOrders}
        total={server.total}
        page={server.page}
        pageSize={server.pageSize}
        columns={columns}
        filters={filters}
        search={search}
        noun="work orders"
        emptyMessage="No work orders found."
        emptyState={emptyState}
        defaultSort={{ key: "order_date", asc: false }}
        getRowHref={(w) => `/work-orders/${w.id}`}
      />
    );
  }

  return (
    <DataTable
      data={workOrders}
      columns={columns}
      filters={filters}
      search={search}
      initialSort={{ id: "order_date", asc: false }}
      noun="work orders"
      emptyMessage="No work orders found."
      emptyState={emptyState}
      getRowHref={(w) => `/work-orders/${w.id}`}
    />
  );
}
