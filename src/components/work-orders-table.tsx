"use client";

import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { DataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { WorkOrderStatusBadge } from "@/components/status-badges";
import { WORK_ORDER_STATUS, statusOptions } from "@/lib/domain/status";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Coordinator } from "@/server/data";
import type { WorkOrder } from "@/lib/types";

export function WorkOrdersTable({
  workOrders,
  coordinators,
  isAdmin,
}: {
  workOrders: WorkOrder[];
  coordinators: Coordinator[];
  isAdmin: boolean;
}) {
  const columns: ColumnDef<WorkOrder>[] = [
    {
      id: "client",
      header: "Client",
      cell: (w) => (
        <>
          <span className="font-medium hover:underline">{w.client_name}</span>
          <div className="text-xs text-muted-foreground">
            {w.client_phone ?? "—"}
          </div>
        </>
      ),
    },
    {
      id: "coordinator",
      header: "Coordinator",
      hidden: !isAdmin,
      cell: (w) => w.coordinator?.full_name ?? "—",
    },
    { id: "capacity", header: "Capacity", cell: (w) => w.plant_capacity },
    {
      id: "advance",
      header: "Advance",
      className: "text-right",
      headerClassName: "text-right",
      cell: (w) => formatCurrency(w.advance_amount),
    },
    {
      id: "total",
      header: "Total",
      className: "text-right",
      headerClassName: "text-right",
      cell: (w) => formatCurrency(w.total_cost),
    },
    {
      id: "order_date",
      header: "Order Date",
      sortable: true,
      sortAccessor: (w) => new Date(w.order_date).getTime(),
      cell: (w) => formatDate(w.order_date),
    },
    {
      id: "status",
      header: "Status",
      cell: (w) => <WorkOrderStatusBadge status={w.status} />,
    },
  ];

  const filters: FilterDef<WorkOrder>[] = [
    {
      id: "status",
      placeholder: "Status",
      options: [
        { value: "all", label: "All statuses" },
        ...statusOptions(WORK_ORDER_STATUS),
      ],
      predicate: (w, v) => w.status === v,
    },
    {
      id: "coordinator",
      placeholder: "Coordinator",
      widthClass: "sm:w-52",
      hidden: !isAdmin,
      options: [
        { value: "all", label: "All coordinators" },
        ...coordinators.map((c) => ({ value: c.id, label: c.full_name })),
      ],
      predicate: (w, v) => w.coordinator_id === v,
    },
  ];

  return (
    <DataTable
      data={workOrders}
      columns={columns}
      filters={filters}
      search={{
        placeholder: "Search client, phone, address…",
        predicate: (w, q) =>
          w.client_name.toLowerCase().includes(q) ||
          (w.client_phone ?? "").toLowerCase().includes(q) ||
          (w.address ?? "").toLowerCase().includes(q),
      }}
      initialSort={{ id: "order_date", asc: false }}
      noun="work orders"
      emptyMessage="No work orders found."
      emptyState={
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
      }
      getRowHref={(w) => `/work-orders/${w.id}`}
    />
  );
}
