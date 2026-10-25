import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  istToday,
  rolledBack,
  signedInAs,
  serviceClient,
  USERS,
  type SeedUser,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import { addDays } from "@/lib/domain/dates";

/**
 * The dashboard KPIs come from a single aggregate RPC (SECURITY INVOKER, so it
 * respects RLS). Verify it agrees with direct counts rather than the old
 * "load every row and count in JS" approach. The payment, feasibility and
 * incentive KPIs are pinned in their own suites; here is what the 2026-10-22
 * release changed — cancelled and refunded projects leave the pipeline, and a
 * shared sale counts for every coordinator on it.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

type Metrics = {
  total_work_orders: number;
  pending_approvals: number;
  active_projects: number;
  commissioned: number;
  open_tickets: number;
  approved_pipeline: number;
  commissioned_unpaid: number;
  outstanding_amount: number;
  feasibility_expiring: number;
  feasibility_extension_cost: number;
  incentive_pending: number;
  cancelled_projects: number;
  refunded_projects: number;
};

async function metricsFor(user: SeedUser): Promise<Metrics> {
  const row = must(
    await (await signedInAs(user)).rpc("dashboard_metrics").single(),
    "dashboard_metrics",
  );
  // bigint and numeric arrive as numbers or numeric strings.
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, Number(v)]),
  ) as Metrics;
}

/**
 * What the KPIs must be, computed from the raw tables for the sales a
 * coordinator is on (everything when `coordinatorId` is omitted).
 */
async function expectedMetrics(coordinatorId?: string): Promise<Metrics> {
  const memberships = must(
    await svc.from("work_order_coordinators").select("work_order_id, coordinator_id"),
    "memberships",
  );
  const mine = new Set(
    memberships
      .filter((m) => !coordinatorId || m.coordinator_id === coordinatorId)
      .map((m) => m.work_order_id),
  );
  const inScope = (workOrderId: string | null) =>
    !coordinatorId || (workOrderId !== null && mine.has(workOrderId));

  const workOrders = must(
    await svc.from("work_orders").select("id, status, total_cost"),
    "work orders",
  ).filter((w) => inScope(w.id));
  const projects = must(
    await svc
      .from("projects_list")
      .select(
        "id, work_order_id, is_completed, cancellation, payment_pending, balance_due, feasibility_days_left, feasibility_extension_cost",
      ),
    "projects",
  ).filter((p) => inScope(p.work_order_id));
  const cancelledSales = new Set(
    projects.filter((p) => p.cancellation !== null).map((p) => p.work_order_id),
  );
  const incentives = must(
    await svc
      .from("coordinator_incentives")
      .select("work_order_id, coordinator_id, amount, paid_on")
      .not("amount", "is", null)
      .is("paid_on", null),
    "incentives",
  );
  const withProject = new Set(
    must(await svc.from("projects").select("work_order_id"), "projects").map(
      (p) => p.work_order_id,
    ),
  );
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

  return {
    total_work_orders: workOrders.length,
    pending_approvals: workOrders.filter((w) => w.status === "pending").length,
    active_projects: projects.filter((p) => !p.is_completed && !p.cancellation).length,
    commissioned: projects.filter((p) => p.is_completed && !p.cancellation).length,
    open_tickets: 0, // not compared here: tickets are scoped by project, below
    approved_pipeline: sum(
      workOrders
        .filter((w) => w.status === "approved" && !cancelledSales.has(w.id))
        .map((w) => Number(w.total_cost)),
    ),
    commissioned_unpaid: projects.filter((p) => p.payment_pending).length,
    outstanding_amount: sum(
      projects.filter((p) => p.payment_pending).map((p) => Number(p.balance_due)),
    ),
    feasibility_expiring: projects.filter(
      (p) =>
        p.feasibility_days_left !== null &&
        p.feasibility_days_left >= 0 &&
        p.feasibility_days_left <= 7,
    ).length,
    // Renewal fees already borne stay a cost, cancelled projects included.
    feasibility_extension_cost: sum(
      projects.map((p) => Number(p.feasibility_extension_cost)),
    ),
    incentive_pending: sum(
      incentives
        .filter(
          (i) =>
            withProject.has(i.work_order_id) &&
            inScope(i.work_order_id) &&
            (!coordinatorId || i.coordinator_id === coordinatorId),
        )
        .map((i) => Number(i.amount)),
    ),
    cancelled_projects: projects.filter((p) => p.cancellation === "cancelled").length,
    refunded_projects: projects.filter((p) => p.cancellation === "refunded").length,
  };
}

