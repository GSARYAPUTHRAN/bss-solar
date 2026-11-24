import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Hammer,
  IndianRupee,
  Wrench,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { serviceReportRepository } from "@/server/data/service-report.repository";
import {
  buildServiceReport,
  parseServicePeriod,
  periodParam,
  servicesCsv,
  servicesCsvFilename,
} from "@/lib/domain/service-report";
import { monthName } from "@/lib/domain/dates";
import { formatCurrency, todayISO } from "@/lib/format";
import { Section, StatCard } from "@/components/layout";
import { ServicesCompletedList } from "@/components/reports/services-completed-list";
import { ServicesCsvButton } from "@/components/reports/services-csv-button";
import { ServicesEngineerTable } from "@/components/reports/services-engineer-table";
import { ServicesPeriodPicker } from "@/components/reports/services-period-picker";
import { ServicesTrend } from "@/components/reports/services-trend";

export const metadata = { title: "Services report" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Icon tints for the KPI tiles (light + dark variants), as on the dashboard. */
const ACCENT = {
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
} as const;

/**
 * Services report (`/reports/services?month=YYYY-MM|all`): visits completed per
 * service engineer and in total for a month (the current IST month by default)
 * or all time, what is open now, a 12-month trend and the visits themselves.
 * Office only; rendered inside the Reports layout (heading and tabs).
 * Every figure is defined in lib/domain/service-report.ts.
 */
export default async function ServicesReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const today = todayISO();
  const period = parseServicePeriod(
    Array.isArray(sp.month) ? sp.month[0] : sp.month,
    today,
  );

  const [tickets, engineers] = await Promise.all([
    serviceReportRepository.tickets(),
    serviceReportRepository.engineers(),
  ]);
  const report = buildServiceReport({ tickets, engineers, period, today });
  const { total } = report;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Services · {report.label}</h2>
          <p className="text-sm text-muted-foreground">
            Service visits completed by each engineer, and what is on their list now.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ServicesPeriodPicker value={periodParam(period)} options={report.options} />
          <ServicesCsvButton
            csv={servicesCsv(report.completed)}
            filename={servicesCsvFilename(period)}
          />
        </div>
      </div>

      <KpiGroup title={report.label}>
        <StatCard
          label="Completed"
          value={total.completed}
          icon={CheckCircle2}
          accent={ACCENT.emerald}
          hint="Routine and ad-hoc visits"
        />
        <StatCard
          label="Routine 6-month"
          value={total.routine}
          icon={CalendarCheck}
          accent={ACCENT.indigo}
          hint="6-month checks completed"
        />
        <StatCard
          label="Ad-hoc"
          value={total.adhoc}
          icon={Wrench}
          accent={ACCENT.amber}
          hint="Visits for a reported issue"
        />
        <StatCard
          label="Service charges billed"
          value={formatCurrency(total.charges)}
          icon={IndianRupee}
          accent={ACCENT.emerald}
          hint="Ticket totals of completed visits"
        />
      </KpiGroup>

      <KpiGroup title="Right now" description="Where every ticket stands today, whatever the period.">
        <StatCard
          label="Open + scheduled"
          value={total.openScheduled}
          icon={Clock}
          accent={ACCENT.blue}
          hint="Waiting for a visit"
        />
        <StatCard
          label="In progress"
          value={total.inProgress}
          icon={Hammer}
          accent={ACCENT.indigo}
          hint="Work started"
        />
        <StatCard
          label="Overdue"
          value={total.overdue}
          icon={AlertTriangle}
          accent={ACCENT.red}
          hint="Past the scheduled date, not done"
        />
      </KpiGroup>

      <Section
        title="By engineer"
        description={`Completed, routine, ad-hoc, charges and cancelled: ${report.label}. Open, in progress and overdue: now.`}
      >
        <ServicesEngineerTable rows={report.rows} total={total} />
      </Section>

      {report.trend && period.kind === "month" && (
        <Section
          title="Completed per month"
          description={`The 12 months to ${monthName(period.month)}.`}
        >
          <ServicesTrend trend={report.trend} today={today} />
        </Section>
      )}

      <Section
        title="Completed visits"
        description={`${report.completed.length} in ${report.label}, latest first.`}
      >
        <ServicesCompletedList services={report.completed} periodLabel={report.label} />
      </Section>

      <CountingNote />
    </div>
  );
}

function KpiGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const id = `kpi-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="space-y-0.5">
        <h3
          id={id}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {title}
        </h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

/** What each figure counts, for whoever reads the report. */
function CountingNote() {
  return (
    <details className="rounded-xl bg-card text-sm ring-1 ring-foreground/10">
      <summary className="flex min-h-10 cursor-pointer items-center px-4 py-2 font-medium">
        How these numbers are counted
      </summary>
      <ul className="list-disc space-y-1.5 pb-4 pl-9 pr-4 text-muted-foreground">
        <li>
          A visit is <strong>completed</strong> in the month of its service date. A ticket
          closed without a service date counts on the day it was last updated (India time)
          — in practice the day it was closed.
        </li>
        <li>
          <strong>Charges billed</strong> add up the ticket totals (service charge, spares and
          AMC) of the completed visits.
        </li>
        <li>
          <strong>Cancelled</strong> tickets count on the day they were last updated, since a
          ticket keeps no separate cancellation date.
        </li>
        <li>
          <strong>Open, in progress and overdue</strong> show where tickets stand today,
          whichever period is chosen. Overdue tickets are open, scheduled or in progress with
          a scheduled date before today — they are already in the other two figures.
        </li>
        <li>
          Every service engineer has a row, even with no visits. Tickets held by someone who
          is no longer a service engineer stay under their name; tickets with nobody on them
          are under Unassigned.
        </li>
      </ul>
    </details>
  );
}
