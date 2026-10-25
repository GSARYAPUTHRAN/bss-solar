import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  anonClient,
  serviceClient,
  signedInAs,
  USERS,
  withDb,
  type SeedUser,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import { istDateOf } from "@/lib/domain/dates";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Bulk onboarding imports through one SECURITY DEFINER call,
 * `import_projects()` (migration 20261010120700): office-only, each row in its
 * own subtransaction so it lands completely or not at all, and every new field
 * of this release (financing, feasibility, incentive, an unlimited payments
 * ledger) carried through. The CSV parsing in front of it is unit-tested in
 * lib/domain; this pins what the database does with the normalised rows.
 * The first describe blocks are the previous build's row shape (coordinator
 * e-mail, one incentive), which the deployed build keeps sending until this
 * release is live; the "resolved coordinators" block is this release's.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const tag = uniqueTag();
/** Owns every row that names no coordinator_email. */
const DEFAULT_COORDINATOR = USERS.priya;

/** Unique per run, so a half-finished earlier run can never collide. */
const consumer = (n: number) => `IMP-${tag}-${n}`;
const client = (n: number) => `Import RPC ${tag} #${n}`;

/** A normalised CSV row, as lib/domain/import.ts hands it to the RPC. */
type ImportRow = {
  row_no: number;
  client_name: string;
  plant_capacity: string;
  total_cost: number;
  [field: string]: Json | undefined;
};

function row(n: number, values: Partial<ImportRow> = {}): ImportRow {
  return {
    row_no: n,
    client_name: client(n),
    plant_capacity: "5kW",
    total_cost: 300000,
    consumer_number: consumer(n),
    ...values,
  };
}

/** The generated types cannot say so, but message and work_order_id are nullable. */
type ImportResult = {
  row_no: number;
  status: string;
  message: string | null;
  work_order_id: string | null;
};

async function runImport(
  rows: ImportRow[],
  opts: { skipExisting?: boolean } = {},
): Promise<Map<number, ImportResult>> {
  const admin = await signedInAs(USERS.admin);
  const results = must(
    await admin.rpc("import_projects", {
      p_rows: rows,
      p_default_coordinator: DEFAULT_COORDINATOR.id,
      p_skip_existing: opts.skipExisting,
    }),
    "import_projects",
  ) as ImportResult[];
  for (const r of results)
    if (r.work_order_id) fx.trackWorkOrder(r.work_order_id);
  return new Map(results.map((r) => [r.row_no, r]));
}

async function workOrdersFor(n: number) {
  return must(
    await svc
      .from("work_orders")
      .select("id")
      .eq("consumer_number", consumer(n)),
    "work order lookup",
  );
}

afterAll(async () => {
  await fx.cleanup();
  // Belt and braces: nothing from this run may outlive it, even after a failure.
  await svc
    .from("work_orders")
    .delete()
    .like("consumer_number", `IMP-${tag}-%`);
});

