import { describe, it, expect } from "vitest";
import { clientAs, serviceClient, USERS } from "./helpers";

/**
 * The dashboard KPIs come from a single aggregate RPC (SECURITY INVOKER, so it
 * respects RLS). Verify it agrees with direct counts rather than the old
 * "load every row and count in JS" approach.
 */
describe("dashboard_metrics RPC", () => {
  it("matches direct counts for an admin (org-wide view)", async () => {
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    const { data, error } = await admin.rpc("dashboard_metrics").single();
    expect(error).toBeNull();
    const m = data as {
      total_work_orders: number;
      pending_approvals: number;
      active_projects: number;
      commissioned: number;
      open_tickets: number;
      approved_pipeline: number;
    };

    const svc = serviceClient();
    const woTotal = await svc
      .from("work_orders")
      .select("id", { count: "exact", head: true });
    const woPending = await svc
      .from("work_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    const projActive = await svc
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("is_completed", false);
    const projDone = await svc
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("is_completed", true);

    expect(Number(m.total_work_orders)).toBe(woTotal.count);
    expect(Number(m.pending_approvals)).toBe(woPending.count);
    expect(Number(m.active_projects)).toBe(projActive.count);
    expect(Number(m.commissioned)).toBe(projDone.count);
    expect(Number(m.approved_pipeline)).toBeGreaterThan(0);
  });
});
