import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serviceClient, signedInAs, USERS } from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import type { Json } from "@/lib/supabase/database.types";

/**
 * import_projects() v4 (migration 20261104120200): the advance's method, date
 * and reference; refund and write-off payments and KSEB fees paid by the office;
 * and incentives as an agreed amount plus dated instalments. The v3 shapes
 * (`incentives: [{coordinator_id, amount, paid_on}]`, the legacy single
 * incentive) still work — import-rpc.test.ts keeps pinning those. A row lands
 * completely or not at all, whatever it carries.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const tag = uniqueTag();
const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

const consumer = (n: number) => `IMP4-${tag}-${n}`;
const clientName = (n: number) => `Import v4 ${tag} #${n}`;

type ImportRow = {
  row_no: number;
  client_name: string;
  plant_capacity: string;
  total_cost: number;
  [field: string]: Json | undefined;
};

type ImportResult = {
  row_no: number;
  status: string;
  message: string | null;
  work_order_id: string | null;
};

/** A row in v4's shape: resolved coordinators, nothing optional filled in. */
function row(n: number, values: Partial<ImportRow> = {}): ImportRow {
  return {
    row_no: n,
    client_name: clientName(n),
    plant_capacity: "5kW",
    plan_type: "solar",
    total_cost: 300000,
    advance_amount: 0,
    order_date: "2026-01-13",
    coordinator_ids: [RAHUL],
    consumer_number: consumer(n),
    current_stage: "site_feasibility_survey",
    is_completed: false,
    incentives: [],
    payments: [],
    ...values,
  };
}

async function runImport(
  rows: ImportRow[],
): Promise<Map<number, ImportResult>> {
  const admin = await signedInAs(USERS.admin);
  const results = must(
    await admin.rpc("import_projects", {
      p_rows: rows,
      p_default_coordinator: USERS.priya.id,
      p_skip_existing: true,
    }),
    "import_projects",
  ) as ImportResult[];
  for (const r of results)
    if (r.work_order_id) fx.trackWorkOrder(r.work_order_id);
  return new Map(results.map((r) => [r.row_no, r]));
}

const workOrderIdOf = (result: ImportResult | undefined): string => {
  expect(result?.work_order_id, result?.message ?? "no result").toBeTruthy();
  return result!.work_order_id!;
};

async function instalmentsOf(workOrderId: string) {
  return must(
    await svc
      .from("coordinator_incentive_payments")
      .select("coordinator_id, amount, paid_on, note, recorded_by")
      .eq("work_order_id", workOrderId)
      .order("coordinator_id")
      .order("paid_on")
      .order("amount"),
    "instalments",
  );
}

async function incentivesOf(workOrderId: string) {
  return must(
    await svc
      .from("coordinator_incentives")
      .select("coordinator_id, amount, paid_on")
      .eq("work_order_id", workOrderId)
      .order("coordinator_id"),
    "incentives",
  );
}

async function leftBehind(n: number) {
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
  await svc
    .from("work_orders")
    .delete()
    .like("consumer_number", `IMP4-${tag}-%`);
});

