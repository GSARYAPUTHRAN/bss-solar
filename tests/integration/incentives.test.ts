import { describe, it, expect, afterAll } from "vitest";
import { serviceClient, signedInAs, USERS } from "./helpers";
import { createFixtures, must } from "./fixtures";

/**
 * Coordinator incentives live on `projects` (migration 20261010120300), which
 * is office-write by RLS: a coordinator reads their own incentive but can never
 * set or "mark paid" it. `incentive_summary()` is SECURITY INVOKER, so its
 * totals are scoped by the same RLS.
 */
const svc = serviceClient();
const fx = createFixtures(svc);

afterAll(() => fx.cleanup());

type Summary = {
  projects: number;
  pending_projects: number;
  total: number;
  paid: number;
  pending: number;
};

/** What incentive_summary() must return, computed from the raw table. */
async function expectedSummary(coordinatorId?: string): Promise<Summary> {
  let query = svc
    .from("projects")
    .select("coordinator_incentive, incentive_paid_on")
    .not("coordinator_incentive", "is", null);
  if (coordinatorId) query = query.eq("coordinator_id", coordinatorId);
  const rows = must(await query, "incentives");
  const sum = (filter: (r: (typeof rows)[number]) => boolean) =>
    rows
      .filter(filter)
      .reduce((s, r) => s + Number(r.coordinator_incentive), 0);
  return {
    projects: rows.length,
    pending_projects: rows.filter((r) => r.incentive_paid_on === null).length,
    total: sum(() => true),
    paid: sum((r) => r.incentive_paid_on !== null),
    pending: sum((r) => r.incentive_paid_on === null),
  };
}

describe("a coordinator's incentive", () => {
  it("is visible to the coordinator, on their own projects only", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const rows = must(
      await rahul
        .from("projects_list")
        .select(
          "client_name, coordinator_id, coordinator_incentive, incentive_paid_on",
        )
        .not("coordinator_incentive", "is", null),
      "rahul's incentives",
    );
    for (const row of rows) expect(row.coordinator_id).toBe(USERS.rahul.id);
    const byClient = new Map(rows.map((r) => [r.client_name, r]));
    // Seed: Anand Kumar ₹3,000 still to pay, Mary Jose ₹5,000 paid.
    expect(byClient.get("Anand Kumar")).toMatchObject({
      coordinator_incentive: 3000,
      incentive_paid_on: null,
    });
    expect(byClient.get("Mary Jose")?.coordinator_incentive).toBe(5000);
    expect(byClient.get("Mary Jose")?.incentive_paid_on).not.toBeNull();
  });

  it("cannot be set, changed or marked paid by the coordinator", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: "Incentive Fixture" },
      project: { coordinator_incentive: 2000 },
    });
    const rahul = await signedInAs(USERS.rahul);

    const { data, error } = await rahul
      .from("projects")
      .update({ coordinator_incentive: 99999, incentive_paid_on: "2026-10-01" })
      .eq("id", projectId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const row = must(
      await svc
        .from("projects")
        .select("coordinator_incentive, incentive_paid_on")
        .eq("id", projectId)
        .single(),
      "project",
    );
    expect(row).toEqual({
      coordinator_incentive: 2000,
      incentive_paid_on: null,
    });
  });

  it("is set and marked paid by the office", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: "Incentive Office Fixture" },
    });
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("projects")
      .update({ coordinator_incentive: 4500, incentive_paid_on: "2026-10-05" })
      .eq("id", projectId)
      .select("coordinator_incentive, incentive_paid_on");
    expect(error).toBeNull();
    expect(data).toEqual([
      { coordinator_incentive: 4500, incentive_paid_on: "2026-10-05" },
    ]);
  });
});

describe("incentive integrity", () => {
  it("rejects a negative incentive", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: "Incentive Negative Fixture" },
    });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("projects")
      .update({ coordinator_incentive: -1 })
      .eq("id", projectId);
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/projects_incentive_non_negative/);
  });

  it("rejects a paid date without an amount", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: "Incentive Paid Fixture" },
    });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("projects")
      .update({ incentive_paid_on: "2026-10-01" })
      .eq("id", projectId);
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/projects_incentive_paid_needs_amount/);
  });

  it("accepts a zero incentive (explicitly none)", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: "Incentive Zero Fixture" },
    });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("projects")
      .update({ coordinator_incentive: 0 })
      .eq("id", projectId);
    expect(error).toBeNull();
  });
});

describe("incentive_summary()", () => {
  it("totals every project for the office", async () => {
    const admin = await signedInAs(USERS.admin);
    const summary = must(
      await admin.rpc("incentive_summary").single(),
      "summary",
    );
    expect(summary).toEqual(await expectedSummary());
    expect(summary.projects).toBeGreaterThan(0);
    expect(summary.paid).toBeGreaterThan(0);
    expect(summary.pending).toBeGreaterThan(0);
  });

  it("narrows to one coordinator when asked", async () => {
    const admin = await signedInAs(USERS.admin);
    const summary = must(
      await admin
        .rpc("incentive_summary", { p_coordinator: USERS.rahul.id })
        .single(),
      "summary",
    );
    expect(summary).toEqual(await expectedSummary(USERS.rahul.id));
  });

  it("only ever sums a coordinator's own projects (RLS)", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const own = must(
      await rahul.rpc("incentive_summary").single(),
      "own summary",
    );
    expect(own).toEqual(await expectedSummary(USERS.rahul.id));

    // Asking for a colleague's figures yields nothing, not their totals.
    const peek = must(
      await rahul
        .rpc("incentive_summary", { p_coordinator: USERS.arun.id })
        .single(),
      "peek",
    );
    expect(peek).toEqual({ projects: 0, pending_projects: 0, total: 0, paid: 0, pending: 0 });
    expect((await expectedSummary(USERS.arun.id)).projects).toBeGreaterThan(0);
  });

  it("feeds the dashboard's pending figure, scoped the same way", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const m = must(
      await rahul.rpc("dashboard_metrics").single(),
      "dashboard_metrics",
    );
    expect(Number(m.incentive_pending)).toBe(
      (await expectedSummary(USERS.rahul.id)).pending,
    );
  });
});
