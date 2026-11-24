import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EngineerServiceRow, ServiceCounts } from "@/lib/domain/service-report";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The first column stays put while the figures scroll sideways on a phone. */
const STICKY = "sticky left-0 z-10 bg-card";

const COLUMNS: { key: keyof ServiceCounts; label: string; title: string }[] = [
  { key: "completed", label: "Completed", title: "Visits completed in the period" },
  { key: "routine", label: "Routine", title: "Routine 6-month checks completed in the period" },
  { key: "adhoc", label: "Ad-hoc", title: "Ad-hoc visits completed in the period" },
  { key: "charges", label: "Charges billed", title: "Σ total of the completed visits" },
  { key: "openScheduled", label: "Open / scheduled", title: "Open or scheduled now" },
  { key: "inProgress", label: "In progress", title: "In progress now" },
  { key: "overdue", label: "Overdue", title: "Past their scheduled date now" },
  { key: "cancelled", label: "Cancelled", title: "Cancelled in the period" },
];

/** Which columns follow the period and which are "now". */
const NOW_COLUMNS = new Set<keyof ServiceCounts>(["openScheduled", "inProgress", "overdue"]);

function figure(key: keyof ServiceCounts, counts: ServiceCounts): string {
  return key === "charges" ? formatCurrency(counts.charges) : String(counts[key]);
}

function rowName(row: EngineerServiceRow): React.ReactNode {
  if (row.kind === "engineer") return row.name;
  if (row.kind === "unassigned") return <span className="italic">{row.name}</span>;
  return (
    <>
      {row.name}
      <span className="ml-1 text-xs text-muted-foreground">(no longer an engineer)</span>
    </>
  );
}

/**
 * Service visits per engineer: one row per service engineer (zeros too), the
 * former engineers and Unassigned when they have anything, and the totals —
 * which the rows add up to. Period columns first, then the "now" columns.
 */
export function ServicesEngineerTable({
  rows,
  total,
}: {
  rows: EngineerServiceRow[];
  total: ServiceCounts;
}) {
  return (
    <Table className="tabular-nums">
      <caption className="sr-only">Service visits per engineer</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className={STICKY}>
            Engineer
          </TableHead>
          {COLUMNS.map((c) => (
            <TableHead key={c.key} scope="col" className="text-right" title={c.title}>
              {c.label}
              {NOW_COLUMNS.has(c.key) && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">(now)</span>
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={COLUMNS.length + 1} className="text-center text-muted-foreground">
              No service engineers yet.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead scope="row" className={cn(STICKY, "font-medium")}>
                {rowName(row)}
              </TableHead>
              {COLUMNS.map((c) => (
                <TableCell
                  key={c.key}
                  className={cn(
                    "text-right",
                    c.key === "overdue" && row.overdue > 0 && "font-semibold text-destructive",
                  )}
                >
                  {figure(c.key, row)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
      {/* Solid, so the sticky Total cell matches the rest of its row. */}
      <TableFooter className="bg-muted">
        <TableRow>
          <TableHead scope="row" className={cn(STICKY, "bg-muted font-semibold")}>
            Total
          </TableHead>
          {COLUMNS.map((c) => (
            <TableCell key={c.key} className="text-right font-semibold">
              {figure(c.key, total)}
            </TableCell>
          ))}
        </TableRow>
      </TableFooter>
    </Table>
  );
}
