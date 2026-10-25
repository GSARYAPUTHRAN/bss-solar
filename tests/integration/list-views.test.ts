import { describe, it, expect, afterEach } from "vitest";
import {
  rolledBack,
  signedInAs,
  serviceClient,
  USERS,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";

/**
 * The flattened list views back server-side pagination. They are SECURITY
 * INVOKER, so a coordinator must only see the sales they are on through them,
 * and filter/search/order/range must work against the flat columns.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

afterEach(() => fx.cleanup());

describe("list views", () => {
  it("work_orders_list respects RLS (a coordinator sees only the sales they are on)", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul
      .from("work_orders_list")
      .select("id, coordinator_id, coordinator_ids, coordinator_name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(row.coordinator_ids).toContain(RAHUL); // his own, or one he shares
      expect(row.coordinator_name).toBeTruthy(); // join resolved through RLS
    }
    // Arun's sales are not among them.
    expect((data ?? []).some((r) => r.coordinator_id === USERS.arun.id)).toBe(false);
  });

  it("work_orders_list supports status filter + exact count", async () => {
    const { data, count, error } = await svc
      .from("work_orders_list")
      .select("id, status", { count: "exact" })
      .eq("status", "pending");
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.status).toBe("pending");
  });

  it("work_orders_list supports ilike search + range", async () => {
    const { data } = await svc
      .from("work_orders_list")
      .select("client_name")
      .ilike("client_name", "%anand%")
      .range(0, 4);
    expect((data ?? []).some((r) => /anand/i.test(r.client_name ?? ""))).toBe(true);
    expect((data ?? []).length).toBeLessThanOrEqual(5);
  });

  it("projects_list exposes milestone counts and client name", async () => {
    const { data } = await svc
      .from("projects_list")
      .select("id, client_name, milestones_done, milestones_total")
      .order("created_at", { ascending: false })
      .range(0, 9);
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(Number(row.milestones_total)).toBeGreaterThanOrEqual(
        Number(row.milestones_done),
      );
    }
  });

  it("service_tickets_list flattens the client name", async () => {
    const { data } = await svc
      .from("service_tickets_list")
      .select("id, ticket_no, client_name")
      .not("client_name", "is", null)
      .limit(1);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("service_tickets_list names the assigned engineer", async () => {
    const { data, error } = await svc
      .from("service_tickets_list")
      .select("ticket_no, assigned_to, assignee_name")
      .eq("ticket_no", "BSS-2606-1002")
      .single();
    expect(error).toBeNull();
    expect(data?.assigned_to).toBe(USERS.vineeth.id);
    expect(data?.assignee_name).toBe("Vineeth Nair");
  });

  it("work_orders_list exposes financing and the numeric capacity", async () => {
    const { data, error } = await svc
      .from("work_orders_list")
      .select("client_name, financing_type, loan_bank_name, plant_capacity_kw")
      .in("client_name", ["Anand Kumar", "George Varghese"])
      .order("client_name");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        client_name: "Anand Kumar",
        financing_type: "loan",
        loan_bank_name: "State Bank of India",
        plant_capacity_kw: 3,
      },
      {
        client_name: "George Varghese",
        financing_type: "self",
        loan_bank_name: null,
        plant_capacity_kw: 5,
      },
    ]);
  });

  it("supports the shared financing filter (?financing=loan)", async () => {
    const { data, count, error } = await svc
      .from("projects_list")
      .select("financing_type", { count: "exact" })
      .eq("financing_type", "loan");
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.financing_type).toBe("loan");
  });
});

describe("coordinators on a sale", () => {
  async function sharedSale(name: string) {
    return fx.approvedProject({
      workOrder: { client_name: `${name} ${RUN}`, coordinator_id: RAHUL },
      partners: [PRIYA],
    });
  }

  it("are listed in order, as ids, as names and as one label — in both views", async () => {
    const { workOrderId, projectId } = await sharedSale("List Order");

    const read = async () => ({
      workOrder: must(
        await svc
          .from("work_orders_list")
          .select("coordinator_id, coordinator_ids, coordinator_names, coordinator_name")
          .eq("id", workOrderId)
          .single(),
        "work_orders_list",
      ),
      project: must(
        await svc
          .from("projects_list")
          .select("coordinator_id, coordinator_ids, coordinator_names, coordinator_name")
          .eq("id", projectId)
          .single(),
        "projects_list",
      ),
    });

    const expected = {
      coordinator_id: RAHUL,
      coordinator_ids: [RAHUL, PRIYA],
      coordinator_names: ["Rahul Menon", "Priya Suresh"],
      coordinator_name: "Rahul Menon, Priya Suresh",
    };
    expect(await read()).toEqual({ workOrder: expected, project: expected });

    await fx.team(workOrderId, [PRIYA, RAHUL]);
    const swapped = {
      coordinator_id: PRIYA,
      coordinator_ids: [PRIYA, RAHUL],
      coordinator_names: ["Priya Suresh", "Rahul Menon"],
      coordinator_name: "Priya Suresh, Rahul Menon",
    };
    expect(await read()).toEqual({ workOrder: swapped, project: swapped });
  });

  it("show a single coordinator exactly as before", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `List Single ${RUN}` },
    });
    const wo = must(
      await svc
        .from("work_orders_list")
        .select("coordinator_name, coordinator_ids, coordinator_names")
        .eq("id", workOrderId)
        .single(),
      "work_orders_list",
    );
    expect(wo).toEqual({
      coordinator_name: "Rahul Menon",
      coordinator_ids: [RAHUL],
      coordinator_names: ["Rahul Menon"],
    });
    const pr = must(
      await svc
        .from("projects_list")
        .select("coordinator_name")
        .eq("id", projectId)
        .single(),
      "projects_list",
    );
    expect(pr.coordinator_name).toBe("Rahul Menon");
  });

  it("let a partner see both names, and the office filter by any member", async () => {
    const { workOrderId } = await sharedSale("List Partner");
    const priya = await signedInAs(USERS.priya);
    const seen = must(
      await priya
        .from("work_orders_list")
        .select("coordinator_ids, coordinator_names, coordinator_name")
        .eq("id", workOrderId)
        .single(),
      "partner's row",
    );
    expect(seen).toEqual({
      coordinator_ids: [RAHUL, PRIYA],
      coordinator_names: ["Rahul Menon", "Priya Suresh"],
      coordinator_name: "Rahul Menon, Priya Suresh",
    });

    // The filter the lists use: ?coordinator=<id> → coordinator_ids @> {id}.
    const admin = await signedInAs(USERS.admin);
    const idsFor = async (coordinatorId: string) =>
      must(
        await admin
          .from("work_orders_list")
          .select("id")
          .contains("coordinator_ids", [coordinatorId])
          .eq("id", workOrderId),
        "filtered",
      ).map((r) => r.id);
    expect(await idsFor(RAHUL)).toEqual([workOrderId]);
    expect(await idsFor(PRIYA)).toEqual([workOrderId]);
    expect(await idsFor(USERS.arun.id)).toEqual([]);

    // The seeded shared sale is found by either of its two people.
    for (const id of [RAHUL, PRIYA]) {
      const rows = must(
        await admin
          .from("projects_list")
          .select("client_name")
          .contains("coordinator_ids", [id])
          .eq("client_name", "Harikrishnan Nair"),
        "seeded shared sale",
      );
      expect(rows).toHaveLength(1);
    }
  });

  it("are not shown to someone who is not on the sale", async () => {
    const { workOrderId, projectId } = await sharedSale("List Stranger");
    const arun = await signedInAs(USERS.arun);
    for (const [view, id] of [
      ["work_orders_list", workOrderId],
      ["projects_list", projectId],
    ] as const) {
      const { data, error } = await arun.from(view).select("id").eq("id", id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});

describe("the new list columns", () => {
  it("carry the plan, the cancellation and its remarks", async () => {
    const custom = await fx.approvedProject({
      workOrder: {
        client_name: `Cols Custom ${RUN}`,
        plan_type: "custom",
        plant_capacity: "1 panel",
      },
    });
    const cancelled = await fx.approvedProject({
      workOrder: { client_name: `Cols Cancelled ${RUN}` },
      project: {
        cancellation: "refunded",
        cancelled_on: "2026-09-20",
        cancellation_remarks: "Refunded ₹10,000 by UPI",
      },
    });

    const workOrders = must(
      await svc
        .from("work_orders_list")
        .select("id, plan_type, cancellation, cancelled_on")
        .in("id", [custom.workOrderId, cancelled.workOrderId]),
      "work_orders_list",
    );
    const byId = new Map(workOrders.map((r) => [r.id, r]));
    expect(byId.get(custom.workOrderId)).toMatchObject({
      plan_type: "custom",
      cancellation: null,
      cancelled_on: null,
    });
    expect(byId.get(cancelled.workOrderId)).toMatchObject({
      plan_type: "solar",
      cancellation: "refunded",
      cancelled_on: "2026-09-20",
    });

    const projects = must(
      await svc
        .from("projects_list")
        .select("id, plan_type, cancellation, cancelled_on, cancellation_remarks")
        .in("id", [custom.projectId, cancelled.projectId]),
      "projects_list",
    );
    const byProject = new Map(projects.map((r) => [r.id, r]));
    expect(byProject.get(custom.projectId)).toMatchObject({
      plan_type: "custom",
      cancellation: null,
      cancellation_remarks: null,
    });
    expect(byProject.get(cancelled.projectId)).toMatchObject({
      plan_type: "solar",
      cancellation: "refunded",
      cancelled_on: "2026-09-20",
      cancellation_remarks: "Refunded ₹10,000 by UPI",
    });
  });

  it("filter the way the lists do (status, plan, cancellation)", async () => {
    const closed = await fx.approvedProject({
      workOrder: { client_name: `Filter Closed ${RUN}` },
      project: { cancellation: "cancelled" },
    });
    const live = await fx.approvedProject({
      workOrder: { client_name: `Filter Live ${RUN}` },
    });
    const ids = [closed.projectId, live.projectId];

    const active = must(
      await svc
        .from("projects_list")
        .select("id")
        .in("id", ids)
        .eq("is_completed", false)
        .is("cancellation", null),
      "active",
    );
    expect(active.map((r) => r.id)).toEqual([live.projectId]);
    const cancelledOnly = must(
      await svc.from("projects_list").select("id").in("id", ids).eq("cancellation", "cancelled"),
      "cancelled",
    );
    expect(cancelledOnly.map((r) => r.id)).toEqual([closed.projectId]);
    const anyClosed = must(
      await svc.from("projects_list").select("id").in("id", ids).not("cancellation", "is", null),
      "closed",
    );
    expect(anyClosed.map((r) => r.id)).toEqual([closed.projectId]);
    const custom = must(
      await svc.from("projects_list").select("id").in("id", ids).eq("plan_type", "custom"),
      "custom",
    );
    expect(custom).toEqual([]);
  });
});

/**
 * The build deployed before this release reads these views by column name. The
 * old definitions are replayed here (from migration 20261010120600) so a test,
 * not an eyeball, says the new views still answer them identically.
 */
describe("the views, as the previous build reads them", () => {
  const OLD_WORK_ORDERS_LIST = `
    create temp view old_work_orders_list as
    select
      w.id, w.coordinator_id, w.client_name, w.client_phone, w.address,
      w.plant_capacity, w.plant_capacity_kw, w.advance_amount, w.total_cost,
      w.order_date, w.status, w.created_at, w.updated_at,
      co.full_name as coordinator_name,
      pr.id as project_id, pr.current_stage, pr.is_completed,
      w.consumer_number, w.notes, w.kseb_section,
      w.financing_type, w.loan_bank_name,
      coalesce(pay.contract_total, 0)::numeric(12,2) as payments_total,
      coalesce(pay.contract_count, 0)::integer as payment_count,
      pay.last_paid_on as last_payment_on,
      (coalesce(w.advance_amount, 0) + coalesce(pay.contract_total, 0))::numeric(12,2)
        as amount_received,
      (w.total_cost - coalesce(w.advance_amount, 0) - coalesce(pay.contract_total, 0))::numeric(12,2)
        as balance_due
    from public.work_orders w
    left join public.profiles co on co.id = w.coordinator_id
    left join public.projects pr on pr.work_order_id = w.id
    left join lateral (
      select
        sum(p.amount) filter (where p.purpose = 'contract') as contract_total,
        count(*) filter (where p.purpose = 'contract') as contract_count,
        max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on
      from public.payments p
      where p.work_order_id = w.id
    ) pay on true`;

  const OLD_PROJECTS_LIST = `
    create temp view old_projects_list as
    select
      pr.id, pr.coordinator_id, pr.work_order_id, pr.current_stage, pr.is_completed,
      pr.created_at, pr.started_at, pr.completed_at,
      wo.client_name, wo.client_phone, wo.address,
      wo.plant_capacity, wo.plant_capacity_kw, wo.total_cost, wo.advance_amount,
      co.full_name as coordinator_name,
      (select count(*) from public.project_milestones m
         where m.project_id = pr.id and m.status = 'completed') as milestones_done,
      (select count(*) from public.project_milestones m
         where m.project_id = pr.id) as milestones_total,
      wo.consumer_number, wo.kseb_section, wo.financing_type, wo.loan_bank_name,
      coalesce(pay.contract_total, 0)::numeric(12,2) as payments_total,
      coalesce(pay.contract_count, 0)::integer as payment_count,
      pay.last_paid_on as last_payment_on,
      (coalesce(wo.advance_amount, 0) + coalesce(pay.contract_total, 0))::numeric(12,2)
        as amount_received,
      (coalesce(wo.total_cost, 0) - coalesce(wo.advance_amount, 0)
         - coalesce(pay.contract_total, 0))::numeric(12,2) as balance_due,
      (pr.is_completed
        and coalesce(wo.total_cost, 0) - coalesce(wo.advance_amount, 0)
            - coalesce(pay.contract_total, 0) > 0) as payment_pending,
      pr.feasibility_date,
      fz.periods as feasibility_periods,
      (fz.periods - 1) as feasibility_renewals,
      (pr.feasibility_date + fz.periods * public.feasibility_validity_days())
        as feasibility_valid_until,
      case when not pr.is_completed and pr.feasibility_date is not null
           then (pr.feasibility_date + fz.periods * public.feasibility_validity_days())
                - public.ist_today()
      end as feasibility_days_left,
      coalesce((fz.periods - 1) * public.feasibility_renewal_fee(), 0)::numeric(12,2)
        as feasibility_extension_cost,
      pr.coordinator_incentive, pr.incentive_paid_on
    from public.projects pr
    left join public.work_orders wo on wo.id = pr.work_order_id
    left join public.profiles co on co.id = pr.coordinator_id
    left join lateral (
      select
        sum(p.amount) filter (where p.purpose = 'contract') as contract_total,
        count(*) filter (where p.purpose = 'contract') as contract_count,
        max(p.paid_on) filter (where p.purpose = 'contract') as last_paid_on
      from public.payments p
      where p.work_order_id = pr.work_order_id
    ) pay on true
    cross join lateral (
      select public.feasibility_periods(
        pr.feasibility_date,
        coalesce((pr.completed_at at time zone 'Asia/Kolkata')::date, public.ist_today())
      ) as periods
    ) fz`;

  /** name, type and position of a view's columns. */
  async function columns(db: import("pg").Client, view: string) {
    const { rows } = await db.query<{ name: string; type: string; pos: number }>(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
              a.attnum::int as pos
         from pg_attribute a
        where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
        order by a.attnum`,
      [view],
    );
    return rows;
  }

  it.each([
    ["work_orders_list", "old_work_orders_list", OLD_WORK_ORDERS_LIST],
    ["projects_list", "old_projects_list", OLD_PROJECTS_LIST],
  ])(
    "%s keeps every old column's name, type and position, and only appends",
    async (view, oldView, oldSql) => {
      await rolledBack(async (db) => {
        await db.query(oldSql);
        const before = await columns(db, `pg_temp.${oldView}`);
        const after = await columns(db, `public.${view}`);
        expect(after.length).toBeGreaterThan(before.length);
        expect(after.slice(0, before.length)).toEqual(before);
      });
    },
  );

  it("answer identically for a solar, live sale with one coordinator", async () => {
    // Written the way the previous build writes them: through the legacy
    // incentive columns (the temporary mirror carries them to the new table).
    const withIncentive = await fx.approvedProject({
      workOrder: { client_name: `Old Reads Unpaid ${RUN}`, advance_amount: 20000 },
      project: { feasibility_date: "2026-08-01" },
    });
    const paidIncentive = await fx.approvedProject({
      workOrder: { client_name: `Old Reads Paid ${RUN}` },
      project: {
        feasibility_date: "2026-07-01",
        is_completed: true,
        current_stage: "plant_commissioning",
        completed_at: "2026-09-01T10:00:00Z",
      },
    });
    await fx.payment(paidIncentive.workOrderId, { amount: 50000 });
    must(
      await svc
        .from("projects")
        .update({ coordinator_incentive: 2000 })
        .eq("id", withIncentive.projectId)
        .select("id"),
      "legacy incentive",
    );
    must(
      await svc
        .from("projects")
        .update({ coordinator_incentive: 3000, incentive_paid_on: "2026-09-10" })
        .eq("id", paidIncentive.projectId)
        .select("id"),
      "legacy paid incentive",
    );

    await rolledBack(async (db) => {
      await db.query(OLD_WORK_ORDERS_LIST);
      await db.query(OLD_PROJECTS_LIST);

      const diff = async (view: string, oldView: string, skip: string[] = []) => {
        const old = await columns(db, `pg_temp.${oldView}`);
        const list = old
          .map((c) => c.name)
          .filter((n) => !skip.includes(n))
          .map((n) => `"${n}"`)
          .join(", ");
        // The rows the old build's rules still describe: one coordinator,
        // solar, not cancelled.
        const comparable = `cardinality(n.coordinator_ids) = 1 and n.plan_type = 'solar' and n.cancellation is null`;
        const { rows } = await db.query<{ side: string; row: string }>(
          `with n as (select ${list}, id as _id from public.${view} n where ${comparable}),
                o as (select ${list}, id as _id from ${oldView}
                       where id in (select id from public.${view} n where ${comparable}))
           select 'new only' as side, to_jsonb(x)::text as row
             from (select * from n except select * from o) x
           union all
           select 'old only', to_jsonb(y)::text
             from (select * from o except select * from n) y`,
        );
        return { compared: old.length - skip.length, differences: rows };
      };

      const wo = await diff("work_orders_list", "old_work_orders_list");
      expect(wo.differences).toEqual([]);
      // The two incentive columns were the project's own; the seed (and the new
      // build) write the new table instead, so they are compared on the rows
      // written the old way.
      const legacy = ["coordinator_incentive", "incentive_paid_on"];
      const pr = await diff("projects_list", "old_projects_list", legacy);
      expect(pr.differences).toEqual([]);

      const fixtures = [withIncentive.projectId, paidIncentive.projectId];
      const { rows: incentives } = await db.query<{
        id: string;
        old: string;
        new: string;
      }>(
        `select o.id, row(o.coordinator_incentive, o.incentive_paid_on)::text as old,
                row(n.coordinator_incentive, n.incentive_paid_on)::text as new
           from old_projects_list o
           join public.projects_list n on n.id = o.id
          where o.id = any ($1)`,
        [fixtures],
      );
      expect(incentives).toHaveLength(2);
      for (const row of incentives) expect(row.new, row.id).toBe(row.old);
      expect(incentives.map((r) => r.old).sort()).toEqual([
        "(2000.00,)",
        "(3000.00,2026-09-10)",
      ]);
    });
  });
});
