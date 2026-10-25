import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dashboard KPIs, read through `dashboard_metrics()`: every column maps to
 * its figure (numerics and bigints arrive as strings), the two cancellation
 * counts included, and a failed read shows zeros instead of breaking the page.
 */

type Rpc = { data: unknown; error: { message: string } | null };

let response: Rpc;
const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: (fn: string) => {
      rpc(fn);
      return { single: async () => response };
    },
  })),
}));

import { metricsRepository } from "./metrics.repository";

const ROW = {
  total_work_orders: "33",
  pending_approvals: 2,
  active_projects: "14",
  commissioned: 9,
  open_tickets: 3,
  approved_pipeline: "4250000.50",
  commissioned_unpaid: 2,
  outstanding_amount: "120000",
  feasibility_expiring: 1,
  feasibility_extension_cost: "3000",
  incentive_pending: "17500",
  cancelled_projects: "3",
  refunded_projects: 2,
};

beforeEach(() => {
  rpc.mockClear();
  response = { data: ROW, error: null };
});

describe("metricsRepository.dashboard", () => {
  it("maps every KPI, the cancelled and refunded counts included", async () => {
    expect(await metricsRepository.dashboard()).toEqual({
      totalWorkOrders: 33,
      pendingApprovals: 2,
      activeProjects: 14,
      commissioned: 9,
      openTickets: 3,
      approvedPipeline: 4250000.5,
      commissionedUnpaid: 2,
      outstandingAmount: 120000,
      feasibilityExpiring: 1,
      feasibilityExtensionCost: 3000,
      incentivePending: 17500,
      cancelledProjects: 3,
      refundedProjects: 2,
    });
    expect(rpc).toHaveBeenCalledWith("dashboard_metrics");
  });

  it("reads a null aggregate as zero", async () => {
    response = { data: { ...ROW, cancelled_projects: null, refunded_projects: null }, error: null };
    const metrics = await metricsRepository.dashboard();
    expect(metrics.cancelledProjects).toBe(0);
    expect(metrics.refundedProjects).toBe(0);
  });

  it("shows zeros, not an error page, when the KPIs cannot be read", async () => {
    response = { data: null, error: { message: "boom" } };
    const metrics = await metricsRepository.dashboard();
    expect(metrics.activeProjects).toBe(0);
    expect(metrics.cancelledProjects).toBe(0);
    expect(metrics.refundedProjects).toBe(0);
  });
});
