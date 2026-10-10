import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  anonClient,
  serviceClient,
  signedInAs,
  USERS,
  withDb,
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
