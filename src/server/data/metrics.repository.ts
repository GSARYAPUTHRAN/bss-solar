import { createClient } from "@/lib/supabase/server";

export interface DashboardMetrics {
  totalWorkOrders: number;
  pendingApprovals: number;
  activeProjects: number;
  commissioned: number;
  openTickets: number;
  approvedPipeline: number;
  /** Commissioned projects whose contract value is not fully collected. */
  commissionedUnpaid: number;
  /** Total balance due across those projects. */
  outstandingAmount: number;
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
};

export const metricsRepository = {
  /** Single aggregate query for the dashboard KPIs (see dashboard_metrics RPC). */
  async dashboard(): Promise<DashboardMetrics> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("dashboard_metrics").single();
    if (error || !data) return EMPTY;
    const row = data as {
      total_work_orders: number;
      pending_approvals: number;
      active_projects: number;
      commissioned: number;
      open_tickets: number;
      approved_pipeline: number;
      commissioned_unpaid: number;
      outstanding_amount: number;
    };
    return {
      totalWorkOrders: Number(row.total_work_orders ?? 0),
      pendingApprovals: Number(row.pending_approvals ?? 0),
      activeProjects: Number(row.active_projects ?? 0),
      commissioned: Number(row.commissioned ?? 0),
      openTickets: Number(row.open_tickets ?? 0),
      approvedPipeline: Number(row.approved_pipeline ?? 0),
      commissionedUnpaid: Number(row.commissioned_unpaid ?? 0),
      outstandingAmount: Number(row.outstanding_amount ?? 0),
    };
  },
};