describe("dashboard_metrics RPC", () => {
  it("matches direct counts for an admin (org-wide view)", async () => {
    const m = await metricsFor(USERS.admin);

    const count = async (query: PromiseLike<{ count: number | null }>) =>
      (await query).count;
    const head = { count: "exact", head: true } as const;

    expect(m.total_work_orders).toBe(
      await count(svc.from("work_orders").select("id", head)),
    );
    expect(m.pending_approvals).toBe(
      await count(
        svc.from("work_orders").select("id", head).eq("status", "pending"),
      ),
    );
    // Live projects only: a cancelled or refunded one is neither active nor
    // commissioned any more.
    expect(m.active_projects).toBe(
      await count(
        svc
          .from("projects")
          .select("id", head)
          .eq("is_completed", false)
          .is("cancellation", null),
      ),
    );
    expect(m.commissioned).toBe(
      await count(
        svc
          .from("projects")
          .select("id", head)
          .eq("is_completed", true)
          .is("cancellation", null),
      ),
    );
    expect(m.cancelled_projects).toBe(
      await count(svc.from("projects").select("id", head).eq("cancellation", "cancelled")),
    );
    expect(m.refunded_projects).toBe(
      await count(svc.from("projects").select("id", head).eq("cancellation", "refunded")),
    );
    expect(m.open_tickets).toBe(
      await count(
        svc
          .from("service_tickets")
          .select("id", head)
          .in("status", ["open", "scheduled", "in_progress"]),
      ),
    );
    expect(m.approved_pipeline).toBeGreaterThan(0);
  });

  it("scopes a service engineer's open tickets to their own", async () => {
    const m = await metricsFor(USERS.vineeth);

    const { count } = await svc
      .from("service_tickets")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", USERS.vineeth.id)
      .in("status", ["open", "scheduled", "in_progress"]);
    expect(m.open_tickets).toBe(count);
    // No table access to the sales side, so every money KPI is empty.
    expect(m.total_work_orders).toBe(0);
    expect(m.approved_pipeline).toBe(0);
    expect(m.outstanding_amount).toBe(0);
    expect(m.incentive_pending).toBe(0);
    expect(m.cancelled_projects).toBe(0);
    expect(m.refunded_projects).toBe(0);
  });
});

/**
 * The build deployed before this release reads the first eleven KPIs by name.
 * Its definition (migration 20261010120600) is replayed here, over data the old
 * build could have produced — one coordinator per sale, solar, nothing
 * cancelled — and must give exactly the same figures.
 */