describe("import_projects v4 — incentives as an agreed amount and instalments", () => {
  let results: Map<number, ImportResult>;

  beforeAll(async () => {
    results = await runImport([
      // 1. The sheet's shape: a shared sale, a different incentive each, one
      //    paid in three dated instalments, the other only part paid.
      row(1, {
        coordinator_ids: [RAHUL, PRIYA],
        is_completed: true,
        commissioned_on: "2025-05-10",
        incentives: [
          {
            coordinator_id: RAHUL,
            amount: 24720,
            payments: [
              { amount: 20000, paid_on: "2025-05-15" },
              { amount: 2360, paid_on: "2025-05-16", note: "KSEB fee refund" },
              { amount: 2360, paid_on: "2025-05-21" },
            ],
          },
          {
            coordinator_id: PRIYA,
            amount: 5000,
            payments: [{ amount: 2000, paid_on: "2025-05-18" }],
          },
        ],
      }),
      // 2. Agreed but not paid at all: a still-unpaid incentive.
      row(2, {
        incentives: [{ coordinator_id: RAHUL, amount: 3000, payments: [] }],
      }),
      // 3. The v3 shape, one paid and one not.
      row(3, {
        coordinator_ids: [RAHUL, PRIYA],
        incentives: [
          { coordinator_id: RAHUL, amount: 4000, paid_on: "2026-03-01" },
          { coordinator_id: PRIYA, amount: 2500, paid_on: null },
        ],
      }),
      // 4. A zero incentive with a date has nothing to pay; no error.
      row(4, {
        incentives: [
          { coordinator_id: RAHUL, amount: 0, paid_on: "2026-03-01" },
        ],
      }),
    ]);
  });

  it("imports every row", () => {
    expect(
      [...results.values()].map((r) => [r.row_no, r.status, r.message]),
    ).toEqual([
      [1, "imported", null],
      [2, "imported", null],
      [3, "imported", null],
      [4, "imported", null],
    ]);
  });

  it("records each coordinator's agreed amount and their dated instalments, attributed to the importer", async () => {
    const id = workOrderIdOf(results.get(1));
    expect(await instalmentsOf(id)).toEqual([
      {
        coordinator_id: RAHUL,
        amount: 20000,
        paid_on: "2025-05-15",
        note: null,
        recorded_by: USERS.admin.id,
      },
      {
        coordinator_id: RAHUL,
        amount: 2360,
        paid_on: "2025-05-16",
        note: "KSEB fee refund",
        recorded_by: USERS.admin.id,
      },
      {
        coordinator_id: RAHUL,
        amount: 2360,
        paid_on: "2025-05-21",
        note: null,
        recorded_by: USERS.admin.id,
      },
      {
        coordinator_id: PRIYA,
        amount: 2000,
        paid_on: "2025-05-18",
        note: null,
        recorded_by: USERS.admin.id,
      },
    ]);
  });

  it("settles an incentive the instalments cover and leaves a part-paid one open", async () => {
    const id = workOrderIdOf(results.get(1));
    expect(await incentivesOf(id)).toEqual([
      { coordinator_id: RAHUL, amount: 24720, paid_on: "2025-05-21" },
      { coordinator_id: PRIYA, amount: 5000, paid_on: null },
    ]);
    const list = must(
      await svc
        .from("projects_list")
        .select(
          "incentive_total, incentive_paid, incentive_unpaid, incentive_unpaid_count",
        )
        .eq("work_order_id", id)
        .single(),
      "list row",
    );
    expect(list).toEqual({
      incentive_total: 29720,
      incentive_paid: 26720,
      incentive_unpaid: 3000,
      incentive_unpaid_count: 1,
    });
  });

  it("an agreed amount without payments is a still-unpaid incentive", async () => {
    const id = workOrderIdOf(results.get(2));
    expect(await incentivesOf(id)).toEqual([
      { coordinator_id: RAHUL, amount: 3000, paid_on: null },
    ]);
    expect(await instalmentsOf(id)).toEqual([]);
  });

  it("still accepts the v3 element: a paid_on is one instalment for the whole amount", async () => {
    const id = workOrderIdOf(results.get(3));
    expect(await instalmentsOf(id)).toEqual([
      {
        coordinator_id: RAHUL,
        amount: 4000,
        paid_on: "2026-03-01",
        note: null,
        recorded_by: USERS.admin.id,
      },
    ]);
    const rows = await incentivesOf(id);
    expect(rows.find((r) => r.coordinator_id === RAHUL)).toMatchObject({
      amount: 4000,
      paid_on: "2026-03-01",
    });
    expect(rows.find((r) => r.coordinator_id === PRIYA)).toMatchObject({
      amount: 2500,
      paid_on: null,
    });
  });

  it("a zero incentive is recorded as zero, with nothing paid", async () => {
    const id = workOrderIdOf(results.get(4));
    expect(await incentivesOf(id)).toEqual([
      { coordinator_id: RAHUL, amount: 0, paid_on: null },
    ]);
    expect(await instalmentsOf(id)).toEqual([]);
  });
});

