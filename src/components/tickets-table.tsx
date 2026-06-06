"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TicketStatusBadge } from "@/components/status-badges";
import { formatCurrency, formatDate } from "@/lib/format";
import { TICKET_STATUS_LABELS, TICKET_TYPE_LABELS } from "@/lib/constants";
import type { ServiceTicket, TicketStatus, TicketType } from "@/lib/types";

export function TicketsTable({ tickets }: { tickets: ServiceTicket[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");

  const filtered = useMemo(() => {
    let rows = [...tickets];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (t) =>
          (t.ticket_no ?? "").toLowerCase().includes(q) ||
          (t.project?.work_order?.client_name ?? "")
            .toLowerCase()
            .includes(q),
      );
    }
    if (status !== "all") rows = rows.filter((t) => t.status === status);
    if (type !== "all") rows = rows.filter((t) => t.ticket_type === type);
    return rows;
  }, [tickets, search, status, type]);

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ticket no. or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.keys(TICKET_TYPE_LABELS) as TicketType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TICKET_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket No.</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  No tickets found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link
                      href={`/tickets/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.ticket_no ?? t.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {t.project?.work_order?.client_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">
                      {TICKET_TYPE_LABELS[t.ticket_type]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(t.scheduled_date)}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(t.total)}
                  </TableCell>
                  <TableCell>
                    <TicketStatusBadge status={t.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {filtered.length} of {tickets.length} tickets
      </p>
    </Card>
  );
}
