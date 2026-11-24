import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  COMPLETED_LIST_LIMIT,
  SERVICE_TYPE_LABELS,
  type CompletedService,
} from "@/lib/domain/service-report";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The visits completed in the period, latest first, each linking to its
 * ticket. At most COMPLETED_LIST_LIMIT rows; the CSV download has them all.
 */
export function ServicesCompletedList({
  services,
  periodLabel,
}: {
  services: CompletedService[];
  /** "November 2026 (so far)", "All time" — for the empty message. */
  periodLabel: string;
}) {
  if (services.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
        No service visits completed in {periodLabel}.
      </p>
    );
  }

  const shown = services.slice(0, COMPLETED_LIST_LIMIT);
  const more = services.length - shown.length;

  return (
    <div className="space-y-3">
      <Table className="tabular-nums">
        <caption className="sr-only">Completed service visits</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Ticket</TableHead>
            <TableHead scope="col">Service date</TableHead>
            <TableHead scope="col">Customer</TableHead>
            <TableHead scope="col">Engineer</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col" className="text-right">
              Charges
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="py-0">
                <Link
                  href={`/tickets/${s.id}`}
                  className="inline-flex min-h-10 items-center font-medium text-primary hover:underline"
                >
                  {s.ticketNo ?? s.id.slice(0, 8)}
                </Link>
              </TableCell>
              <TableCell>
                {formatDate(s.date)}
                {s.dateIsClosedDay && (
                  <span className="block text-xs text-muted-foreground">day closed</span>
                )}
              </TableCell>
              <TableCell className={cn(!s.clientName && "text-muted-foreground")}>
                {s.clientName ?? "No project linked"}
              </TableCell>
              <TableCell className={cn(s.engineerKind === "unassigned" && "italic")}>
                {s.engineer}
              </TableCell>
              <TableCell>{SERVICE_TYPE_LABELS[s.ticketType]}</TableCell>
              <TableCell className="text-right">{formatCurrency(s.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {more > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing the latest {shown.length} of {services.length} visits. Download the CSV
          for the full list.
        </p>
      )}
    </div>
  );
}