describe("the previous build's KPIs", () => {
  const OLD_DASHBOARD_METRICS = `
    create function pg_temp.old_dashboard_metrics()
    returns table (
      total_work_orders bigint, pending_approvals bigint, active_projects bigint,
      commissioned bigint, open_tickets bigint, approved_pipeline numeric,
      commissioned_unpaid bigint, outstanding_amount numeric,
      feasibility_expiring bigint, feasibility_extension_cost numeric,
      incentive_pending numeric
    )
    language sql stable security invoker set search_path = public as $$
      select
        (select count(*) from work_orders)::bigint,
        (select count(*) from work_orders where status = 'pending')::bigint,
        (select count(*) from projects where not is_completed)::bigint,
        (select count(*) from projects where is_completed)::bigint,
        (select count(*) from service_tickets
           where status in ('open', 'scheduled', 'in_progress'))::bigint,
        coalesce((select sum(total_cost) from work_orders where status = 'approved'), 0)::numeric,
        (select count(*) from projects_list where payment_pending)::bigint,
        coalesce((select sum(balance_due) from projects_list where payment_pending), 0)::numeric,
        (select count(*) from projects_list
           where feasibility_days_left between 0 and 7)::bigint,
        coalesce((select sum(feasibility_extension_cost) from projects_list), 0)::numeric,
        coalesce(
          (select sum(coordinator_incentive) from projects
             where coordinator_incentive is not null and incentive_paid_on is null), 0
        )::numeric;
    $$`;

  it("come out unchanged for single-coordinator, solar, live sales", async () => {
    await rolledBack(async (db) => {
      // Reduce the database to what the old build could have made…
      await db.query(
        "update public.projects set cancellation = null, cancelled_on = null where cancellation is not null",
      );
      await db.query("delete from public.work_orders where plan_type = 'custom'");
      await db.query("delete from public.work_order_coordinators where sort_order > 1");
      // …with each incentive also in the project's own columns, where it kept them.
      await db.query(`
        update public.projects p
           set coordinator_incentive = i.amount, incentive_paid_on = i.paid_on
          from public.coordinator_incentives i
         where i.work_order_id = p.work_order_id and i.amount is not null`);
      await db.query(OLD_DASHBOARD_METRICS);

      const read = async (fn: string) =>
        (await db.query(`select * from ${fn}`)).rows[0] as Record<string, string>;
      const old = await read("pg_temp.old_dashboard_metrics()");
      const now = await read("public.dashboard_metrics()");

      expect(Object.keys(old)).toHaveLength(11);
      const firstEleven = Object.fromEntries(
        Object.keys(old).map((k) => [k, now[k]]),
      );
      expect(firstEleven).toEqual(old);
      // …and it was a real comparison, not eleven zeros.
      expect(Number(old.approved_pipeline)).toBeGreaterThan(0);
      expect(Number(old.incentive_pending)).toBeGreaterThan(0);
      expect(Number(old.feasibility_extension_cost)).toBeGreaterThan(0);
    });
  });
});

