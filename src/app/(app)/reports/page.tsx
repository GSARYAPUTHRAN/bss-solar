import { requireAdmin } from "@/lib/auth";
import { metricsRepository } from "@/server/data";
import { reportsRepository } from "@/server/data/reports.repository";
import { todayISO } from "@/lib/format";
import {
  buildMonthlyReport,
  earliestOrderMonth,
  parseReportMonth,
  reportMonthOptions,
  reportPeriod,
} from "@/lib/domain/reports";
import { ReportMonthPicker } from "@/components/reports/report-month-picker";
import { ReportDownloads } from "@/components/reports/report-downloads";
import { ReportKpis } from "@/components/reports/report-kpis";
import {
  CollectionsSection,
  CoordinatorsSection,
  FinancialYearSection,
  ReportNote,
  SnapshotSection,
  TrendSection,
} from "@/components/reports/report-sections";

export const metadata = { title: "Reports" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The monthly management report: one month's sales, collections, commissioning
 * and service work against the month before, the same month last year and the
 * financial year so far — on screen and as a PDF / CSV download. Office only.
 * The heading and tabs come from the Reports layout.
 */
export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const today = todayISO();
  const month = parseReportMonth(sp.month, today);
  const period = reportPeriod(month, today);

  // Both reads throw on failure, to the error page: a report (or its PDF) must
  // never print zeros for figures it could not read.
  const [data, metrics] = await Promise.all([
    reportsRepository.load(period.range),
    metricsRepository.dashboardOrThrow(),
  ]);

  const report = buildMonthlyReport(
    data,
    period,
    {
      activeProjects: metrics.activeProjects,
      commissionedUnpaid: metrics.commissionedUnpaid,
      outstandingAmount: metrics.outstandingAmount,
      incentivePending: metrics.incentivePending,
      openTickets: metrics.openTickets,
    },
    today,
  );
  const options = reportMonthOptions(earliestOrderMonth(data.sales), today, month);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <ReportMonthPicker month={month} options={options} />
        <ReportDownloads report={report} />
      </div>

      <p className="text-sm text-muted-foreground" data-testid="report-comparing">
        {period.soFar ? (
          <>
            <span className="font-medium text-foreground">{report.monthLabel} so far</span>{" "}
            ({period.current.label}), compared day for day with {period.previous.label} and{" "}
            {period.lastYear.label}.
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{report.monthLabel}</span>, compared
            with {period.previous.label} and {period.lastYear.label}.
          </>
        )}
      </p>

      <ReportKpis kpis={report.kpis} period={period} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CollectionsSection collections={report.current.collections} period={period} />
        <FinancialYearSection rows={report.fy} period={period} />
      </div>

      <TrendSection rows={report.trend} />
      <CoordinatorsSection table={report.coordinators} period={period} />
      <SnapshotSection snapshot={report.snapshot} />
      <ReportNote />
    </div>
  );
}
