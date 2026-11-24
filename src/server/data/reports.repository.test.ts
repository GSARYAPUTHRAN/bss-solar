import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The report's reads against a fake supabase client that records every query
 * and answers page by page: >1000 rows are read in full, the order is unique
 * (`id`), only the needed columns are selected, the dated tables are narrowed to
 * the report's range, and rows map to the domain's shapes. A failed read throws.
 */

type Call = [string, ...unknown[]];
interface Query {
  table: string;
  calls: Call[];
}
type Answer = { data: unknown[] | null; error: { code?: string; message: string } | null };

let queries: Query[];
/** Rows per table; a page is the slice the query's `.range()` asks for. */
let tables: Record<string, unknown[]>;
/** Per-table error answers. */
let failures: Record<string, Answer["error"]>;

function answer(query: Query): Answer {
  const failure = failures[query.table];
  if (failure) return { data: null, error: failure };
  const range = query.calls.find(([name]) => name === "range");
  const rows = tables[query.table] ?? [];
  if (!range) return { data: rows, error: null };
  const [, from, to] = range as [string, number, number];
  if (from > 0 && from >= rows.length) {
    return { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } };
  }
  return { data: rows.slice(from, to + 1), error: null };
}

function builder(query: Query) {
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(answer(query)).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          query.calls.push([String(prop), ...args]);
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
      select: (columns: string) => {
        const query: Query = { table, calls: [["select", columns]] };
        queries.push(query);
        return builder(query);
      },
    }),
  })),
}));

import { REPORT_PAGE_SIZE, reportsRepository } from "./reports.repository";

const RANGE = { from: "2025-04-01", to: "2026-11-24" };

function saleRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `wo-${String(i).padStart(5, "0")}`,
    client_name: `Client ${i}`,
    order_date: "2026-11-05",
    status: "approved",
    total_cost: "250000.50",
    plant_capacity: "5kW",
    plant_capacity_kw: "5.00",
    plan_type: "solar",
    advance_amount: "25000",
    amount_received: "75000",
    balance_due: "175000.50",
    coordinator_ids: ["c-1", "c-2"],
    coordinator_names: ["Rahul Menon", "Priya Suresh"],
    project_id: "p-1",
    is_completed: false,
    cancellation: null,
    financing_type: "loan",
    loan_bank_name: "SBI",
    ...overrides,
  };
}

const queriesOf = (table: string) => queries.filter((q) => q.table === table);
const callsNamed = (q: Query, name: string) => q.calls.filter(([n]) => n === name);

beforeEach(() => {
  queries = [];
  failures = {};
  tables = {
    work_orders_list: [saleRow(1)],
    work_orders: [
      { id: "wo-00001", advance_paid_on: "2026-11-02", advance_method: "upi", advance_reference: "UPI 1" },
    ],
    payments: [
      {
        id: "pay-1",
        work_order_id: "wo-00001",
        paid_on: "2026-11-10",
        amount: "50000.00",
        purpose: "kseb_fees",
        paid_by_office: true,
        method: "cash",
        reference: null,
      },
    ],
    projects: [
      {
        id: "p-1",
        work_order_id: "wo-00001",
        is_completed: true,
        completed_at: "2026-11-10T06:00:00+00:00",
        cancellation: null,
        cancelled_on: null,
      },
    ],
    service_tickets: [
      { id: "t-1", status: "completed", service_date: null, updated_at: "2026-11-12T06:00:00+00:00" },
    ],
    coordinator_incentive_payments: [{ id: "ip-1", amount: "2000.50", paid_on: "2026-11-15" }],
  };
});

describe("reportsRepository.load — mapping", () => {
  it("maps a sale from the list view and its advance details from the table", async () => {
    const data = await reportsRepository.load(RANGE);
    expect(data.sales).toEqual([
      {
        id: "wo-00001",
        clientName: "Client 1",
        orderDate: "2026-11-05",
        status: "approved",
        totalCost: 250000.5,
        capacityKw: 5,
        plan: "5kW",
        planType: "solar",
        advanceAmount: 25000,
        advancePaidOn: "2026-11-02",
        advanceMethod: "upi",
        advanceReference: "UPI 1",
        receivedToDate: 75000,
        balanceDue: 175000.5,
        coordinatorIds: ["c-1", "c-2"],
        coordinatorNames: ["Rahul Menon", "Priya Suresh"],
        projectState: "active",
        financing: "loan",
        loanBank: "SBI",
      },
    ]);
  });

  it.each([
    [{ project_id: null }, "none"],
    [{ is_completed: true }, "commissioned"],
    [{ is_completed: true, cancellation: "refunded" }, "refunded"],
    [{ cancellation: "cancelled" }, "cancelled"],
  ])("reads the project state %j as %s", async (overrides, state) => {
    tables.work_orders_list = [saleRow(1, overrides)];
    expect((await reportsRepository.load(RANGE)).sales[0].projectState).toBe(state);
  });

  it("reads nulls as 0 / unknown, and a custom plan's missing kW as null", async () => {
    tables.work_orders_list = [
      saleRow(1, {
        plant_capacity_kw: null,
        plan_type: "custom",
        advance_amount: null,
        amount_received: null,
        balance_due: null,
        coordinator_ids: null,
        coordinator_names: null,
        loan_bank_name: null,
      }),
    ];
    tables.work_orders = [];
    const [sale] = (await reportsRepository.load(RANGE)).sales;
    expect(sale).toMatchObject({
      capacityKw: null,
      planType: "custom",
      advanceAmount: 0,
      advancePaidOn: null,
      advanceMethod: null,
      receivedToDate: 0,
      balanceDue: 0,
      coordinatorIds: [],
      coordinatorNames: [],
      loanBank: null,
    });
  });

  it("maps payments, projects, visits and incentive instalments", async () => {
    const data = await reportsRepository.load(RANGE);
    expect(data.payments).toEqual([
      {
        workOrderId: "wo-00001",
        paidOn: "2026-11-10",
        amount: 50000,
        purpose: "kseb_fees",
        paidByOffice: true,
        method: "cash",
        reference: null,
      },
    ]);
    expect(data.projects).toEqual([
      {
        workOrderId: "wo-00001",
        isCompleted: true,
        completedAt: "2026-11-10T06:00:00+00:00",
        cancellation: null,
        cancelledOn: null,
      },
    ]);
    expect(data.tickets).toEqual([
      { status: "completed", serviceDate: null, updatedAt: "2026-11-12T06:00:00+00:00" },
    ]);
    expect(data.incentivePayments).toEqual([{ amount: 2000.5, paidOn: "2026-11-15" }]);
  });
});

