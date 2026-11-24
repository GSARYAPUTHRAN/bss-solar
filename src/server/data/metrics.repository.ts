import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type MetricsRow = Database["public"]["Functions"]["dashboard_metrics"]["Returns"][number];

export interface DashboardMetrics {
  totalWorkOrders: number;
  pendingApprovals: number;
  /** Projects in progress; cancelled and refunded ones are not counted. */
  activeProjects: number;
  /** Commissioned (or handed over) projects, cancelled and refunded excluded. */
  commissioned: number;
  openTickets: number;
  /** Contract value of approved work orders, cancelled and refunded projects excluded. */
  approvedPipeline: number;
  /** Commissioned projects whose contract value is not fully collected. */
  commissionedUnpaid: number;
  /** Total balance due across those projects. */
  outstandingAmount: number;
  /** Active projects within 7 days of their feasibility validity lapsing. */
  feasibilityExpiring: number;
  /** Σ renewal fees BSS has borne (₹1,000 per extra 30-day period). */
  feasibilityExtensionCost: number;
  /**
   * Σ coordinator incentives still to pay — what was agreed less the instalments
   * paid against it, per person (everyone on every sale).
   */
  incentivePending: number;
  /** Projects the office marked cancelled — out of the pipeline and the counts above. */
  cancelledProjects: number;
  /** Projects the office marked refunded — likewise out of the pipeline. */
  refundedProjects: number;
}

const EMPTY: DashboardMetrics = {
  totalWorkOrders: 0,
  pendingApprovals: 0,
  activeProjects: 0,
  commissioned: 0,
  openTickets: 0,
  approvedPipeline: 0,
  commissionedUnpaid: 0,
  outstandingAmount: 0,
  feasibilityExpiring: 0,
  feasibilityExtensionCost: 0,
  incentivePending: 0,
  cancelledProjects: 0,
  refundedProjects: 0,
};

/** bigint/numeric columns may arrive as strings; a null aggregate means 0. */
function n(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Single aggregate query for the KPIs (see dashboard_metrics RPC): the figures,
 * or why they could not be read. It returns rather than throws, so that
 * `dashboard()` can fall back to zeros without a try/catch — one would also
 * swallow the errors Next.js throws from `cookies()` inside `createClient()`.
 */
async function readDashboard(): Promise<{ metrics: DashboardMetrics } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_metrics").single();
  if (error || !data) return { error: error?.message ?? "no row returned" };
  const row = data as MetricsRow;
  return {
    metrics: {
      totalWorkOrders: n(row.total_work_orders),
      pendingApprovals: n(row.pending_approvals),
      activeProjects: n(row.active_projects),
      commissioned: n(row.commissioned),
      openTickets: n(row.open_tickets),
      approvedPipeline: n(row.approved_pipeline),
      commissionedUnpaid: n(row.commissioned_unpaid),
      outstandingAmount: n(row.outstanding_amount),
      feasibilityExpiring: n(row.feasibility_expiring),
      feasibilityExtensionCost: n(row.feasibility_extension_cost),
      incentivePending: n(row.incentive_pending),
      cancelledProjects: n(row.cancelled_projects),
      refundedProjects: n(row.refunded_projects),
    },
  };
}

export const metricsRepository = {
  /** The dashboard KPIs; zeros when they cannot be read, so the dashboard still opens. */
  async dashboard(): Promise<DashboardMetrics> {
    const read = await readDashboard();
    return "metrics" in read ? read.metrics : EMPTY;
  },

  /**
   * The same figures for a page that must not print zeros it never read — the
   * monthly report and its PDF: a failed read throws, to the error page.
   */
  async dashboardOrThrow(): Promise<DashboardMetrics> {
    const read = await readDashboard();
    if ("error" in read) throw new Error(`Could not read the business figures: ${read.error}`);
    return read.metrics;
  },
};
