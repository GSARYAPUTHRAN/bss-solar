import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The work-order repository against a fake supabase client that records each
 * query: what the list filters become in PostgREST terms, how a work order's
 * embeds are read back, and what `setCoordinators` reports.
 */

type Call = [string, ...unknown[]];

let recorded: Call[];
let tableData: unknown;
let rpcResult: { data: unknown; error: { code?: string; message: string } | null };

/** A thenable builder: every method is recorded and chains; awaiting resolves. */
function builder(first: Call, result: () => unknown) {
  recorded.push(first);
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          recorded.push([String(prop), ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => ({
      select: (columns: string, options?: unknown) =>
        builder(["select", table, columns, options], () => ({
          data: tableData,
          count: 7,
          error: null,
        })),
      insert: (payload: unknown) =>
        builder(["insert", table, payload], () => ({ data: tableData, error: null })),
      update: (payload: unknown) =>
        builder(["update", table, payload], () => ({ data: tableData, error: null })),
    }),
    rpc: (fn: string, args: unknown) => builder(["rpc", fn, args], () => rpcResult),
  })),
}));

import { workOrdersRepository, mapWorkOrder } from "./work-orders.repository";

const RAHUL = "11111111-1111-4111-8111-111111111111";
const PRIYA = "22222222-2222-4222-8222-222222222222";
const ARUN = "33333333-3333-4333-8333-333333333333";

const PARAMS = {
  page: 1,
  pageSize: 10,
  q: "",
  sort: null,
  dir: "desc" as const,
  filters: {} as Record<string, string>,
};

/** The filter calls made on the rows query (everything after `select`). */
async function filtersFor(filters: Record<string, string>, q = ""): Promise<Call[]> {
  recorded = [];
  await workOrdersRepository.page({ ...PARAMS, q, filters });
  const rows = recorded.slice(1); // first call is the rows select
  const end = rows.findIndex(([name]) => name === "order");
  return rows.slice(0, end);
}

beforeEach(() => {
  recorded = [];
  tableData = [];
  rpcResult = { data: [], error: null };
});

describe("workOrdersRepository.page — filters", () => {
  it("reads the flattened list view, counted", async () => {
    await workOrdersRepository.page(PARAMS);
    expect(recorded[0]).toEqual(["select", "work_orders_list", "*", { count: "exact", head: false }]);
  });

  it.each(["pending", "rejected"])("%s is the work order's own status", async (status) => {
    expect(await filtersFor({ status })).toEqual([["eq", "status", status]]);
  });

  it("approved is the active pipeline: a cancelled or refunded project leaves it", async () => {
    expect(await filtersFor({ status: "approved" })).toEqual([
      ["eq", "status", "approved"],
      ["is", "cancellation", null],
    ]);
  });

  it.each(["cancelled", "refunded"])("%s is the project's state", async (status) => {
    expect(await filtersFor({ status })).toEqual([["eq", "cancellation", status]]);
  });

  it("ignores a status it does not know rather than handing Postgres a bad enum", async () => {
    expect(await filtersFor({ status: "closed" })).toEqual([]);
    expect(await filtersFor({ status: "pending; drop" })).toEqual([]);
  });

  it("the coordinator filter matches anyone on the sale", async () => {
    expect(await filtersFor({ coordinator: PRIYA })).toEqual([
      ["contains", "coordinator_ids", [PRIYA]],
    ]);
  });

  it("ignores a coordinator that is not an account id", async () => {
    expect(await filtersFor({ coordinator: "someone" })).toEqual([]);
  });

  it("filters by plan, and ignores an unknown one", async () => {
    expect(await filtersFor({ plan: "custom" })).toEqual([["eq", "plan_type", "custom"]]);
    expect(await filtersFor({ plan: "solar" })).toEqual([["eq", "plan_type", "solar"]]);
    expect(await filtersFor({ plan: "wind" })).toEqual([]);
  });

  it("outstanding balance leaves out cancelled and refunded projects", async () => {
    expect(await filtersFor({ payment: "pending" })).toEqual([
      ["gt", "balance_due", 0],
      ["is", "cancellation", null],
    ]);
  });

  it("paid in full is unchanged", async () => {
    expect(await filtersFor({ payment: "settled" })).toEqual([["lte", "balance_due", 0]]);
  });

  it("keeps the financing filter, and combines them all", async () => {
    expect(
      await filtersFor({
        financing: "loan",
        status: "approved",
        coordinator: ARUN,
        plan: "custom",
        payment: "pending",
      }),
    ).toEqual([
      ["eq", "status", "approved"],
      ["is", "cancellation", null],
      ["contains", "coordinator_ids", [ARUN]],
      ["eq", "financing_type", "loan"],
      ["eq", "plan_type", "custom"],
      ["gt", "balance_due", 0],
      ["is", "cancellation", null],
    ]);
  });

  it("searches every coordinator's name through the view's label", async () => {
    const calls = await filtersFor({}, "priya");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("or");
    expect(String(calls[0][1])).toContain("coordinator_name.ilike.%priya%");
  });
});

