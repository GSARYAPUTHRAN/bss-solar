import {
  AlertTriangle,
  HandCoins,
  KanbanSquare,
  Wrench,
} from "lucide-react";
import { Section, StatCard } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  REPORT_NOTES,
  formatKw,
  type CollectionFigures,
  type ComparisonRow,
  type CoordinatorTable,
  type ReportPeriod,
  type ReportSnapshot,
  type TrendRow,
} from "@/lib/domain/reports";
import { formatFigure } from "./report-format";
import { GrowthText } from "./growth-text";

/** Numeric cells: right-aligned, digits lined up. */
const NUM = "text-right tabular-nums";

/**
 * The tables run edge to edge in their card (so a phone scrolls them sideways
 * inside it, never the page); the outer cells keep the card's inset.
 */
const EDGE =
  "[&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4";

/** (b) Where the money came from in the window, and what is kept apart from it. */
export function CollectionsSection({
  collections: c,
  period,
}: {
  collections: CollectionFigures;
  period: ReportPeriod;
}) {
  const line = (label: string, count: number, amount: number, sign = "") => (
    <TableRow>
      <TableCell className="whitespace-normal">{label}</TableCell>
      <TableCell className={NUM}>{count}</TableCell>
      <TableCell className={NUM}>
        {sign}
        {formatCurrency(amount)}
      </TableCell>
    </TableRow>
  );
  return (
    <Section
      title="Collections"
      description={`Money in and out, ${period.current.label}.`}
      contentClassName="px-0"
    >
      <Table aria-label="Collections" className={EDGE}>
        <TableHeader>
          <TableRow>
            <TableHead>Line</TableHead>
            <TableHead className="text-right">Entries</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {line("Advances", c.advances.count, c.advances.amount)}
          {line("Contract payments", c.contract.count, c.contract.amount)}
          {line("Refunds", c.refunds.count, c.refunds.amount, "− ")}
          <TableRow className="bg-muted/40 font-semibold">
            <TableCell>Net collected</TableCell>
            <TableCell />
            <TableCell className={NUM}>{formatCurrency(c.net)}</TableCell>
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={3} className="pt-4 text-xs text-muted-foreground">
              Kept apart — not in net collected
            </TableCell>
          </TableRow>
          {line("KSEB fees collected", c.ksebCollected.count, c.ksebCollected.amount)}
          {line("KSEB fees paid by the office", c.ksebByOffice.count, c.ksebByOffice.amount)}
          {line("Write-offs (not money)", c.writeOffs.count, c.writeOffs.amount)}
        </TableBody>
      </Table>
    </Section>
  );
}

