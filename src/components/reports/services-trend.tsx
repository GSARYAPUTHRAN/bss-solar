import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { monthLabel, type ServiceTrend } from "@/lib/domain/service-report";
import { cn } from "@/lib/utils";

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** `2026-11` → ["Nov", "2026"], for a narrow column heading. */
function shortMonth(month: string): [string, string] {
  const [year, mon] = month.split("-");
  return [SHORT_MONTHS[Number(mon) - 1] ?? mon, year];
}

const STICKY = "sticky left-0 z-10 bg-card";

/**
 * Visits completed per month for the 12 months ending at the selected one:
 * the total per month with a bar to compare them at a glance, then the same
 * months per engineer. Oldest month first; the current month is "so far".
 */
export function ServicesTrend({ trend, today }: { trend: ServiceTrend; today: string }) {
  const peak = Math.max(0, ...trend.totals);

  return (
    <div className="space-y-6">
      <Table className="tabular-nums">
        <caption className="sr-only">Visits completed per month</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Month</TableHead>
            <TableHead scope="col" className="text-right">
              Completed
            </TableHead>
            <TableHead scope="col" className="w-full min-w-24">
              <span className="sr-only">Compared with the busiest month</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trend.months.map((month, i) => {
            const count = trend.totals[i];
            const width = peak > 0 ? (count / peak) * 100 : 0;
            return (
              <TableRow key={month}>
                <TableHead scope="row" className="font-medium whitespace-normal">
                  {monthLabel(month, today)}
                </TableHead>
                <TableCell className="text-right">{count}</TableCell>
                <TableCell>
                  <div aria-hidden className="h-2.5 w-full min-w-24 rounded-full bg-muted">
                    <div
                      data-testid="trend-bar"
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">By engineer</h3>
        <Table className="tabular-nums">
          <caption className="sr-only">Visits completed per month, by engineer</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className={STICKY}>
                Engineer
              </TableHead>
              {trend.months.map((month) => {
                const [mon, year] = shortMonth(month);
                return (
                  <TableHead
                    key={month}
                    scope="col"
                    className="h-auto py-1.5 text-right leading-tight"
                    title={monthLabel(month, today)}
                  >
                    <span className="block">{mon}</span>
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {year}
                    </span>
                  </TableHead>
                );
              })}
              <TableHead scope="col" className="text-right">
                Total
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trend.rows.map((row) => (
              <TableRow key={row.key}>
                <TableHead
                  scope="row"
                  className={cn(STICKY, "font-medium", row.kind === "unassigned" && "italic")}
                >
                  {row.name}
                </TableHead>
                {row.counts.map((count, i) => (
                  <TableCell
                    key={trend.months[i]}
                    className={cn("text-right", count === 0 && "text-muted-foreground")}
                  >
                    {count}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium">{row.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-muted">
            <TableRow>
              <TableHead scope="row" className={cn(STICKY, "bg-muted font-semibold")}>
                Total
              </TableHead>
              {trend.totals.map((count, i) => (
                <TableCell key={trend.months[i]} className="text-right font-semibold">
                  {count}
                </TableCell>
              ))}
              <TableCell className="text-right font-semibold">{trend.total}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