describe("cancelled and refunded projects", () => {
  let today = "";
  let live: { workOrderId: string; projectId: string };
  let paymentPendingSale: { workOrderId: string; projectId: string };

  beforeAll(async () => {
    today = await istToday();
    // A live project whose feasibility ends in 3 days, 300000 of pipeline.
    live = await fx.approvedProject({
      workOrder: { client_name: `Metrics Live ${RUN}`, total_cost: 300000 },
      project: { feasibility_date: addDays(today, -27) },
    });
    // Commissioned with ₹100000 still to collect.
    paymentPendingSale = await fx.approvedProject({
      workOrder: {
        client_name: `Metrics Unpaid ${RUN}`,
        total_cost: 200000,
        advance_amount: 100000,
      },
      project: {
        is_completed: true,
        current_stage: "plant_commissioning",
        completed_at: new Date().toISOString(),
      },
    });
  });

  afterAll(() => fx.cleanup());

  it("leave the pipeline, the unpaid figures and the expiry alerts — and are counted on their own", async () => {
    const before = await metricsFor(USERS.admin);
    const admin = await signedInAs(USERS.admin);

    // Cancel the live project: it was active, in the pipeline and expiring.
    must(
      await admin
        .from("projects")
        .update({ cancellation: "cancelled", cancelled_on: today })
        .eq("id", live.projectId)
        .select("id"),
      "cancel",
    );
    const afterCancel = await metricsFor(USERS.admin);
    expect(afterCancel.active_projects).toBe(before.active_projects - 1);
    expect(afterCancel.approved_pipeline).toBe(before.approved_pipeline - 300000);
    expect(afterCancel.feasibility_expiring).toBe(before.feasibility_expiring - 1);
    expect(afterCancel.cancelled_projects).toBe(before.cancelled_projects + 1);
    expect(afterCancel.refunded_projects).toBe(before.refunded_projects);
    // It is still a sale and still a work order.
    expect(afterCancel.total_work_orders).toBe(before.total_work_orders);

    // Refund the commissioned one: no longer commissioned, no longer owed.
    must(
      await admin
        .from("projects")
        .update({ cancellation: "refunded" })
        .eq("id", paymentPendingSale.projectId)
        .select("id"),
      "refund",
    );
    const afterRefund = await metricsFor(USERS.admin);
    expect(afterRefund.commissioned).toBe(afterCancel.commissioned - 1);
    expect(afterRefund.commissioned_unpaid).toBe(afterCancel.commissioned_unpaid - 1);
    expect(afterRefund.outstanding_amount).toBe(afterCancel.outstanding_amount - 100000);
    expect(afterRefund.approved_pipeline).toBe(afterCancel.approved_pipeline - 200000);
    expect(afterRefund.refunded_projects).toBe(afterCancel.refunded_projects + 1);

    // Reinstating puts both back exactly where they were.
    for (const { projectId } of [live, paymentPendingSale]) {
      must(
        await admin
          .from("projects")
          .update({ cancellation: null, cancelled_on: null })
          .eq("id", projectId)
          .select("id"),
        "reinstate",
      );
    }
    expect(await metricsFor(USERS.admin)).toEqual(before);
  });

  it("keep their renewal costs and incentives in the totals", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Metrics Costs ${RUN}` },
      project: {
        feasibility_date: addDays(today, -75),
        cancellation: "cancelled",
        cancelled_on: addDays(today, -30),
      },
    });
    await fx.incentive(workOrderId, RAHUL, { amount: 900 });

    const row = must(
      await svc
        .from("projects_list")
        .select("feasibility_extension_cost")
        .eq("id", projectId)
        .single(),
      "projects_list",
    );
    // 45 days in when it stopped: a second period, one ₹1,000 renewal.
    expect(Number(row.feasibility_extension_cost)).toBe(1000);

    const m = await metricsFor(USERS.admin);
    const expected = await expectedMetrics();
    expect(m.feasibility_extension_cost).toBe(expected.feasibility_extension_cost);
    expect(m.incentive_pending).toBe(expected.incentive_pending);
  });

  it("agree with the raw tables for the office and for each coordinator", async () => {
    // A shared sale and a cancelled one that Priya shares with Rahul.
    await fx.approvedProject({
      workOrder: { client_name: `Metrics Shared ${RUN}`, total_cost: 450000 },
      partners: [PRIYA],
    });
    const shared = await fx.approvedProject({
      workOrder: { client_name: `Metrics Shared Cancelled ${RUN}`, total_cost: 120000 },
      partners: [PRIYA],
      project: { cancellation: "refunded" },
    });
    await fx.incentive(shared.workOrderId, PRIYA, { amount: 700 });

    for (const [user, scope] of [
      [USERS.admin, undefined],
      [USERS.superadmin, undefined],
      [USERS.rahul, RAHUL],
      [USERS.priya, PRIYA],
      [USERS.arun, USERS.arun.id],
      [USERS.sneha, USERS.sneha.id],
    ] as const) {
      const got = await metricsFor(user);
      const want = await expectedMetrics(scope);
      // Tickets are compared for the office above; here only the sales side.
      expect({ ...got, open_tickets: 0 }, user.email).toEqual(want);
    }
  });

  it("count a shared sale for every coordinator on it, and not for anyone else", async () => {
    const rahulBefore = await metricsFor(USERS.rahul);
    const priyaBefore = await metricsFor(USERS.priya);
    const arunBefore = await metricsFor(USERS.arun);

    const shared = await fx.approvedProject({
      workOrder: { client_name: `Metrics Partner Scope ${RUN}`, total_cost: 500000 },
      partners: [PRIYA],
    });

    const rahul = await metricsFor(USERS.rahul);
    const priya = await metricsFor(USERS.priya);
    for (const [after, before] of [
      [rahul, rahulBefore],
      [priya, priyaBefore],
    ] as const) {
      expect(after.total_work_orders).toBe(before.total_work_orders + 1);
      expect(after.active_projects).toBe(before.active_projects + 1);
      expect(after.approved_pipeline).toBe(before.approved_pipeline + 500000);
    }
    expect(await metricsFor(USERS.arun)).toEqual(arunBefore);

    // Taking Priya off the sale takes it off her dashboard.
    await fx.team(shared.workOrderId, [RAHUL]);
    expect(await metricsFor(USERS.priya)).toEqual(priyaBefore);
    expect((await metricsFor(USERS.rahul)).total_work_orders).toBe(
      rahulBefore.total_work_orders + 1,
    );
  });
});
