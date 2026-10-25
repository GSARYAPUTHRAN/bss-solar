import { describe, it, expect, afterEach } from "vitest";
import {
  rolledBack,
  serviceClient,
  signedInAs,
  USERS,
  type SeedUser,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";

/**
 * Each coordinator's incentive lives in `coordinator_incentives`: one row per
 * member of a sale, private to that person and the office (migrations
 * 20261022120000 / 20261022120200). The office sets `amount` and `paid_on`
 * and nothing else; a coordinator reads their own row and can never set or
 * "mark paid" it. `incentive_summary()` is SECURITY INVOKER, so its totals are
 * scoped by the same RLS. The old `projects.coordinator_incentive` columns
 * are only a temporary, one-way compatibility path for the previous build.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

/** A well-formed id that no row has. */
const NO_SUCH_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

afterEach(() => fx.cleanup());

type Summary = {
  projects: number;
  pending_projects: number;
  total: number;
  paid: number;
  pending: number;
};

/** What incentive_summary() must return, computed from the raw tables. */
async function expectedSummary(coordinatorId?: string): Promise<Summary> {
  const incentives = must(
    await svc
      .from("coordinator_incentives")
      .select("work_order_id, coordinator_id, amount, paid_on")
      .not("amount", "is", null),
    "incentives",
  );
  // An incentive counts while its sale has a project.
  const withProject = new Set(
    must(await svc.from("projects").select("work_order_id"), "projects").map(
      (p) => p.work_order_id,
    ),
  );
  const rows = incentives.filter(
    (i) =>
      withProject.has(i.work_order_id) &&
      (!coordinatorId || i.coordinator_id === coordinatorId),
  );
  const sum = (filter: (r: (typeof rows)[number]) => boolean) =>
    rows.filter(filter).reduce((s, r) => s + Number(r.amount), 0);
  const sales = (filter: (r: (typeof rows)[number]) => boolean) =>
    new Set(rows.filter(filter).map((r) => r.work_order_id)).size;
  return {
    projects: sales(() => true),
    pending_projects: sales((r) => r.paid_on === null),
    total: sum(() => true),
    paid: sum((r) => r.paid_on !== null),
    pending: sum((r) => r.paid_on === null),
  };
}

/** A sale Rahul and Priya share, with a different incentive for each. */
async function sharedSale(name: string) {
  const sale = await fx.approvedProject({
    workOrder: { client_name: `${name} ${RUN}` },
    partners: [PRIYA],
  });
  await fx.incentive(sale.workOrderId, RAHUL, { amount: 4000 });
  await fx.incentive(sale.workOrderId, PRIYA, { amount: 2500, paid_on: "2026-10-01" });
  return sale;
}

describe("a coordinator's incentive", () => {
  it("is visible to the coordinator, on their own sales only", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const rows = must(
      await rahul
        .from("projects_list")
        .select("client_name, coordinator_incentive, incentive_paid_on")
        .not("coordinator_incentive", "is", null),
      "rahul's incentives",
    );
    const byClient = new Map(rows.map((r) => [r.client_name, r]));
    // Seed: Anand Kumar ₹3,000 still to pay, Mary Jose ₹5,000 paid.
    expect(byClient.get("Anand Kumar")).toMatchObject({
      coordinator_incentive: 3000,
      incentive_paid_on: null,
    });
    expect(byClient.get("Mary Jose")?.coordinator_incentive).toBe(5000);
    expect(byClient.get("Mary Jose")?.incentive_paid_on).not.toBeNull();
    // Another coordinator's sale carries no figure for him.
    expect(byClient.has("George Varghese")).toBe(false);

    // The table holds Rahul's rows and nobody else's.
    const own = must(
      await rahul.from("coordinator_incentives").select("coordinator_id"),
      "rahul's rows",
    );
    expect(own.length).toBeGreaterThan(0);
    for (const row of own) expect(row.coordinator_id).toBe(RAHUL);
  });

  it("is private on a shared sale: each partner reads only their own row, in the table and in the list", async () => {
    const { workOrderId, projectId } = await sharedSale("Private Pay");
    const rowsFor = async (user: SeedUser) =>
      must(
        await (await signedInAs(user))
          .from("coordinator_incentives")
          .select("coordinator_id, amount, paid_on")
          .eq("work_order_id", workOrderId),
        `${user.email}'s rows`,
      );
    expect(await rowsFor(USERS.rahul)).toEqual([
      { coordinator_id: RAHUL, amount: 4000, paid_on: null },
    ]);
    expect(await rowsFor(USERS.priya)).toEqual([
      { coordinator_id: PRIYA, amount: 2500, paid_on: "2026-10-01" },
    ]);
    expect((await rowsFor(USERS.admin)).map((r) => r.coordinator_id).sort()).toEqual(
      [RAHUL, PRIYA].sort(),
    );
    expect(await rowsFor(USERS.arun)).toEqual([]);

    // Not even the aggregates of projects_list show a partner the other's pay.
    const columns =
      "incentive_total, incentive_unpaid, incentive_count, incentive_unpaid_count, incentive_unpaid_coordinator_ids, incentive_paid_coordinator_ids, coordinator_incentive, incentive_paid_on";
    const listFor = async (user: SeedUser) =>
      must(
        await (await signedInAs(user))
          .from("projects_list")
          .select(columns)
          .eq("id", projectId)
          .single(),
        `${user.email}'s list row`,
      );
    expect(await listFor(USERS.rahul)).toEqual({
      incentive_total: 4000,
      incentive_unpaid: 4000,
      incentive_count: 1,
      incentive_unpaid_count: 1,
      incentive_unpaid_coordinator_ids: [RAHUL],
      incentive_paid_coordinator_ids: [],
      coordinator_incentive: 4000,
      incentive_paid_on: null,
    });
    expect(await listFor(USERS.priya)).toEqual({
      incentive_total: 2500,
      incentive_unpaid: 0,
      incentive_count: 1,
      incentive_unpaid_count: 0,
      incentive_unpaid_coordinator_ids: [],
      incentive_paid_coordinator_ids: [PRIYA],
      coordinator_incentive: 2500,
      incentive_paid_on: "2026-10-01",
    });
    // The office sees everyone's, and the sale is only "paid" once all are.
    expect(await listFor(USERS.admin)).toEqual({
      incentive_total: 6500,
      incentive_unpaid: 4000,
      incentive_count: 2,
      incentive_unpaid_count: 1,
      incentive_unpaid_coordinator_ids: [RAHUL],
      incentive_paid_coordinator_ids: [PRIYA],
      coordinator_incentive: 6500,
      incentive_paid_on: null,
    });
  });

  it("cannot be set, changed or marked paid by the coordinator", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Fixture ${RUN}` },
    });
    await fx.incentive(workOrderId, RAHUL, { amount: 2000 });
    const rahul = await signedInAs(USERS.rahul);

    const { data, error } = await rahul
      .from("coordinator_incentives")
      .update({ amount: 99999, paid_on: "2026-10-01" })
      .eq("work_order_id", workOrderId)
      .select("work_order_id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const inserted = await rahul.from("coordinator_incentives").insert({
      work_order_id: workOrderId,
      coordinator_id: PRIYA,
      amount: 1,
    });
    expect(inserted.error?.code).toBe("42501");
    const deleted = await rahul
      .from("coordinator_incentives")
      .delete()
      .eq("work_order_id", workOrderId);
    expect(deleted.error?.code).toBe("42501");

    const row = must(
      await svc
        .from("coordinator_incentives")
        .select("amount, paid_on")
        .eq("work_order_id", workOrderId)
        .eq("coordinator_id", RAHUL)
        .single(),
      "incentive",
    );
    expect(row).toEqual({ amount: 2000, paid_on: null });
  });

  it("is set and marked paid by the office, who is recorded as having done so", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Office Fixture ${RUN}` },
    });
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("coordinator_incentives")
      .update({ amount: 4500, paid_on: "2026-10-05" })
      .eq("work_order_id", workOrderId)
      .eq("coordinator_id", RAHUL)
      .select("amount, paid_on, updated_by");
    expect(error).toBeNull();
    expect(data).toEqual([
      { amount: 4500, paid_on: "2026-10-05", updated_by: USERS.admin.id },
    ]);
  });

  it("is the only thing of the row the office can write", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Columns ${RUN}` },
    });
    const admin = await signedInAs(USERS.admin);
    const match = { work_order_id: workOrderId, coordinator_id: RAHUL };

    // Not the stamps, nor who the row belongs to.
    for (const change of [
      { updated_by: USERS.rahul.id },
      { updated_at: "2020-01-01T00:00:00Z" },
      { created_at: "2020-01-01T00:00:00Z" },
      { coordinator_id: PRIYA },
      { work_order_id: NO_SUCH_ID },
    ]) {
      const { error } = await admin
        .from("coordinator_incentives")
        .update(change)
        .match(match);
      expect(error?.code, JSON.stringify(change)).toBe("42501");
    }

    // Rows come and go with the membership, never by hand — not even the SuperAdmin's.
    for (const user of [USERS.admin, USERS.superadmin]) {
      const client = await signedInAs(user);
      const insert = await client.from("coordinator_incentives").insert({
        work_order_id: workOrderId,
        coordinator_id: PRIYA,
      });
      expect(insert.error?.code, `insert as ${user.email}`).toBe("42501");
      const remove = await client
        .from("coordinator_incentives")
        .delete()
        .match(match);
      expect(remove.error?.code, `delete as ${user.email}`).toBe("42501");
    }
    const left = must(
      await svc
        .from("coordinator_incentives")
        .select("coordinator_id")
        .eq("work_order_id", workOrderId),
      "rows",
    );
    expect(left).toEqual([{ coordinator_id: RAHUL }]);
  });

  it("restamps updated_at only when the money changes", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Stamp ${RUN}` },
    });
    await fx.incentive(workOrderId, RAHUL, { amount: 1000 });

    await rolledBack(async (db) => {
      const where = "work_order_id = $1 and coordinator_id = $2";
      const args = [workOrderId, RAHUL];
      const stamp = async () =>
        (
          await db.query<{ updated_at: string }>(
            `select updated_at::text from public.coordinator_incentives where ${where}`,
            args,
          )
        ).rows[0].updated_at;

      await db.query(
        `update public.coordinator_incentives set updated_at = '2020-01-01 00:00:00+00' where ${where}`,
        args,
      );
      // Saving the same figures again is not a change.
      await db.query(
        `update public.coordinator_incentives set amount = 1000 where ${where}`,
        args,
      );
      expect(await stamp()).toBe("2020-01-01 00:00:00+00");

      await db.query(
        `update public.coordinator_incentives set amount = 1100 where ${where}`,
        args,
      );
      expect(await stamp()).not.toBe("2020-01-01 00:00:00+00");
    });
  });
});

