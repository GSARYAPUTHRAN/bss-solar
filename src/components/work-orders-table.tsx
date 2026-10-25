"use client";

import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { DataTable, ServerDataTable } from "@/components/data-table";
import type { ColumnDef, FilterDef, SearchDef } from "@/components/data-table";
import { CoordinatorNames } from "@/components/coordinator-names";
import { EmptyState } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  CancellationBadge,
  FinancingBadge,
  PaymentBadge,
  PlanBadge,
  WorkOrderStatusBadge,
} from "@/components/status-badges";
import { PLAN_TYPE, PLAN_TYPES } from "@/lib/domain/plan";
import { FINANCING, statusOptions } from "@/lib/domain/status";
import { matchesCoordinator } from "@/lib/domain/project-list";
import { paymentSummary } from "@/lib/domain/payment";
import {
  isWorkOrderPaymentFilter,
  isWorkOrderStatusFilter,
  matchesWorkOrderPayment,
  matchesWorkOrderStatus,
  teamNote,
  workOrderStatusOptions,
} from "@/lib/domain/work-order-list";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Coordinator } from "@/server/data";
import type { WorkOrderListRow } from "@/lib/types";

/**
 * Secondary columns step aside below `md`: a coordinator on a phone sees the
 * client, the balance and the status without scrolling sideways.
 */
const WIDE_ONLY = "hidden md:table-cell";

const PLAN_OPTIONS = PLAN_TYPES.map((value) => ({ value, label: PLAN_TYPE[value].label }));

export function WorkOrdersTable({
  workOrders,
  coordinators,
  isAdmin,
  viewerId,
  server,
  noun = "work orders",
}: {
  workOrders: WorkOrderListRow[];
  /** Everyone who can own a sale — the office's coordinator filter. */
  coordinators: Coordinator[];
  isAdmin: boolean;
  /**
   * The signed-in person, so a coordinator's phone line leaves themself out.
   * The office (`isAdmin`) reads every name and needs none.
   */
  viewerId?: string;
  server?: { total: number; page: number; pageSize: number };
  /** Plural noun for the pagination summary ("latest work orders" on the dashboard slice). */
  noun?: string;
}) {
  const columns: ColumnDef<WorkOrderListRow>[] = [
    {
      id: "client_name",
      header: "Client",
      sortable: true,
      sortKey: "client_name",
      sortAccessor: (w) => w.client_name.toLowerCase(),
      cell: (w) => {
        const team = teamNote(w, { id: viewerId ?? "", office: isAdmin });
        return (
          <>
            <span className="font-medium hover:underline">{w.client_name}</span>
            <div className="text-xs text-muted-foreground">
              <span className="md:hidden">{w.plant_capacity} · </span>
              {w.consumer_number ?? w.client_phone ?? "—"}
              {team && <span className="md:hidden"> · {team}</span>}
            </div>
          </>
        );
      },
    },
    {
      id: "coordinator",
      header: "Coordinators",
      className: WIDE_ONLY,
      headerClassName: WIDE_ONLY,
      cell: (w) => <CoordinatorNames names={w.coordinator_names ?? []} />,
    },
    {
      id: "capacity",
      header: "Capacity",
      className: WIDE_ONLY,
      headerClassName: WIDE_ONLY,
      cell: (w) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {w.plant_capacity}
          <PlanBadge plan={w.plan_type} />
        </span>
      ),
    },
    {
      id: "financing",
      header: "Financing",
      className: WIDE_ONLY,
      headerClassName: WIDE_ONLY,
      cell: (w) => (
        <FinancingBadge financing={w.financing_type} bank={w.loan_bank_name} />
      ),
    },
    {
      id: "advance_amount",
      header: "Advance",
      className: `${WIDE_ONLY} text-right tabular-nums`,
      headerClassName: `${WIDE_ONLY} text-right`,
      cell: (w) => formatCurrency(w.advance_amount),
    },
    {
      id: "total_cost",
      header: "Total",
      sortable: true,
      sortKey: "total_cost",
      sortAccessor: (w) => Number(w.total_cost ?? 0),
      className: `${WIDE_ONLY} text-right tabular-nums`,
      headerClassName: `${WIDE_ONLY} text-right`,
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
      cell: (w) =>
        // A cancelled or refunded sale is owed nothing, whatever its ledger says.
        w.cancellation ? (
          <span className="text-muted-foreground" title={`Nothing due — ${w.cancellation}`}>
            —
          </span>
        ) : (
          formatCurrency(paymentSummary(w).balanceDue)
        ),
    },
    {
      id: "order_date",
      header: "Order Date",
      sortable: true,
      sortKey: "order_date",
      sortAccessor: (w) => new Date(w.order_date).getTime(),
      className: WIDE_ONLY,
      headerClassName: WIDE_ONLY,
      cell: (w) => formatDate(w.order_date),
    },
    {
      id: "status",
      header: "Status",
      cell: (w) => (
        <div className="flex flex-col items-start gap-1">
          <WorkOrderStatusBadge status={w.status} />
          {w.cancellation ? (
            <CancellationBadge cancellation={w.cancellation} />
          ) : (
            w.status === "approved" && (
              <PaymentBadge source={w} isCompleted={w.is_completed} />
            )
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
      widthClass: "sm:w-48",
      // Every viewer may filter their own cancelled and refunded sales too.
      options: [{ value: "all", label: "All statuses" }, ...workOrderStatusOptions()],
      predicate: (w, v) => isWorkOrderStatusFilter(v) && matchesWorkOrderStatus(w, v),
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
      predicate: (w, v) => isWorkOrderPaymentFilter(v) && matchesWorkOrderPayment(w, v),
    },
    {
      id: "financing",
      placeholder: "Financing",
      column: "financing_type",
      options: [
        { value: "all", label: "Any financing" },
        ...statusOptions(FINANCING),
      ],
      predicate: (w, v) => w.financing_type === v,
    },
    {
      id: "plan",
      placeholder: "Plan",
      column: "plan_type",
      options: [{ value: "all", label: "Any plan" }, ...PLAN_OPTIONS],
      predicate: (w, v) => w.plan_type === v,
    },
    {
      id: "coordinator",
      placeholder: "Coordinator",
      column: "coordinator_ids",
      widthClass: "sm:w-52",
      hidden: !isAdmin,
      options: [
        { value: "all", label: "All coordinators" },
        ...coordinators.map((c) => ({ value: c.id, label: c.full_name })),
      ],
      // Anyone on the sale, not only the coordinator who logged it.
      predicate: (w, v) => matchesCoordinator(w, v),
    },
  ];

  const search: SearchDef<WorkOrderListRow> = {
    placeholder: "Search client, phone, consumer no.…",
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
        noun={noun}
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
      noun={noun}
      emptyMessage="No work orders found."
      emptyState={emptyState}
      getRowHref={(w) => `/work-orders/${w.id}`}
    />
  );
}