describe("workOrdersRepository.page — order", () => {
  async function ordersFor(sort: string | null, dir: "asc" | "desc") {
    recorded = [];
    await workOrdersRepository.page({ ...PARAMS, sort, dir });
    return recorded.filter(([name]) => name === "order");
  }

  it.each([
    ["the default", null, "desc", "order_date"],
    ["coordinator_name", "coordinator_name", "asc", "coordinator_name"],
    ["status", "status", "desc", "status"],
  ] as const)(
    "sorts by %s, then newest first, then the unique id so an import's tied rows page cleanly",
    async (_label, sort, dir, column) => {
      // An import creates every work order in one transaction: dates, coordinators
      // and statuses tie, and paging over ties skips and repeats rows.
      // Same sort value: the newest first, then the unique id.
      expect(await ordersFor(sort, dir)).toEqual([
        ["order", column, { ascending: dir === "asc" }],
        ["order", "created_at", { ascending: false }],
        ["order", "id", { ascending: true }],
      ]);
    },
  );

  it("pages after the ordering", async () => {
    await ordersFor(null, "desc");
    expect(recorded.at(-1)).toEqual(["range", 0, 9]);
  });
});

describe("workOrdersRepository.byId", () => {
  const RAW = {
    id: "wo-1",
    coordinator_id: RAHUL,
    client_name: "Meera Nair",
    plan_type: "custom",
    plant_capacity: "Inverter + panel",
    status: "approved",
    // Embedded in the wrong order, as nothing promises PostgREST's.
    coordinators: [
      {
        coordinator_id: ARUN,
        sort_order: 3,
        created_at: "2026-10-03T10:00:00Z",
        profile: { id: ARUN, full_name: "Arun Krishnan" },
      },
      {
        coordinator_id: RAHUL,
        sort_order: 1,
        created_at: "2026-10-01T10:00:00Z",
        profile: { id: RAHUL, full_name: "Rahul Menon" },
      },
      {
        coordinator_id: PRIYA,
        sort_order: 2,
        created_at: "2026-10-02T10:00:00Z",
        profile: [{ id: PRIYA, full_name: "Priya Suresh" }],
      },
    ],
    projects: [
      {
        id: "proj-1",
        current_stage: "plant_commissioning",
        is_completed: false,
        cancellation: "refunded",
        cancelled_on: "2026-10-12",
        cancellation_remarks: "Returned in full",
      },
    ],
  };

  it("embeds the team with FK hints, and the project with why it left the pipeline", async () => {
    tableData = RAW;
    await workOrdersRepository.byId("wo-1");
    const [, table, columns] = recorded[0];
    expect(table).toBe("work_orders");
    expect(columns).toContain("plan_type");
    expect(columns).toContain(
      "coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(",
    );
    expect(columns).toContain("profile:profiles!work_order_coordinators_coordinator_id_fkey(id, full_name)");
    expect(columns).toContain("projects(id, current_stage, is_completed, cancellation, cancelled_on, cancellation_remarks)");
    // The single-coordinator join is gone.
    expect(columns).not.toContain("coordinator:profiles");
  });

  it("reads how and when the advance was paid, with the advance", async () => {
    tableData = {
      ...RAW,
      advance_amount: 50000,
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      advance_reference: "UPI 4410021199",
    };
    const wo = await workOrdersRepository.byId("wo-1");
    const [, , columns] = recorded[0];
    for (const column of ["advance_amount", "advance_method", "advance_paid_on", "advance_reference"]) {
      expect(columns).toContain(column);
    }
    expect(wo).toMatchObject({
      advance_amount: 50000,
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      advance_reference: "UPI 4410021199",
    });
  });

  it("maps the coordinators in sale order, first first, whatever order they arrive in", () => {
    const wo = mapWorkOrder(RAW);
    expect(wo.coordinators).toEqual([
      { id: RAHUL, full_name: "Rahul Menon", sort_order: 1, incentive: null },
      { id: PRIYA, full_name: "Priya Suresh", sort_order: 2, incentive: null },
      { id: ARUN, full_name: "Arun Krishnan", sort_order: 3, incentive: null },
    ]);
    expect(wo.coordinator_id).toBe(RAHUL);
  });

  it("reads a one-to-one project embed as an object or as an array", () => {
    const asArray = mapWorkOrder(RAW);
    const asObject = mapWorkOrder({ ...RAW, projects: RAW.projects[0] });
    expect(asArray.project).toEqual(RAW.projects[0]);
    expect(asObject.project).toEqual(RAW.projects[0]);
    expect(mapWorkOrder({ ...RAW, projects: [] }).project).toBeNull();
    expect(mapWorkOrder({ ...RAW, projects: null }).project).toBeNull();
  });

  it("keeps the plan and the project's cancellation on the order", () => {
    const wo = mapWorkOrder(RAW);
    expect(wo.plan_type).toBe("custom");
    expect(wo.project).toMatchObject({
      cancellation: "refunded",
      cancelled_on: "2026-10-12",
      cancellation_remarks: "Returned in full",
    });
  });

  it("never drops a member whose profile is not readable", () => {
    const wo = mapWorkOrder({
      ...RAW,
      coordinators: [{ coordinator_id: RAHUL, sort_order: 1, created_at: "2026-10-01T10:00:00Z", profile: null }],
    });
    expect(wo.coordinators).toEqual([
      { id: RAHUL, full_name: "Unknown", sort_order: 1, incentive: null },
    ]);
  });

  it("breaks a tie on sort order by when they joined, then by id", () => {
    const at = (id: string, joined: string) => ({
      coordinator_id: id,
      sort_order: 2,
      created_at: joined,
      profile: { id, full_name: id },
    });
    const wo = mapWorkOrder({
      ...RAW,
      coordinators: [
        at("b", "2026-10-02T00:00:00Z"),
        at("a", "2026-10-02T00:00:00Z"),
        at("c", "2026-10-01T00:00:00Z"),
      ],
    });
    expect(wo.coordinators.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("is null when the order is not visible", async () => {
    tableData = null;
    expect(await workOrdersRepository.byId("nope")).toBeNull();
  });
});

describe("workOrdersRepository — writing the advance's details", () => {
  const INPUT = {
    coordinator_id: RAHUL,
    client_name: "Meera Nair",
    client_phone: null,
    address: null,
    plan_type: "solar" as const,
    plant_capacity: "5kW",
    advance_amount: 50000,
    advance_method: "upi" as const,
    advance_paid_on: "2025-02-04",
    advance_reference: "UPI 4410021199",
    total_cost: 300000,
    order_date: "2025-02-01",
    consumer_number: null,
    notes: null,
    kseb_section: null,
    financing_type: "self" as const,
    loan_bank_name: null,
  };

  it("inserts how, when and the reference of the advance with the order", async () => {
    tableData = { id: "wo-new" };
    const result = await workOrdersRepository.create(INPUT);
    expect(result).toEqual({ id: "wo-new", error: null });
    const insert = recorded.find(([name]) => name === "insert");
    expect(insert?.[2]).toMatchObject({
      advance_amount: 50000,
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      advance_reference: "UPI 4410021199",
    });
  });

  it("updates them with the rest, and can put them back to nothing", async () => {
    tableData = [{ id: "wo-1" }];
    const { coordinator_id: _first, ...patch } = INPUT;
    void _first;
    const cleared = { ...patch, advance_method: null, advance_paid_on: null, advance_reference: null };
    const result = await workOrdersRepository.update("wo-1", cleared);
    expect(result).toEqual({ error: null });
    const update = recorded.find(([name]) => name === "update");
    expect(update?.[2]).toMatchObject({
      advance_method: null,
      advance_paid_on: null,
      advance_reference: null,
    });
  });
});

describe("workOrdersRepository.advanceDetails", () => {
  it("reads just the three columns, for the one order", async () => {
    tableData = { advance_method: "cheque", advance_paid_on: "2025-02-04", advance_reference: "CHQ 1" };
    const details = await workOrdersRepository.advanceDetails("wo-1");
    expect(recorded).toContainEqual([
      "select",
      "work_orders",
      "advance_method, advance_paid_on, advance_reference",
      undefined,
    ]);
    expect(recorded).toContainEqual(["eq", "id", "wo-1"]);
    expect(details).toEqual(tableData);
  });

  it("is null when the order is not visible", async () => {
    tableData = null;
    expect(await workOrdersRepository.advanceDetails("nope")).toBeNull();
  });
});

describe("workOrdersRepository.setCoordinators", () => {
  it("calls the RPC with the list in order", async () => {
    await workOrdersRepository.setCoordinators("wo-1", [RAHUL, PRIYA]);
    expect(recorded[0]).toEqual([
      "rpc",
      "set_work_order_coordinators",
      { p_work_order_id: "wo-1", p_coordinator_ids: [RAHUL, PRIYA] },
    ]);
  });

  it("reports who was added (in the order asked) and who was removed", async () => {
    rpcResult = {
      data: [
        { coordinator_id: PRIYA, change: "removed" },
        { coordinator_id: ARUN, change: "added" },
        { coordinator_id: RAHUL, change: "added" },
      ],
      error: null,
    };
    expect(await workOrdersRepository.setCoordinators("wo-1", [RAHUL, ARUN])).toEqual({
      added: [RAHUL, ARUN],
      removed: [PRIYA],
      error: null,
    });
  });

  it("reports a refusal with the database's code", async () => {
    rpcResult = {
      data: null,
      error: {
        code: "42501",
        message: "Only the office can take a coordinator off a work order",
      },
    };
    expect(await workOrdersRepository.setCoordinators("wo-1", [RAHUL])).toEqual({
      added: [],
      removed: [],
      error: "Only the office can take a coordinator off a work order",
      code: "42501",
    });
  });

  it("an empty answer is no change", async () => {
    rpcResult = { data: null, error: null };
    expect(await workOrdersRepository.setCoordinators("wo-1", [RAHUL])).toEqual({
      added: [],
      removed: [],
      error: null,
    });
  });
});