describe("incentive integrity", () => {
  it("rejects a negative incentive", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Negative Fixture ${RUN}` },
    });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("coordinator_incentives")
      .update({ amount: -1 })
      .eq("work_order_id", workOrderId);
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/coordinator_incentives_amount_non_negative/);
  });

  it("rejects a paid date without an amount", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Paid Fixture ${RUN}` },
    });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("coordinator_incentives")
      .update({ paid_on: "2026-10-01" })
      .eq("work_order_id", workOrderId);
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/coordinator_incentives_paid_needs_amount/);
  });

  it("accepts a zero incentive (explicitly none)", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Zero Fixture ${RUN}` },
    });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("coordinator_incentives")
      .update({ amount: 0 })
      .eq("work_order_id", workOrderId);
    expect(error).toBeNull();
  });
});

describe("incentive_summary()", () => {
  it("totals every project for the office, a shared sale counted once", async () => {
    const before = await expectedSummary();
    await sharedSale("Summary Shared");
    const admin = await signedInAs(USERS.admin);
    const summary = must(
      await admin.rpc("incentive_summary").single(),
      "summary",
    );
    expect(summary).toEqual(await expectedSummary());
    expect(summary.projects).toBeGreaterThan(0);
    expect(summary.paid).toBeGreaterThan(0);
    expect(summary.pending).toBeGreaterThan(0);

    // Two people's incentives, one project.
    expect(summary.projects).toBe(before.projects + 1);
    expect(summary.pending_projects).toBe(before.pending_projects + 1);
    expect(summary.total).toBe(before.total + 6500);
    expect(summary.paid).toBe(before.paid + 2500);
    expect(summary.pending).toBe(before.pending + 4000);
  });

  it("narrows to one coordinator when asked", async () => {
    await sharedSale("Summary Narrow");
    const admin = await signedInAs(USERS.admin);
    for (const user of [USERS.rahul, USERS.priya]) {
      const summary = must(
        await admin.rpc("incentive_summary", { p_coordinator: user.id }).single(),
        "summary",
      );
      expect(summary, user.email).toEqual(await expectedSummary(user.id));
    }
    // Priya's share of the shared sale is hers alone.
    const priya = must(
      await admin.rpc("incentive_summary", { p_coordinator: PRIYA }).single(),
      "summary",
    );
    expect(priya.paid).toBeGreaterThanOrEqual(2500);
  });

  it("only ever sums a coordinator's own rows (RLS)", async () => {
    await sharedSale("Summary Own");
    for (const user of [USERS.rahul, USERS.priya]) {
      const own = must(
        await (await signedInAs(user)).rpc("incentive_summary").single(),
        "own summary",
      );
      expect(own, user.email).toEqual(await expectedSummary(user.id));
    }

    // Asking for a colleague's figures yields nothing, not their totals.
    const rahul = await signedInAs(USERS.rahul);
    const peek = must(
      await rahul
        .rpc("incentive_summary", { p_coordinator: USERS.arun.id })
        .single(),
      "peek",
    );
    expect(peek).toEqual({ projects: 0, pending_projects: 0, total: 0, paid: 0, pending: 0 });
    expect((await expectedSummary(USERS.arun.id)).projects).toBeGreaterThan(0);

    const peekPartner = must(
      await rahul.rpc("incentive_summary", { p_coordinator: PRIYA }).single(),
      "peek at a partner",
    );
    expect(peekPartner).toEqual({
      projects: 0,
      pending_projects: 0,
      total: 0,
      paid: 0,
      pending: 0,
    });
  });

  it("feeds the dashboard's pending figure: everyone's for the office, only their own for a coordinator", async () => {
    await sharedSale("Dashboard Pending");
    const pendingFor = async (user: SeedUser) =>
      Number(
        must(
          await (await signedInAs(user)).rpc("dashboard_metrics").single(),
          "dashboard_metrics",
        ).incentive_pending,
      );
    expect(await pendingFor(USERS.admin)).toBe((await expectedSummary()).pending);
    expect(await pendingFor(USERS.rahul)).toBe(
      (await expectedSummary(RAHUL)).pending,
    );
    expect(await pendingFor(USERS.priya)).toBe(
      (await expectedSummary(PRIYA)).pending,
    );
  });

  it("keeps counting a cancelled project's incentive until the office clears it", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Cancelled ${RUN}` },
    });
    await fx.incentive(workOrderId, RAHUL, { amount: 1800 });
    const before = await expectedSummary(RAHUL);
    await svc
      .from("projects")
      .update({ cancellation: "refunded" })
      .eq("id", projectId);

    const rahul = await signedInAs(USERS.rahul);
    const after = must(await rahul.rpc("incentive_summary").single(), "summary");
    expect(after).toEqual(before);
    expect(after.pending).toBeGreaterThanOrEqual(1800);
  });
});