describe("import_projects v4 — a row that breaks an incentive rule leaves nothing behind", () => {
  /** Row numbers are per file, so each case gets its own consumer number. */
  let nextRowNo = 100;

  it.each([
    [
      "instalments past the agreed amount",
      {
        incentives: [
          {
            coordinator_id: RAHUL,
            amount: 3000,
            payments: [
              { amount: 2000, paid_on: "2026-02-01" },
              { amount: 1500, paid_on: "2026-02-02" },
            ],
          },
        ],
      },
      /Instalments exceed the incentive/,
    ],
    [
      "an instalment without an agreed amount",
      {
        incentives: [
          {
            coordinator_id: RAHUL,
            payments: [{ amount: 500, paid_on: "2026-02-01" }],
          },
        ],
      },
      /Set the incentive amount first/,
    ],
    [
      "a paid date without an amount (v3 shape)",
      { incentives: [{ coordinator_id: RAHUL, paid_on: "2026-02-01" }] },
      /cannot be paid without an amount/,
    ],
    [
      "an instalment without its date",
      {
        incentives: [
          { coordinator_id: RAHUL, amount: 3000, payments: [{ amount: 500 }] },
        ],
      },
      /paid_on/,
    ],
    [
      "payments and paid_on together",
      {
        incentives: [
          {
            coordinator_id: RAHUL,
            amount: 3000,
            paid_on: "2026-02-01",
            payments: [{ amount: 500, paid_on: "2026-02-01" }],
          },
        ],
      },
      /payments or paid_on, not both/,
    ],
    [
      "the same coordinator listed twice",
      {
        incentives: [
          { coordinator_id: RAHUL, amount: 3000 },
          { coordinator_id: RAHUL, amount: 100 },
        ],
      },
      /listed twice for one coordinator/,
    ],
    [
      "an incentive for someone who is not on the sale",
      { incentives: [{ coordinator_id: PRIYA, amount: 3000 }] },
      /not a coordinator on this sale/,
    ],
    [
      "a zero-amount instalment",
      {
        incentives: [
          {
            coordinator_id: RAHUL,
            amount: 3000,
            payments: [{ amount: 0, paid_on: "2026-02-01" }],
          },
        ],
      },
      /coordinator_incentive_payments_amount_positive/,
    ],
  ])("%s", async (_what, values, message) => {
    const n = nextRowNo++;
    const bad = row(n, values as Partial<ImportRow>);
    const good = row(n + 1000);
    const results = await runImport([bad, good]);
    expect(results.get(n)).toMatchObject({
      status: "failed",
      work_order_id: null,
    });
    expect(results.get(n)?.message).toMatch(message);
    // The bad row took down only itself: not even its work order is left.
    expect(await leftBehind(n)).toEqual([]);
    expect(results.get(n + 1000)?.status).toBe("imported");
  });
});

describe("import_projects v4 — advance details", () => {
  it("stores the advance's method, date and reference, and blank means none", async () => {
    const results = await runImport([
      row(10, {
        advance_amount: 50000,
        advance_method: "upi",
        advance_paid_on: "2026-01-12",
        advance_reference: "  UPI 4410021199 ",
      }),
      row(11, {
        advance_amount: 20000,
        advance_method: "",
        advance_paid_on: "",
        advance_reference: " ",
      }),
      row(12, { advance_amount: 20000 }),
    ]);
    const advance = async (n: number) =>
      must(
        await svc
          .from("work_orders")
          .select(
            "advance_amount, advance_method, advance_paid_on, advance_reference",
          )
          .eq("id", workOrderIdOf(results.get(n)))
          .single(),
        "advance",
      );
    expect(await advance(10)).toEqual({
      advance_amount: 50000,
      advance_method: "upi",
      advance_paid_on: "2026-01-12",
      advance_reference: "UPI 4410021199",
    });
    const none = {
      advance_amount: 20000,
      advance_method: null,
      advance_paid_on: null,
      advance_reference: null,
    };
    expect(await advance(11)).toEqual(none);
    expect(await advance(12)).toEqual(none);
  });

  it("fails only the row whose advance method is not a payment method", async () => {
    const results = await runImport([
      row(13, { advance_amount: 1000, advance_method: "barter" }),
      row(14),
    ]);
    expect(results.get(13)?.status).toBe("failed");
    expect(await leftBehind(13)).toEqual([]);
    expect(results.get(14)?.status).toBe("imported");
  });
});