describe("reportsRepository.load — queries", () => {
  it("selects only the columns the report needs", async () => {
    await reportsRepository.load(RANGE);
    const columns = (table: string) => String(queriesOf(table)[0].calls[0][1]);
    expect(columns("work_orders_list")).not.toContain("*");
    expect(columns("work_orders_list")).toContain("coordinator_names");
    expect(columns("work_orders_list")).not.toMatch(/\baddress\b|client_phone|notes/);
    expect(columns("work_orders")).toBe("id, advance_paid_on, advance_method, advance_reference");
    expect(columns("projects")).toBe(
      "id, work_order_id, is_completed, completed_at, cancellation, cancelled_on",
    );
    expect(columns("service_tickets")).toBe("id, status, service_date, updated_at");
    expect(columns("coordinator_incentive_payments")).toBe("id, amount, paid_on");
  });

  it("orders every read by a unique column and pages with .range()", async () => {
    await reportsRepository.load(RANGE);
    for (const q of queries) {
      expect(callsNamed(q, "order"), q.table).toEqual([["order", "id", { ascending: true }]]);
      expect(callsNamed(q, "range"), q.table).toEqual([["range", 0, REPORT_PAGE_SIZE - 1]]);
    }
  });

  it("narrows the ledger and incentive instalments to the report's range", async () => {
    await reportsRepository.load(RANGE);
    for (const table of ["payments", "coordinator_incentive_payments"]) {
      const [q] = queriesOf(table);
      expect(q.calls).toContainEqual(["gte", "paid_on", RANGE.from]);
      expect(q.calls).toContainEqual(["lte", "paid_on", RANGE.to]);
    }
  });

  it("reads completed visits only, from (a day before) the start of the range", async () => {
    await reportsRepository.load(RANGE);
    const [q] = queriesOf("service_tickets");
    expect(q.calls).toContainEqual(["eq", "status", "completed"]);
    expect(q.calls).toContainEqual([
      "or",
      "service_date.gte.2025-04-01,and(service_date.is.null,updated_at.gte.2025-03-31)",
    ]);
  });

  it("reads every sale and every project whatever their date", async () => {
    await reportsRepository.load(RANGE);
    for (const table of ["work_orders_list", "work_orders", "projects"]) {
      const [q] = queriesOf(table);
      expect(callsNamed(q, "gte"), table).toEqual([]);
      expect(callsNamed(q, "lte"), table).toEqual([]);
    }
  });
});

describe("reportsRepository.load — paging", () => {
  it("reads past the 1000-row cap, page by page", async () => {
    tables.work_orders_list = Array.from({ length: 2345 }, (_, i) => saleRow(i));
    tables.payments = Array.from({ length: 1001 }, (_, i) => ({
      id: `pay-${i}`,
      work_order_id: "wo-00001",
      paid_on: "2026-11-10",
      amount: 1,
      purpose: "contract",
      paid_by_office: false,
      method: "upi",
      reference: null,
    }));
    const data = await reportsRepository.load(RANGE);
    expect(data.sales).toHaveLength(2345);
    expect(data.payments).toHaveLength(1001);
    expect(new Set(data.sales.map((s) => s.id)).size).toBe(2345);
    expect(queriesOf("work_orders_list").map((q) => callsNamed(q, "range")[0])).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
      ["range", 2000, 2999],
    ]);
    expect(queriesOf("payments")).toHaveLength(2);
  });

  it("stops cleanly when the last page was exactly full", async () => {
    tables.projects = Array.from({ length: REPORT_PAGE_SIZE }, (_, i) => ({
      id: `p-${i}`,
      work_order_id: "wo-00001",
      is_completed: false,
      completed_at: null,
      cancellation: null,
      cancelled_on: null,
    }));
    const data = await reportsRepository.load(RANGE);
    expect(data.projects).toHaveLength(REPORT_PAGE_SIZE);
    // The second page answered "range not satisfiable": the end, not an error.
    expect(queriesOf("projects")).toHaveLength(2);
  });

  it("drops a sale read twice when rows shifted between pages", async () => {
    tables.work_orders_list = [saleRow(1), saleRow(1), saleRow(2)];
    const data = await reportsRepository.load(RANGE);
    expect(data.sales.map((s) => s.id)).toEqual(["wo-00001", "wo-00002"]);
  });
});

describe("reportsRepository.load — failures", () => {
  it.each([
    ["work_orders_list", "sales"],
    ["payments", "payments"],
    ["service_tickets", "service visits"],
    ["coordinator_incentive_payments", "incentive payments"],
  ])("throws when %s cannot be read, rather than reporting zeros", async (table, what) => {
    failures[table] = { code: "57014", message: "statement timeout" };
    await expect(reportsRepository.load(RANGE)).rejects.toThrow(
      `Could not read ${what} for the report: statement timeout`,
    );
  });
});