describe("incentives and the project they belong to", () => {
  it("survive the project's deletion, but are not counted while the sale has none", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Incentive Project Delete ${RUN}` },
    });
    await fx.incentive(workOrderId, RAHUL, { amount: 1234 });
    const before = await expectedSummary();

    const superadmin = await signedInAs(USERS.superadmin);
    const deleted = await superadmin
      .from("projects")
      .delete()
      .eq("id", projectId)
      .select("id");
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);

    // The record is still there…
    const row = must(
      await svc
        .from("coordinator_incentives")
        .select("amount")
        .eq("work_order_id", workOrderId)
        .eq("coordinator_id", RAHUL)
        .single(),
      "incentive row",
    );
    expect(row.amount).toBe(1234);
    // …but nobody's summary or KPI counts it without a project.
    const admin = await signedInAs(USERS.admin);
    const summary = must(await admin.rpc("incentive_summary").single(), "summary");
    expect(summary.total).toBe(before.total - 1234);
    expect(summary).toEqual(await expectedSummary());
    const metrics = must(await admin.rpc("dashboard_metrics").single(), "metrics");
    expect(Number(metrics.incentive_pending)).toBe(summary.pending);

    // A new project for the sale (re-approval) brings it back.
    must(
      await svc
        .from("projects")
        .insert({ work_order_id: workOrderId, coordinator_id: RAHUL })
        .select("id")
        .single(),
      "new project",
    );
    expect(
      must(await admin.rpc("incentive_summary").single(), "summary").total,
    ).toBe(before.total);
  });

  it("go with the sale when a work order is deleted", async () => {
    const { workOrderId } = await sharedSale("Incentive Sale Delete");
    const superadmin = await signedInAs(USERS.superadmin);
    const { error } = await superadmin
      .from("work_orders")
      .delete()
      .eq("id", workOrderId);
    expect(error).toBeNull();
    const rows = must(
      await svc
        .from("coordinator_incentives")
        .select("coordinator_id")
        .eq("work_order_id", workOrderId),
      "rows",
    );
    expect(rows).toEqual([]);
  });
});

describe("the previous build's incentive columns (temporary compatibility)", () => {
  it("land on the first coordinator's row when written, and nowhere else", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Legacy Mirror ${RUN}` },
      partners: [PRIYA],
    });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("projects")
      .update({ coordinator_incentive: 4500, incentive_paid_on: "2026-10-05" })
      .eq("id", projectId);
    expect(error).toBeNull();

    const rows = must(
      await svc
        .from("coordinator_incentives")
        .select("coordinator_id, amount, paid_on")
        .eq("work_order_id", workOrderId),
      "rows",
    );
    expect(rows.find((r) => r.coordinator_id === RAHUL)).toEqual({
      coordinator_id: RAHUL,
      amount: 4500,
      paid_on: "2026-10-05",
    });
    expect(rows.find((r) => r.coordinator_id === PRIYA)).toEqual({
      coordinator_id: PRIYA,
      amount: null,
      paid_on: null,
    });

    // Clearing it clears the row.
    await admin
      .from("projects")
      .update({ coordinator_incentive: null, incentive_paid_on: null })
      .eq("id", projectId);
    expect(
      must(
        await svc
          .from("coordinator_incentives")
          .select("amount, paid_on")
          .eq("work_order_id", workOrderId)
          .eq("coordinator_id", RAHUL)
          .single(),
        "row",
      ),
    ).toEqual({ amount: null, paid_on: null });
  });

  it("leave the real incentive alone when a save does not change them (the old Project settings form)", async () => {
    // The previous build's settings save always writes feasibility_date,
    // coordinator_incentive and incentive_paid_on, pre-filled from the legacy
    // columns — which the new build no longer keeps up to date. Saving to fix
    // only the feasibility date must not push those stale values over the
    // incentive the office set with the new build.
    const row = async (workOrderId: string) =>
      must(
        await svc
          .from("coordinator_incentives")
          .select("amount, paid_on")
          .eq("work_order_id", workOrderId)
          .eq("coordinator_id", RAHUL)
          .single(),
        "incentive row",
      );
    const admin = await signedInAs(USERS.admin);

    // 1. Stale legacy values: written by the old build, then superseded.
    const stale = await fx.approvedProject({
      workOrder: { client_name: `Legacy Stale ${RUN}` },
    });
    expect(
      (
        await admin
          .from("projects")
          .update({ coordinator_incentive: 1200, incentive_paid_on: "2026-09-15" })
          .eq("id", stale.projectId)
      ).error,
    ).toBeNull();
    await fx.incentive(stale.workOrderId, RAHUL, {
      amount: 9000,
      paid_on: "2026-10-24",
    });
    const resave = await admin
      .from("projects")
      .update({
        feasibility_date: "2026-10-01",
        coordinator_incentive: 1200,
        incentive_paid_on: "2026-09-15",
      })
      .eq("id", stale.projectId);
    expect(resave.error).toBeNull();
    expect(await row(stale.workOrderId)).toEqual({
      amount: 9000,
      paid_on: "2026-10-24",
    });

    // 2. Blank legacy values: a sale the new build created (or re-shared).
    const blank = await fx.approvedProject({
      workOrder: { client_name: `Legacy Blank ${RUN}` },
    });
    await fx.incentive(blank.workOrderId, RAHUL, { amount: 4000 });
    const blankSave = await admin
      .from("projects")
      .update({
        feasibility_date: "2026-10-02",
        coordinator_incentive: null,
        incentive_paid_on: null,
      })
      .eq("id", blank.projectId);
    expect(blankSave.error).toBeNull();
    expect(await row(blank.workOrderId)).toEqual({ amount: 4000, paid_on: null });

    // A real edit of the legacy columns is still carried over.
    const edit = await admin
      .from("projects")
      .update({ coordinator_incentive: 1500 })
      .eq("id", stale.projectId);
    expect(edit.error).toBeNull();
    expect(await row(stale.workOrderId)).toEqual({
      amount: 1500,
      paid_on: "2026-09-15",
    });
  });

  it("are never written by the new table (no mirror back)", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `No Mirror Back ${RUN}` },
    });
    await fx.incentive(workOrderId, RAHUL, { amount: 3300, paid_on: "2026-10-02" });
    const project = must(
      await svc
        .from("projects")
        .select("coordinator_incentive, incentive_paid_on")
        .eq("id", projectId)
        .single(),
      "project",
    );
    expect(project).toEqual({ coordinator_incentive: null, incentive_paid_on: null });
  });

  it("keep their own integrity checks", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: `Legacy Checks ${RUN}` },
    });
    const admin = await signedInAs(USERS.admin);
    const negative = await admin
      .from("projects")
      .update({ coordinator_incentive: -1 })
      .eq("id", projectId);
    expect(negative.error?.code).toBe("23514");
    expect(negative.error?.message).toMatch(/projects_incentive_non_negative/);
    const paidWithoutAmount = await admin
      .from("projects")
      .update({ incentive_paid_on: "2026-10-01" })
      .eq("id", projectId);
    expect(paidWithoutAmount.error?.code).toBe("23514");
    expect(paidWithoutAmount.error?.message).toMatch(
      /projects_incentive_paid_needs_amount/,
    );
  });

  it("cannot be set by the coordinator through the old route either", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: `Legacy Coordinator ${RUN}` },
    });
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul
      .from("projects")
      .update({ coordinator_incentive: 99999 })
      .eq("id", projectId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
