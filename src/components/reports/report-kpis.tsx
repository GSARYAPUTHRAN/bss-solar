import {
  Ban,
  CheckCircle2,
  ClipboardList,
  HandCoins,
  IndianRupee,
  Sun,
  TrendingUp,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Kpi, KpiKey, ReportPeriod } from "@/lib/domain/reports";
import { formatFigure, formatHeadline } from "./report-format";
import { GrowthText } from "./growth-text";

/** Icon tints (light + dark), as on the dashboard. */
const ACCENT = {
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300",
} as const;

const LOOK: Record<KpiKey, { icon: LucideIcon; accent: string }> = {
  salesCount: { icon: ClipboardList, accent: ACCENT.blue },
  salesValue: { icon: IndianRupee, accent: ACCENT.emerald },
  capacity: { icon: Sun, accent: ACCENT.amber },
  averageValue: { icon: TrendingUp, accent: ACCENT.indigo },
  netCollected: { icon: Wallet, accent: ACCENT.emerald },
  commissioned: { icon: CheckCircle2, accent: ACCENT.emerald },
  servicesCompleted: { icon: Wrench, accent: ACCENT.blue },
  incentivesPaid: { icon: HandCoins, accent: ACCENT.indigo },
  cancelledRefunded: { icon: Ban, accent: ACCENT.gray },
};

/**
 * The headline figures for the month, each with its change against the
 * previous period and the same period last year. Same look as the dashboard's
 * StatCard, with room for the two comparison lines (a StatCard hint is one
 * truncated line).
 */
export function ReportKpis({ kpis, period }: { kpis: Kpi[]; period: ReportPeriod }) {
  return (
    <section aria-labelledby="report-headline" className="space-y-3">
      <h2
        id="report-headline"
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Headline · {period.current.label}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} period={period} />
        ))}
      </div>
    </section>
  );
}

function KpiCard({ kpi, period }: { kpi: Kpi; period: ReportPeriod }) {
  const { icon: Icon, accent } = LOOK[kpi.key];
  return (
    <Card className="h-full" data-kpi={kpi.key}>
      {/* The icon sits beside the label, so a long figure (₹63,79,000) has the
          card's full width and never runs under it. */}
      <CardContent className="space-y-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {kpi.label}
          </p>
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              accent,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-xl font-bold tabular-nums [overflow-wrap:anywhere] sm:text-2xl">
          {formatHeadline(kpi.value, kpi.format)}
        </p>
        {kpi.hint && <p className="text-xs text-muted-foreground">{kpi.hint}</p>}
        <div className="space-y-0.5 pt-1 text-xs">
          <Comparison label={`vs ${period.previous.label}`} kpi={kpi} which="previous" />
          <Comparison label={`vs ${period.lastYear.label}`} kpi={kpi} which="lastYear" />
        </div>
      </CardContent>
    </Card>
  );
}

function Comparison({
  label,
  kpi,
  which,
}: {
  label: string;
  kpi: Kpi;
  which: "previous" | "lastYear";
}) {
  const growth = which === "previous" ? kpi.vsPrevious : kpi.vsLastYear;
  const base = which === "previous" ? kpi.previous : kpi.lastYear;
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5" data-compare={which}>
      <GrowthText growth={growth} better={kpi.better} className="font-medium" />{" "}
      <span className="text-muted-foreground">
        {label} ({formatFigure(base, kpi.format)})
      </span>
    </p>
  );
}
