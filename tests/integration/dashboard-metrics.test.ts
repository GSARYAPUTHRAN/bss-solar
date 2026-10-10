import { describe, it, expect } from "vitest";
import { signedInAs, serviceClient, USERS } from "./helpers";
import { must } from "./fixtures";

/**
 * The dashboard KPIs come from a single aggregate RPC (SECURITY INVOKER, so it
 * respects RLS). Verify it agrees with direct counts rather than the old
 * "load every row and count in JS" approach. The payment, feasibility and
 * incentive KPIs are pinned in their own suites.
 */
describe("dashboard_metrics RPC", () => {
  it("matches direct counts for an admin (org-wide view)", async () => {
    const admin = await signedInAs(USERS.admin);
    const m = must(
      await admin.rpc("dashboard_metrics").single(),
      "dashboard_metrics",
    );

    const svc = serviceClient();
    const count = async (query: PromiseLike<{ count: number | null }>) =>
      (await query).count;
    const head = { count: "exact", head: true } as const;

    expect(Number(m.total_work_orders)).toBe(
      await count(svc.from("work_orders").select("id", head)),
    );
    expect(Number(m.pending_approvals)).toBe(
      await count(
        svc.from("work_orders").select("id", head).eq("status", "pending"),
      ),
    );
    expect(Number(m.active_projects)).toBe(
      await count(
        svc.from("projects").select("id", head).eq("is_completed", false),
      ),
    );
    expect(Number(m.commissioned)).toBe(
      await count(
        svc.from("projects").select("id", head).eq("is_completed", true),
      ),
    );
    expect(Number(m.open_tickets)).toBe(
      await count(
        svc
          .from("service_tickets")
          .select("id", head)
          .in("status", ["open", "scheduled", "in_progress"]),
      ),
    );
    expect(Number(m.approved_pipeline)).toBeGreaterThan(0);
  });

  it("scopes a service engineer's open tickets to their own", async () => {
    const vineeth = await signedInAs(USERS.vineeth);
    const m = must(
      await vineeth.rpc("dashboard_metrics").single(),
      "dashboard_metrics",
    );

    const svc = serviceClient();
    const { count } = await svc
      .from("service_tickets")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", USERS.vineeth.id)
      .in("status", ["open", "scheduled", "in_progress"]);
    expect(Number(m.open_tickets)).toBe(count);
    // No table access to the sales side, so every money KPI is empty.
    expect(Number(m.total_work_orders)).toBe(0);
    expect(Number(m.approved_pipeline)).toBe(0);
    expect(Number(m.outstanding_amount)).toBe(0);
    expect(Number(m.incentive_pending)).toBe(0);
  });
});
