"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkOrderStatusBadge } from "@/components/status-badges";
import { formatCurrency, formatDate } from "@/lib/format";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/constants";
import type { WorkOrder, WorkOrderStatus } from "@/lib/types";

interface Coordinator {
  id: string;
  full_name: string;
}

export function WorkOrdersTable({
  workOrders,
  coordinators,
  isAdmin,
}: {
  workOrders: WorkOrder[];
  coordinators: Coordinator[];
  isAdmin: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [coordinator, setCoordinator] = useState<string>("all");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    let rows = [...workOrders];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (w) =>
          w.client_name.toLowerCase().includes(q) ||
          (w.client_phone ?? "").toLowerCase().includes(q) ||
          (w.address ?? "").toLowerCase().includes(q),
      );
    }
    if (status !== "all") rows = rows.filter((w) => w.status === status);
    if (coordinator !== "all")
      rows = rows.filter((w) => w.coordinator_id === coordinator);

    rows.sort((a, b) => {
      const da = new Date(a.order_date).getTime();
      const db = new Date(b.order_date).getTime();
      return sortAsc ? da - db : db - da;
    });
    return rows;
  }, [workOrders, search, status, coordinator, sortAsc]);

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search client, phone, address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(
              Object.keys(WORK_ORDER_STATUS_LABELS) as WorkOrderStatus[]
            ).map((s) => (
              <SelectItem key={s} value={s}>
                {WORK_ORDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <Select value={coordinator} onValueChange={setCoordinator}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder="Coordinator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All coordinators</SelectItem>
              {coordinators.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              {isAdmin && <TableHead>Coordinator</TableHead>}
              <TableHead>Capacity</TableHead>
              <TableHead className="text-right">Advance</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => setSortAsc((s) => !s)}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  Order Date <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 7 : 6}
                  className="h-24 text-center text-muted-foreground"
                >
                  No work orders found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((w) => (
                <TableRow key={w.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/work-orders/${w.id}`}
                      className="font-medium hover:underline"
                    >
                      {w.client_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {w.client_phone ?? "—"}
                    </div>
                  </TableCell>
                  {isAdmin && (
                    <TableCell>{w.coordinator?.full_name ?? "—"}</TableCell>
                  )}
                  <TableCell>{w.plant_capacity}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(w.advance_amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(w.total_cost)}
                  </TableCell>
                  <TableCell>{formatDate(w.order_date)}</TableCell>
                  <TableCell>
                    <WorkOrderStatusBadge status={w.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} of {workOrders.length} work orders
      </p>
    </Card>
  );
}