describe("import_projects — a mixed batch", () => {
  let results: Map<number, ImportResult>;

  beforeAll(async () => {
    results = await runImport([
      // 1. Commissioned, loan-financed, paid in four entries (one KSEB fee).
      row(1, {
        coordinator_email: "  COORD@bsssolar.test ",
        plant_capacity: "4.5 kW",
        total_cost: 280000,
        advance_amount: 30000,
        order_date: "2026-01-05",
        is_completed: true,
        current_stage: "material_dispatch", // ignored: commissioned wins
        commissioned_on: "2026-03-01",
        financing_type: "loan",
        loan_bank_name: "Canara Bank",
        kseb_section: "Pala",
        notes: "Imported from the 2026 register",
        feasibility_date: "2026-01-10",
        coordinator_incentive: 2500,
        incentive_paid_on: "2026-03-10",
        payments: [
          {
            amount: 100000,
            paid_on: "2026-01-20",
            method: "loan_disbursement",
            reference: "CAN-1",
          },
          {
            amount: 80000,
            paid_on: "2026-02-10",
            method: "cheque",
            reference: "CHQ 12",
          },
          { amount: 70000, paid_on: "2026-03-05", method: "upi" },
          {
            amount: 5310,
            paid_on: "2026-01-12",
            method: "cash",
            purpose: "kseb_fees",
          },
        ],
      }),
      // 2. Active, no coordinator email → the default coordinator.
      row(2, { current_stage: "material_dispatch", order_date: "2026-02-01" }),
      // 3. A bad payment must take the whole row down with it.
      row(3, {
        payments: [
          { amount: 1000, paid_on: "2026-02-01" },
          { amount: 0, paid_on: "2026-02-02" },
        ],
      }),
      // 4–5. Only sales/office accounts may own a project.
      row(4, { coordinator_email: "nobody@bsssolar.test" }),
      row(5, { coordinator_email: USERS.anil.email }),
      // 6. Already in the system (seeded Anand Kumar).
      row(6, { consumer_number: "1156789012345" }),
    ]);
  });

  it("reports one outcome per row", () => {
    expect(
      [...results.values()]
        .map(({ row_no, status }) => [row_no, status])
        .sort(),
    ).toEqual([
      [1, "imported"],
      [2, "imported"],
      [3, "failed"],
      [4, "failed"],
      [5, "failed"],
      [6, "skipped"],
    ]);
  });

  it("imports the full record: work order, financing and capacity", async () => {
    const wo = must(
      await svc
        .from("work_orders")
        .select(
          "status, coordinator_id, client_name, plant_capacity_kw, total_cost, advance_amount, order_date, financing_type, loan_bank_name, kseb_section, notes",
        )
        .eq("id", results.get(1)!.work_order_id!)
        .single(),
      "work order",
    );
    expect(wo).toEqual({
      status: "approved",
      coordinator_id: USERS.rahul.id, // email matched case- and space-insensitively
      client_name: client(1),
      plant_capacity_kw: 4.5,
      total_cost: 280000,
      advance_amount: 30000,
      order_date: "2026-01-05",
      financing_type: "loan",
      loan_bank_name: "Canara Bank",
      kseb_section: "Pala",
      notes: "Imported from the 2026 register",
    });
  });

  it("commissions the project on the IST date given, with feasibility and incentive", async () => {
    const project = must(
      await svc
        .from("projects")
        .select(
          "id, coordinator_id, current_stage, is_completed, started_at, completed_at, feasibility_date, coordinator_incentive, incentive_paid_on",
        )
        .eq("work_order_id", results.get(1)!.work_order_id!)
        .single(),
      "project",
    );
    expect(project).toMatchObject({
      coordinator_id: USERS.rahul.id,
      current_stage: "plant_commissioning",
      is_completed: true,
      feasibility_date: "2026-01-10",
      coordinator_incentive: 2500,
      incentive_paid_on: "2026-03-10",
    });
    expect(istDateOf(project.completed_at!)).toBe("2026-03-01");
    expect(istDateOf(project.started_at)).toBe("2026-01-05");

    // The previous build's single incentive is its only coordinator's own row.
    const incentive = must(
      await svc
        .from("coordinator_incentives")
        .select("coordinator_id, amount, paid_on")
        .eq("work_order_id", results.get(1)!.work_order_id!),
      "incentive row",
    );
    expect(incentive).toEqual([
      { coordinator_id: USERS.rahul.id, amount: 2500, paid_on: "2026-03-10" },
    ]);

    const milestones = must(
      await svc
        .from("project_milestones")
        .select("status")
        .eq("project_id", project.id),
      "milestones",
    );
    expect(milestones).toHaveLength(9);
    expect(milestones.every((m) => m.status === "completed")).toBe(true);
  });

  it("records every payment in the ledger, attributed to the importer", async () => {
    const payments = must(
      await svc
        .from("payments")
        .select("amount, paid_on, method, purpose, reference, recorded_by")
        .eq("work_order_id", results.get(1)!.work_order_id!)
        .order("paid_on"),
      "payments",
    );
    expect(payments).toEqual([
      {
        amount: 5310,
        paid_on: "2026-01-12",
        method: "cash",
        purpose: "kseb_fees",
        reference: null,
        recorded_by: USERS.admin.id,
      },
      {
        amount: 100000,
        paid_on: "2026-01-20",
        method: "loan_disbursement",
        purpose: "contract",
        reference: "CAN-1",
        recorded_by: USERS.admin.id,
      },
      {
        amount: 80000,
        paid_on: "2026-02-10",
        method: "cheque",
        purpose: "contract",
        reference: "CHQ 12",
        recorded_by: USERS.admin.id,
      },
      {
        amount: 70000,
        paid_on: "2026-03-05",
        method: "upi",
        purpose: "contract",
        reference: null,
        recorded_by: USERS.admin.id,
      },
    ]);

    const listed = must(
      await svc
        .from("projects_list")
        .select("payment_count, amount_received, balance_due, payment_pending")
        .eq("work_order_id", results.get(1)!.work_order_id!)
        .single(),
      "project list row",
    );
    // 30,000 advance + 2,50,000 contract stages = 2,80,000 — settled.
    expect(listed).toEqual({
      payment_count: 3,
      amount_received: 280000,
      balance_due: 0,
      payment_pending: false,
    });
  });

  it("advances an active project to its stage, owned by the default coordinator", async () => {
    const project = must(
      await svc
        .from("projects")
        .select("id, coordinator_id, current_stage, is_completed, completed_at")
        .eq("work_order_id", results.get(2)!.work_order_id!)
        .single(),
      "project",
    );
    expect(project).toMatchObject({
      coordinator_id: DEFAULT_COORDINATOR.id,
      current_stage: "material_dispatch",
      is_completed: false,
      completed_at: null,
    });

    const wo = must(
      await svc
        .from("work_orders")
        .select("financing_type, coordinator_id")
        .eq("id", results.get(2)!.work_order_id!)
        .single(),
      "work order",
    );
    expect(wo).toEqual({
      financing_type: "self",
      coordinator_id: DEFAULT_COORDINATOR.id,
    });

    const milestones = must(
      await svc
        .from("project_milestones")
        .select("sort_order, status")
        .eq("project_id", project.id)
        .order("sort_order"),
      "milestones",
    );
    expect(milestones.map((m) => m.status)).toEqual([
      "completed",
      "completed",
      "completed", // before material_dispatch (sort 4)
      "in_progress",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("leaves nothing behind for a row that failed part-way", async () => {
    expect(results.get(3)!.message).toMatch(/payments_amount_positive/);
    expect(results.get(3)!.work_order_id).toBeNull();
    // The work order, project and first payment were all rolled back.
    expect(await workOrdersFor(3)).toEqual([]);
    const orphans = must(
      await svc.from("projects_list").select("id").eq("client_name", client(3)),
      "orphan projects",
    );
    expect(orphans).toEqual([]);
  });

  it("refuses an unknown or non-sales coordinator email instead of guessing", async () => {
    expect(results.get(4)!.message).toMatch(/nobody@bsssolar\.test/);
    expect(results.get(5)!.message).toMatch(/engineer@bsssolar\.test/);
    expect(await workOrdersFor(4)).toEqual([]);
    expect(await workOrdersFor(5)).toEqual([]);
  });

  it("skips a consumer number that already exists, naming the client", () => {
    const skipped = results.get(6)!;
    expect(skipped.work_order_id).toBeNull();
    expect(skipped.message).toMatch(/1156789012345.*Anand Kumar/);
  });
});

/**
 * The importer this release sends: every row carries its coordinators already
 * resolved to ids (1..5, the first is the first coordinator), a plan, and
 * optionally a cancellation (migration 20261022120300). The name matching that
 * produces them is unit-tested in lib/domain; this pins what the database does
 * with them — and that a bad row takes down only itself.
 */
describe("import_projects — resolved coordinators, plans and cancellations", () => {
  const RAHUL = USERS.rahul.id;
  const PRIYA = USERS.priya.id;
  const ARUN = USERS.arun.id;
  const SNEHA = USERS.sneha.id;
  const tagV3 = uniqueTag();
  const consumerV3 = (n: number) => `IMP3-${tagV3}-${n}`;
  const clientV3 = (n: number) => `Import v3 ${tagV3} #${n}`;

  /** A row in this release's shape, for one coordinator unless told otherwise. */
  function rowV3(n: number, values: Partial<ImportRow> = {}): ImportRow {
    return {
      row_no: n,
      client_name: clientV3(n),
      plant_capacity: "5kW",
      plan_type: "solar",
      total_cost: 300000,
      advance_amount: 0,
      order_date: "2026-01-13",
      coordinator_ids: [RAHUL],
      consumer_number: consumerV3(n),
      current_stage: "site_feasibility_survey",
      is_completed: false,
      incentives: [],
      payments: [],
      ...values,
    };
  }

  const byConsumer = (n: number) =>
    svc.from("work_orders").select("id").eq("consumer_number", consumerV3(n));

  async function workOrder(result: ImportResult | undefined) {
    expect(result?.work_order_id, result?.message ?? "no result").toBeTruthy();
    return must(
      await svc
        .from("work_orders")
        .select(
          "id, coordinator_id, plan_type, plant_capacity, plant_capacity_kw, total_cost, status, order_date",
        )
        .eq("id", result!.work_order_id!)
        .single(),
      "work order",
    );
  }

  async function projectOf(workOrderId: string) {
    return must(
      await svc
        .from("projects")
        .select(
          "id, coordinator_id, current_stage, is_completed, started_at, completed_at, feasibility_date, cancellation, cancelled_on, cancelled_by, cancellation_remarks",
        )
        .eq("work_order_id", workOrderId)
        .single(),
      "project",
    );
  }

  async function milestonesOf(projectId: string) {
    return must(
      await svc
        .from("project_milestones")
        .select("stage, sort_order, status, completed_at")
        .eq("project_id", projectId)
        .order("sort_order"),
      "milestones",
    );
  }

  async function teamOf(workOrderId: string) {
    return must(
      await svc
        .from("work_order_coordinators")
        .select("coordinator_id, sort_order, added_by")
        .eq("work_order_id", workOrderId)
        .order("sort_order"),
      "team",
    );
  }

  async function incentivesOf(workOrderId: string) {
    return must(
      await svc
        .from("coordinator_incentives")
        .select("coordinator_id, amount, paid_on")
        .eq("work_order_id", workOrderId),
      "incentives",
    );
  }

  afterAll(async () => {
    await svc
      .from("work_orders")
      .delete()
      .like("consumer_number", `IMP3-${tagV3}-%`);
  });

  describe("a batch of good rows", () => {
    let results: Map<number, ImportResult>;

    beforeAll(async () => {
      results = await runImport([
        // 1. Shared sale: Rahul first, Priya second, a different incentive each.
        rowV3(1, {
          coordinator_ids: [RAHUL, PRIYA],
          current_stage: "kseb_portal_registration",
          feasibility_date: "2026-01-20",
          incentives: [
            { coordinator_id: RAHUL, amount: 4000, paid_on: null },
            { coordinator_id: PRIYA, amount: 2500, paid_on: "2026-03-01" },
          ],
          payments: [{ amount: 50000, paid_on: "2026-02-01", method: "upi" }],
        }),
        // 2. The same two, the other way round: Priya is the first coordinator.
        rowV3(2, { coordinator_ids: [PRIYA, RAHUL] }),
        // 3. A custom plan, still to be handed over, with no stage given.
        rowV3(3, {
          plan_type: "custom",
          plant_capacity: "Inverter + panel",
          total_cost: 42000,
          coordinator_ids: [ARUN],
          current_stage: undefined,
        }),
        // 4. A custom plan already handed over.
        rowV3(4, {
          plan_type: "custom",
          plant_capacity: "1 panel",
          total_cost: 9000,
          current_stage: "plant_commissioning",
          is_completed: true,
          commissioned_on: "2026-03-01",
        }),
        // 5. A custom plan, not completed, at its one stage.
        rowV3(5, {
          plan_type: "custom",
          plant_capacity: "Inverter + panel",
          total_cost: 42000,
          current_stage: "plant_commissioning",
        }),
        // 6. Cancelled mid-pipeline, with its remarks.
        rowV3(6, {
          current_stage: "kseb_portal_registration",
          feasibility_date: "2026-01-14",
          cancellation: "cancelled",
          cancelled_on: "2026-02-01",
          cancellation_remarks: "Customer withdrew — loan not sanctioned",
        }),
        // 7. Refunded, the date unknown and no clock to stop.
        rowV3(7, {
          cancellation: "refunded",
          cancellation_remarks: "REFUNDED",
        }),
        // 8. An old cancellation with nothing recorded but its existence.
        rowV3(8, {
          plant_capacity: "Not recorded",
          total_cost: 0,
          cancellation: "cancelled",
        }),
        // 9. Commissioned, the sheet gives no date: it stays unknown.
        rowV3(9, {
          current_stage: "plant_commissioning",
          is_completed: true,
        }),
        // 10. Five people on one sale is the limit.
        rowV3(10, { coordinator_ids: [RAHUL, PRIYA, ARUN, SNEHA, USERS.superadmin.id] }),
      ]);
    });

    it("imports every one of them", () => {
      expect(
        [...results.values()]
          .map((r) => [r.row_no, r.status, r.message] as const)
          .sort((x, y) => x[0] - y[0]),
      ).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, "imported", null]),
      );
    });

    it("keeps the order of the coordinators, with the first on the work order and the project", async () => {
      const shared = await workOrder(results.get(1));
      expect(shared.coordinator_id).toBe(RAHUL);
      expect(await teamOf(shared.id)).toEqual([
        { coordinator_id: RAHUL, sort_order: 1, added_by: USERS.admin.id },
        { coordinator_id: PRIYA, sort_order: 2, added_by: USERS.admin.id },
      ]);
      expect((await projectOf(shared.id)).coordinator_id).toBe(RAHUL);

      const reversed = await workOrder(results.get(2));
      expect(reversed.coordinator_id).toBe(PRIYA);
      expect((await teamOf(reversed.id)).map((m) => m.coordinator_id)).toEqual([
        PRIYA,
        RAHUL,
      ]);
      expect((await projectOf(reversed.id)).coordinator_id).toBe(PRIYA);

      const five = await workOrder(results.get(10));
      expect(await teamOf(five.id)).toHaveLength(5);
    });

    it("gives each person their own incentive and nobody else's", async () => {
      const shared = await workOrder(results.get(1));
      const rows = await incentivesOf(shared.id);
      expect(rows.sort((a, b) => a.coordinator_id.localeCompare(b.coordinator_id))).toEqual(
        [
          { coordinator_id: RAHUL, amount: 4000, paid_on: null },
          { coordinator_id: PRIYA, amount: 2500, paid_on: "2026-03-01" },
        ].sort((a, b) => a.coordinator_id.localeCompare(b.coordinator_id)),
      );

      // What each of them can read through the list is their own alone.
      const total = async (user: SeedUser) =>
        must(
          await (await signedInAs(user))
            .from("projects_list")
            .select("incentive_total")
            .eq("work_order_id", shared.id)
            .single(),
          user.email,
        ).incentive_total;
      expect(await total(USERS.rahul)).toBe(4000);
      expect(await total(USERS.priya)).toBe(2500);

      // A row without incentives leaves every row empty but present.
      const plain = await workOrder(results.get(2));
      expect(await incentivesOf(plain.id)).toEqual(
        expect.arrayContaining([{ coordinator_id: PRIYA, amount: null, paid_on: null }]),
      );
    });

    it("carries the payments of a shared row, and the clock", async () => {
      const shared = await workOrder(results.get(1));
      const listed = must(
        await svc
          .from("projects_list")
          .select("payment_count, amount_received, feasibility_date")
          .eq("work_order_id", shared.id)
          .single(),
        "project list row",
      );
      expect(listed).toEqual({
        payment_count: 1,
        amount_received: 50000,
        feasibility_date: "2026-01-20",
      });
    });

    it("makes a custom plan one Handover step with no kW, at that step", async () => {
      for (const n of [3, 5]) {
        const wo = await workOrder(results.get(n));
        expect(wo).toMatchObject({
          plan_type: "custom",
          plant_capacity: "Inverter + panel",
          plant_capacity_kw: null,
        });
        const project = await projectOf(wo.id);
        expect(project).toMatchObject({
          current_stage: "plant_commissioning",
          is_completed: false,
          completed_at: null,
          feasibility_date: null,
        });
        // Not completed, so the one step is under way (in progress).
        expect(await milestonesOf(project.id)).toEqual([
          { stage: "plant_commissioning", sort_order: 9, status: "in_progress", completed_at: null },
        ]);
      }
    });

    it("hands a completed custom plan over on the date given (IST)", async () => {
      const wo = await workOrder(results.get(4));
      const project = await projectOf(wo.id);
      expect(project).toMatchObject({ is_completed: true });
      expect(istDateOf(project.completed_at!)).toBe("2026-03-01");
      const [only, ...rest] = await milestonesOf(project.id);
      expect(rest).toEqual([]);
      expect(only).toMatchObject({ stage: "plant_commissioning", status: "completed" });
      expect(istDateOf(only.completed_at!)).toBe("2026-03-01");
    });

    it("records a cancellation and its remarks, attributed to the importing admin", async () => {
      const cancelled = await projectOf((await workOrder(results.get(6))).id);
      expect(cancelled).toMatchObject({
        cancellation: "cancelled",
        cancelled_on: "2026-02-01",
        cancelled_by: USERS.admin.id,
        cancellation_remarks: "Customer withdrew — loan not sanctioned",
        is_completed: false,
        current_stage: "kseb_portal_registration",
      });
      // Its feasibility clock stopped when it was cancelled: day 18 → no renewal.
      const listed = must(
        await svc
          .from("projects_list")
          .select("feasibility_days_left, feasibility_extension_cost, payment_pending")
          .eq("id", cancelled.id)
          .single(),
        "list row",
      );
      expect(listed).toEqual({
        feasibility_days_left: null,
        feasibility_extension_cost: 0,
        payment_pending: false,
      });

      const refunded = await projectOf((await workOrder(results.get(7))).id);
      expect(refunded).toMatchObject({
        cancellation: "refunded",
        cancelled_on: null, // the sheet did not say, and there is no clock
        cancelled_by: USERS.admin.id,
        cancellation_remarks: "REFUNDED",
      });
    });

    it("stores an old cancellation with nothing recorded as 'Not recorded', ₹0 and no kW", async () => {
      const wo = await workOrder(results.get(8));
      expect(wo).toMatchObject({
        plan_type: "solar",
        plant_capacity: "Not recorded",
        plant_capacity_kw: null,
        total_cost: 0,
        status: "approved",
      });
      expect(await projectOf(wo.id)).toMatchObject({
        cancellation: "cancelled",
        cancelled_by: USERS.admin.id,
      });
    });

    it("never invents a commissioning date", async () => {
      const wo = await workOrder(results.get(9));
      const project = await projectOf(wo.id);
      expect(project).toMatchObject({
        is_completed: true,
        current_stage: "plant_commissioning",
        completed_at: null,
      });
      const milestones = await milestonesOf(project.id);
      expect(milestones).toHaveLength(9);
      for (const m of milestones) {
        expect(m).toMatchObject({ status: "completed", completed_at: null });
      }
    });

    it("brings an imported sale under the new rules (a partner sees it, a stranger does not)", async () => {
      const shared = await workOrder(results.get(1));
      const seen = async (user: SeedUser) =>
        must(
          await (await signedInAs(user))
            .from("work_orders")
            .select("id")
            .eq("id", shared.id),
          user.email,
        ).length;
      expect(await seen(USERS.priya)).toBe(1);
      expect(await seen(USERS.rahul)).toBe(1);
      expect(await seen(USERS.sneha)).toBe(0);
    });
  });

  describe("a bad row", () => {
    it("fails alone and leaves no work order, membership or incentive behind", async () => {
      const results = await runImport([
        rowV3(21), // fine
        // A coordinator id that is no account.
        rowV3(22, { coordinator_ids: [RAHUL, "11111111-1111-4111-8111-111111111111"] }),
        // The same person twice.
        rowV3(23, { coordinator_ids: [RAHUL, RAHUL] }),
        // A service engineer.
        rowV3(24, { coordinator_ids: [RAHUL, USERS.anil.id] }),
        // Six people.
        rowV3(25, {
          coordinator_ids: [
            RAHUL,
            PRIYA,
            ARUN,
            SNEHA,
            USERS.superadmin.id,
            USERS.admin.id,
          ],
        }),
        // A custom plan has no feasibility date.
        rowV3(26, {
          plan_type: "custom",
          plant_capacity: "1 panel",
          current_stage: "plant_commissioning",
          feasibility_date: "2026-02-01",
        }),
        // A stage the plan does not have.
        rowV3(27, {
          plan_type: "custom",
          plant_capacity: "1 panel",
          current_stage: "kseb_portal_registration",
        }),
        // An incentive for someone who is not on the sale.
        rowV3(28, {
          coordinator_ids: [RAHUL],
          incentives: [{ coordinator_id: ARUN, amount: 1000, paid_on: null }],
        }),
        // Not a UUID at all.
        rowV3(29, { coordinator_ids: ["not-a-uuid"] }),
        // Commissioned with a feasibility date but no commissioning date.
        rowV3(30, {
          is_completed: true,
          current_stage: "plant_commissioning",
          feasibility_date: "2026-02-01",
        }),
        // Cancelled with a running clock but no date to stop it.
        rowV3(31, {
          feasibility_date: "2026-02-01",
          cancellation: "cancelled",
        }),
        // A date or remarks without a cancellation.
        rowV3(32, { cancelled_on: "2026-02-01" }),
        rowV3(33, { cancellation_remarks: "stray note" }),
        // A payment that breaks after everything else was written.
        rowV3(34, {
          coordinator_ids: [RAHUL, PRIYA],
          incentives: [{ coordinator_id: RAHUL, amount: 1000, paid_on: null }],
          payments: [{ amount: 0, paid_on: "2026-02-02" }],
        }),
        // The previous build's incentive shape cannot be split on a shared sale.
        rowV3(35, {
          coordinator_ids: [RAHUL, PRIYA],
          incentives: undefined,
          coordinator_incentive: 1000,
        }),
      ]);

      const status = (n: number) => results.get(n)?.status;
      expect(status(21)).toBe("imported");
      for (let n = 22; n <= 35; n++) expect(status(n), `row ${n}`).toBe("failed");

      const message = (n: number) => results.get(n)?.message ?? "";
      expect(message(22)).toMatch(/not a coordinator or office account/i);
      expect(message(23)).toMatch(/listed twice/i);
      expect(message(24)).toMatch(/not a coordinator or office account: Anil Kumar/i);
      expect(message(25)).toMatch(/at most 5 coordinators/i);
      expect(message(26)).toMatch(/custom plan has no KSEB feasibility/i);
      expect(message(27)).toMatch(/does not apply to a custom plan/i);
      expect(message(28)).toMatch(/not a coordinator on this sale/i);
      expect(message(29)).toMatch(/uuid/i);
      expect(message(30)).toMatch(/commissioned_on is required/i);
      expect(message(31)).toMatch(/cancelled_on is required/i);
      expect(message(32)).toMatch(/need a cancellation/i);
      expect(message(33)).toMatch(/need a cancellation/i);
      expect(message(34)).toMatch(/payments_amount_positive/);
      expect(message(35)).toMatch(/per coordinator/i);

      // Nothing of any failed row is left: no work order, and so no team or
      // incentive rows either (they hang off it).
      for (let n = 22; n <= 35; n++) {
        expect(must(await byConsumer(n), `row ${n}`), `row ${n}`).toEqual([]);
      }
      const orphans = await withDb(async (db) =>
        (
          await db.query<{ n: number }>(
            `select count(*)::int as n from public.work_order_coordinators c
              where not exists (select 1 from public.work_orders w where w.id = c.work_order_id)`,
          )
        ).rows[0].n,
      );
      expect(orphans).toBe(0);

      // The good row beside them is intact.
      const good = await workOrder(results.get(21));
      expect(await teamOf(good.id)).toHaveLength(1);
    });
  });

  describe("the previous build's rows", () => {
    it("still land: coordinator_email (blank = the default), with its single incentive", async () => {
      const results = await runImport([
        {
          row_no: 41,
          client_name: clientV3(41),
          plant_capacity: "3kW",
          total_cost: 180000,
          consumer_number: consumerV3(41),
          coordinator_email: " ARUN@bsssolar.test ",
          coordinator_incentive: 1500,
          incentive_paid_on: "2026-03-10",
          order_date: "2026-01-05",
        },
        {
          row_no: 42,
          client_name: clientV3(42),
          plant_capacity: "3kW",
          total_cost: 180000,
          consumer_number: consumerV3(42),
          order_date: "2026-01-05",
        },
      ]);
      expect([...results.values()].map((r) => r.status).sort()).toEqual([
        "imported",
        "imported",
      ]);

      const byEmail = await workOrder(results.get(41));
      expect(byEmail.coordinator_id).toBe(ARUN);
      expect(await teamOf(byEmail.id)).toHaveLength(1);
      // Written where the old build's page reads it, and carried to the person's own row.
      expect(await incentivesOf(byEmail.id)).toEqual([
        { coordinator_id: ARUN, amount: 1500, paid_on: "2026-03-10" },
      ]);
      const project = must(
        await svc
          .from("projects")
          .select("coordinator_incentive, incentive_paid_on")
          .eq("work_order_id", byEmail.id)
          .single(),
        "project",
      );
      expect(project).toEqual({
        coordinator_incentive: 1500,
        incentive_paid_on: "2026-03-10",
      });

      const byDefault = await workOrder(results.get(42));
      expect(byDefault.coordinator_id).toBe(DEFAULT_COORDINATOR.id);
      expect(byDefault).toMatchObject({ plan_type: "solar", plant_capacity_kw: 3 });
    });

    it("skip a consumer number that already exists, whichever shape they come in", async () => {
      const results = await runImport([
        rowV3(51, { consumer_number: "1156789012345", coordinator_ids: [RAHUL, PRIYA] }),
      ]);
      expect(results.get(51)?.status).toBe("skipped");
      expect(results.get(51)?.message).toMatch(/1156789012345.*Anand Kumar/);

      // Off, it imports the duplicate.
      const forced = await runImport(
        [rowV3(52, { consumer_number: "1156789012345" })],
        { skipExisting: false },
      );
      expect(forced.get(52)?.status).toBe("imported");
    });
  });
});

describe("import_projects — options and guards", () => {
  it("imports a duplicate consumer number when skip-existing is off", async () => {
    const existing = consumer(10);
    await fx.workOrder({ client_name: client(10), consumer_number: existing });

    const results = await runImport([row(11, { consumer_number: existing })], {
      skipExisting: false,
    });
    expect(results.get(11)?.status).toBe("imported");
  });

  it("imports a consumer number repeated within one file only once", async () => {
    const shared = consumer(12);
    const results = await runImport([
      row(12, { consumer_number: shared }),
      row(13, { consumer_number: shared, client_name: client(13) }),
    ]);
    expect(results.get(12)?.status).toBe("imported");
    expect(results.get(13)?.status).toBe("skipped");
    expect(results.get(13)?.message).toContain(client(12));
    expect(await workOrdersFor(12)).toHaveLength(1);
  });

  it("runs concurrent imports one after the other, so a double submit imports a row once", async () => {
    const shared = consumer(30);
    const waiting = `select count(*)::int as n from pg_locks
                      where locktype = 'advisory' and not granted`;

    const outcomes = await withDb(async (db) => {
      // Hold the import lock, as a batch that is still running would.
      await db.query("begin");
      await db.query(
        "select pg_advisory_xact_lock(hashtext('import_projects'))",
      );
      const imports = Promise.all([
        runImport([row(30, { consumer_number: shared })]),
        runImport([
          row(31, { consumer_number: shared, client_name: client(31) }),
        ]),
      ]);
      try {
        // Both batches queue on the lock instead of racing past the
        // skip-existing check while the other is uncommitted.
        await expect
          .poll(
            async () => (await db.query<{ n: number }>(waiting)).rows[0].n,
            {
              timeout: 10_000,
            },
          )
          .toBe(2);
      } finally {
        await db.query("commit");
      }
      return (await imports).flatMap((results) => [...results.values()]);
    });

    expect(outcomes.map((r) => r.status).sort()).toEqual([
      "imported",
      "skipped",
    ]);
    expect(await workOrdersFor(30)).toHaveLength(1);
  });

  it.each([
    ["a coordinator", USERS.rahul],
    ["a service engineer", USERS.anil],
  ])("is refused to %s", async (_who, user) => {
    const caller = await signedInAs(user);
    const { error } = await caller.rpc("import_projects", {
      p_rows: [row(20)],
      p_default_coordinator: USERS.rahul.id,
    });
    expect(error?.code).toBe("42501");
    expect(await workOrdersFor(20)).toEqual([]);
  });

  it("is refused to a signed-out caller", async () => {
    const { error } = await anonClient().rpc("import_projects", {
      p_rows: [row(21)],
      p_default_coordinator: USERS.rahul.id,
    });
    expect(error?.code).toBe("42501");
    expect(await workOrdersFor(21)).toEqual([]);
  });

  it("rejects a service engineer as the default coordinator", async () => {
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.rpc("import_projects", {
      p_rows: [row(22)],
      p_default_coordinator: USERS.anil.id,
    });
    expect(error?.code).toBe("22023");
    expect(await workOrdersFor(22)).toEqual([]);
  });

  it("rejects a payload that is not an array of rows", async () => {
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.rpc("import_projects", {
      p_rows: { row_no: 1 },
      p_default_coordinator: USERS.rahul.id,
    });
    expect(error?.code).toBe("22023");
  });
});
