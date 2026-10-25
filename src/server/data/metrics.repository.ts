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
  /** Σ coordinator incentives set but not yet paid (everyone on every sale). */
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

export const metricsRepository = {
  /** Single aggregate query for the dashboard KPIs (see dashboard_metrics RPC). */
  async dashboard(): Promise<DashboardMetrics> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("dashboard_metrics").single();
    if (error || !data) return EMPTY;
    const row = data as MetricsRow;
    return {
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
    };
  },
};