/** (c) The financial year so far against the same span a year earlier. */
export function FinancialYearSection({
  rows,
  period,
}: {
  rows: ComparisonRow[];
  period: ReportPeriod;
}) {
  return (
    <Section
      title={`Financial year to date · ${period.fyName}`}
      description={`${period.fy.label}, against ${period.fyBase.label} (${period.fyBaseName}).`}
      contentClassName="px-0"
    >
      <Table aria-label="Financial year to date" className={EDGE}>
        <TableHeader>
          <TableRow>
            <TableHead>Figure</TableHead>
            <TableHead className="text-right">{period.fyName}</TableHead>
            <TableHead className="text-right">{period.fyBaseName}</TableHead>
            <TableHead className="text-right">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell>{r.label}</TableCell>
              <TableCell className={NUM}>{formatFigure(r.value, r.format)}</TableCell>
              <TableCell className={cn(NUM, "text-muted-foreground")}>
                {formatFigure(r.base, r.format)}
              </TableCell>
              <TableCell className={NUM}>
                <GrowthText growth={r.change} better={r.better} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

/** (d) Twelve months to the selected one, with a bar for each month's sales value. */
export function TrendSection({ rows }: { rows: TrendRow[] }) {
  return (
    <Section
      title="12-month trend"
      description="Sales value bars are relative to the biggest month shown. Month-on-month compares sales value."
      contentClassName="px-0"
    >
      <Table aria-label="12-month trend" className={EDGE}>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="min-w-40">Sales value</TableHead>
            <TableHead className="text-right">Sales</TableHead>
            <TableHead className="text-right">kW</TableHead>
            <TableHead className="text-right">Net collected</TableHead>
            <TableHead className="text-right">Commissioned</TableHead>
            <TableHead className="text-right">Services</TableHead>
            <TableHead className="text-right">MoM</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.month} data-month={r.month}>
              <TableCell className={cn(r.soFar && "font-medium")}>{r.label}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div aria-hidden className="h-2 w-24 shrink-0 rounded-full bg-muted sm:w-32">
                    <div
                      data-bar
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${r.barPct}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{formatCurrency(r.salesValue)}</span>
                </div>
              </TableCell>
              <TableCell className={NUM}>{r.salesCount}</TableCell>
              <TableCell className={NUM}>{formatKw(r.capacityKw)}</TableCell>
              <TableCell className={NUM}>{formatCurrency(r.netCollected)}</TableCell>
              <TableCell className={NUM}>{r.commissioned}</TableCell>
              <TableCell className={NUM}>{r.servicesCompleted}</TableCell>
              <TableCell className={NUM}>
                <GrowthText growth={r.valueMoM} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

/** (e) Who sold what in the window; shared sales are split evenly. */
export function CoordinatorsSection({
  table,
  period,
}: {
  table: CoordinatorTable;
  period: ReportPeriod;
}) {
  const { rows, totals } = table;
  return (
    <Section
      title="By coordinator"
      description={`${period.current.label}. A shared sale counts for everyone on it; its value and kW are split evenly, so the rows add up to the total.`}
      contentClassName="px-0"
    >
      {rows.length === 0 ? (
        <p className="px-4 text-sm text-muted-foreground">
          No sales booked and no plants commissioned in this period.
        </p>
      ) : (
        <Table aria-label="By coordinator" className={EDGE}>
          <TableHeader>
            <TableRow>
              <TableHead>Coordinator</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Shared</TableHead>
              <TableHead className="text-right">Value share</TableHead>
              <TableHead className="text-right">kW share</TableHead>
              <TableHead className="text-right">Commissioned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id ?? "none"}>
                <TableCell className={cn(r.id === null && "italic text-muted-foreground")}>
                  {r.name}
                </TableCell>
                <TableCell className={NUM}>{r.sales}</TableCell>
                <TableCell className={NUM}>{r.shared}</TableCell>
                <TableCell className={NUM}>{formatCurrency(r.valueShare)}</TableCell>
                <TableCell className={NUM}>{formatKw(r.kwShare)}</TableCell>
                <TableCell className={NUM}>{r.commissioned}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className={NUM}>{totals.sales}</TableCell>
              <TableCell className={NUM}>{totals.shared}</TableCell>
              <TableCell className={NUM}>{formatCurrency(totals.value)}</TableCell>
              <TableCell className={NUM}>{formatKw(totals.kw)}</TableCell>
              <TableCell className={NUM}>{totals.commissioned}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </Section>
  );
}

/** (f) Live figures, the same whichever month is selected. */
export function SnapshotSection({ snapshot: s }: { snapshot: ReportSnapshot }) {
  return (
    <section aria-labelledby="report-snapshot" className="space-y-3">
      <h2
        id="report-snapshot"
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        As of today
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active projects"
          value={s.activeProjects}
          icon={KanbanSquare}
          hint="Excludes cancelled and refunded"
          href="/projects"
        />
        <StatCard
          label="Commissioned · balance due"
          value={s.commissionedUnpaid}
          icon={AlertTriangle}
          accent="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          hint={`${formatCurrency(s.outstandingAmount)} still to collect`}
          href="/projects?view=list&status=payment_pending"
        />
        <StatCard
          label="Incentives pending"
          value={formatCurrency(s.incentivePending)}
          icon={HandCoins}
          accent="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
          hint="Agreed less the instalments paid"
          href="/projects?view=list&incentive=pending"
        />
        <StatCard
          label="Open service tickets"
          value={s.openTickets}
          icon={Wrench}
          accent="bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
          hint="Open, scheduled or in progress"
          href="/tickets"
        />
      </div>
    </section>
  );
}

/** (g) The definitions, folded away until asked for. */
export function ReportNote() {
  return (
    <details className="group rounded-xl border bg-card text-sm">
      <summary className="flex min-h-10 cursor-pointer items-center px-4 py-2 font-medium">
        How these numbers are counted
      </summary>
      <dl className="space-y-3 border-t px-4 py-4">
        {REPORT_NOTES.map((n) => (
          <div key={n.term}>
            <dt className="font-medium">{n.term}</dt>
            <dd className="text-muted-foreground">{n.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