describe("import_projects v4 — refunds, write-offs and KSEB fees paid by the office", () => {
  let results: Map<number, ImportResult>;

  beforeAll(async () => {
    results = await runImport([
      // 1. 1,00,000 sale: advance 20,000, contract 70,000, a refund and a write-off.
      row(20, {
        total_cost: 100000,
        advance_amount: 20000,
        is_completed: true,
        commissioned_on: "2026-03-01",
        payments: [
          { amount: 70000, paid_on: "2026-02-01", method: "bank_transfer" },
          {
            amount: 5000,
            paid_on: "2026-02-20",
            method: "upi",
            purpose: "refund",
            reference: "UPI 5521",
            notes: "Returned the excess",
          },
          // The reason may come in the reference cell: it becomes the notes.
          {
            amount: 800,
            paid_on: "2026-02-25",
            purpose: "write_off",
            reference: "Customer short at handover",
          },
          {
            amount: 100,
            paid_on: "2026-02-26",
            purpose: "write_off",
            reference: "Ref",
            notes: "Rounding",
          },
          {
            amount: 2000,
            paid_on: "2026-01-20",
            method: "upi",
            purpose: "kseb_fees",
          },
          {
            amount: 1500,
            paid_on: "2026-01-21",
            method: "cash",
            purpose: "kseb_fees",
            paid_by_office: true,
          },
          {
            amount: 900,
            paid_on: "2026-01-22",
            method: "cash",
            purpose: "kseb_fees",
            paid_by_office: "yes",
          },
        ],
      }),
      // 2. A write-off with no reason anywhere: refused whole.
      row(21, {
        payments: [
          { amount: 800, paid_on: "2026-02-25", purpose: "write_off" },
        ],
      }),
      // 3. paid_by_office on a contract payment: refused whole.
      row(22, {
        payments: [
          { amount: 800, paid_on: "2026-02-25", paid_by_office: true },
        ],
      }),
      // 4. Not a purpose.
      row(23, {
        payments: [{ amount: 800, paid_on: "2026-02-25", purpose: "gift" }],
      }),
    ]);
  });

  it("imports the good row and refuses the bad ones whole", async () => {
    expect(results.get(20)?.status).toBe("imported");
    expect(results.get(21)).toMatchObject({
      status: "failed",
      work_order_id: null,
    });
    expect(results.get(21)?.message).toMatch(/payments_write_off_needs_reason/);
    expect(results.get(22)?.message).toMatch(
      /payments_paid_by_office_only_kseb/,
    );
    expect(results.get(23)?.status).toBe("failed");
    for (const n of [21, 22, 23])
      expect(await leftBehind(n), `row ${n}`).toEqual([]);
  });

  it("records each entry with its purpose, reason and who paid, attributed to the importer", async () => {
    const entries = must(
      await svc
        .from("payments")
        .select(
          "amount, purpose, method, reference, notes, paid_by_office, recorded_by",
        )
        .eq("work_order_id", workOrderIdOf(results.get(20)))
        .order("paid_on"),
      "ledger",
    );
    const by = USERS.admin.id;
    expect(entries).toEqual([
      {
        amount: 2000,
        purpose: "kseb_fees",
        method: "upi",
        reference: null,
        notes: null,
        paid_by_office: false,
        recorded_by: by,
      },
      {
        amount: 1500,
        purpose: "kseb_fees",
        method: "cash",
        reference: null,
        notes: null,
        paid_by_office: true,
        recorded_by: by,
      },
      {
        amount: 900,
        purpose: "kseb_fees",
        method: "cash",
        reference: null,
        notes: null,
        paid_by_office: true,
        recorded_by: by,
      },
      {
        amount: 70000,
        purpose: "contract",
        method: "bank_transfer",
        reference: null,
        notes: null,
        paid_by_office: false,
        recorded_by: by,
      },
      {
        amount: 5000,
        purpose: "refund",
        method: "upi",
        reference: "UPI 5521",
        notes: "Returned the excess",
        paid_by_office: false,
        recorded_by: by,
      },
      {
        amount: 800,
        purpose: "write_off",
        method: "other",
        reference: "Customer short at handover",
        notes: "Customer short at handover",
        paid_by_office: false,
        recorded_by: by,
      },
      {
        amount: 100,
        purpose: "write_off",
        method: "other",
        reference: "Ref",
        notes: "Rounding",
        paid_by_office: false,
        recorded_by: by,
      },
    ]);
  });

  it("the list views read the net: refund out, write-offs closing the balance, fees apart", async () => {
    const row = must(
      await svc
        .from("projects_list")
        .select(
          "payments_total, payment_count, refunded_total, written_off_total, kseb_fees_collected, kseb_fees_by_office, amount_received, balance_due, payment_pending",
        )
        .eq("work_order_id", workOrderIdOf(results.get(20)))
        .single(),
      "project row",
    );
    expect(row).toEqual({
      payments_total: 70000,
      payment_count: 1,
      refunded_total: 5000,
      written_off_total: 900,
      kseb_fees_collected: 2000,
      kseb_fees_by_office: 2400,
      // 20,000 + 70,000 − 5,000
      amount_received: 85000,
      // 1,00,000 − 85,000 − 900 written off
      balance_due: 14100,
      payment_pending: true,
    });
  });
});
