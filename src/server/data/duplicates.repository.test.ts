import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The duplicate check's reads against a fake supabase client that records every
 * query and answers page by page: every sale is read (no status filter), past
 * the 1000-row cap, on a unique order; tickets are counted per project and ledger
 * entries (every purpose) per sale; rows map to `CleanupSale`; a failed read throws.
 */

type Call = [string, ...unknown[]];
interface Query {
  table: string;
  calls: Call[];
}
type Answer = { data: unknown[] | null; error: { code?: string; message: string } | null };

let queries: Query[];
let tables: Record<string, unknown[]>;
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

import { ROWS_PER_PAGE } from "./read-all";
import { duplicatesRepository } from "./duplicates.repository";
import { duplicatesRepository as fromIndex } from "@/server/data";

function saleRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `wo-${String(i).padStart(5, "0")}`,
    client_name: `Client ${i}`,
    order_date: "2025-02-12",
    created_at: "2025-02-12T06:00:00+00:00",
    consumer_number: "1156-304",
    status: "approved",
    cancellation: null,
    coordinator_names: ["Rahul Menon", "Priya Suresh"],
    total_cost: "235000.00",
    amount_received: "50000.50",
    project_id: "p-1",
    current_stage: "material_dispatch",
    is_completed: false,
    plan_type: "solar",
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
    service_tickets: [{ project_id: "p-1" }, { project_id: "p-1" }, { project_id: "p-2" }],
    payments: [
      { work_order_id: "wo-00001" },
      { work_order_id: "wo-00001" },
      { work_order_id: "wo-00001" },
      { work_order_id: "wo-00009" },
    ],
  };
});

describe("duplicatesRepository.sales — mapping", () => {
  it("maps a sale from the list view, with its ledger entries and its project's tickets counted", async () => {
    expect(await duplicatesRepository.sales()).toEqual([
      {
        id: "wo-00001",
        clientName: "Client 1",
        orderDate: "2025-02-12",
        createdAt: "2025-02-12T06:00:00+00:00",
        consumerNumber: "1156-304",
        status: "approved",
        cancellation: null,
        coordinatorNames: ["Rahul Menon", "Priya Suresh"],
        totalCost: 235000,
        amountReceived: 50000.5,
        paymentCount: 3,
        projectId: "p-1",
        currentStage: "material_dispatch",
        isCompleted: false,
        ticketCount: 2,
        planType: "solar",
      },
    ]);
  });

  it("reads nulls as empty, zero or the defaults", async () => {
    tables.payments = [];
    tables.work_orders_list = [
      saleRow(1, {
        client_name: null,
        order_date: null,
        created_at: null,
        consumer_number: null,
        status: null,
        coordinator_names: null,
        total_cost: null,
        amount_received: null,
        project_id: null,
        current_stage: null,
        is_completed: null,
        plan_type: null,
      }),
    ];
    expect((await duplicatesRepository.sales())[0]).toMatchObject({
      clientName: "",
      orderDate: "",
      createdAt: "",
      consumerNumber: null,
      status: "pending",
      coordinatorNames: [],
      totalCost: 0,
      amountReceived: 0,
      paymentCount: 0,
      projectId: null,
      currentStage: null,
      isCompleted: false,
      ticketCount: 0,
      planType: "solar",
    });
  });

  it("counts no tickets for a sale without a project or whose project has none", async () => {
    tables.work_orders_list = [saleRow(1, { project_id: null }), saleRow(2, { project_id: "p-9" })];
    const sales = await duplicatesRepository.sales();
    expect(sales.map((s) => s.ticketCount)).toEqual([0, 0]);
  });

  it("keeps rejected, cancelled and refunded sales", async () => {
    tables.work_orders_list = [
      saleRow(1, { status: "rejected", project_id: null }),
      saleRow(2, { cancellation: "cancelled" }),
      saleRow(3, { cancellation: "refunded" }),
    ];
    const sales = await duplicatesRepository.sales();
    expect(sales.map((s) => [s.status, s.cancellation])).toEqual([
      ["rejected", null],
      ["approved", "cancelled"],
      ["approved", "refunded"],
    ]);
  });

  it("counts every ledger entry, whatever its purpose — not the view's contract-only count", async () => {
    // The older copy has only KSEB fees, a refund and a write-off: all of them
    // go with it if it is deleted.
    tables.work_orders_list = [
      saleRow(1, { payment_count: 0 }),
      saleRow(2, { payment_count: 2 }),
      saleRow(3),
    ];
    tables.payments = [
      { work_order_id: "wo-00001", purpose: "kseb_fees" },
      { work_order_id: "wo-00001", purpose: "refund" },
      { work_order_id: "wo-00001", purpose: "write_off" },
      { work_order_id: "wo-00002", purpose: "contract" },
      { work_order_id: "wo-00002", purpose: "contract" },
      { work_order_id: "wo-00002", purpose: "kseb_fees" },
      { work_order_id: null },
    ];
    const sales = await duplicatesRepository.sales();
    expect(sales.map((s) => [s.id, s.paymentCount])).toEqual([
      ["wo-00001", 3],
      ["wo-00002", 3],
      ["wo-00003", 0],
    ]);
  });

  it("drops a sale read twice when rows shifted between pages", async () => {
    tables.work_orders_list = [saleRow(1), saleRow(1), saleRow(2)];
    expect((await duplicatesRepository.sales()).map((s) => s.id)).toEqual([
      "wo-00001",
      "wo-00002",
    ]);
  });

  it("is exported from the data index too", () => {
    expect(fromIndex).toBe(duplicatesRepository);
  });
});

describe("duplicatesRepository.sales — queries", () => {
  it("selects exactly the columns the clean-up page needs", async () => {
    await duplicatesRepository.sales();
    const [sales] = queriesOf("work_orders_list");
    expect(String(sales.calls[0][1])).toBe(
      "id, client_name, order_date, created_at, consumer_number, status, cancellation, coordinator_names, total_cost, amount_received, project_id, current_stage, is_completed, plan_type",
    );
    const [tickets] = queriesOf("service_tickets");
    expect(tickets.calls[0]).toEqual(["select", "project_id"]);
    const [ledger] = queriesOf("payments");
    expect(ledger.calls[0]).toEqual(["select", "work_order_id"]);
  });

  it("reads every ledger entry — no purpose or other filter", async () => {
    await duplicatesRepository.sales();
    const [q] = queriesOf("payments");
    const filters = q.calls.filter(([name]) => !["select", "order", "range"].includes(name));
    expect(filters).toEqual([]);
  });

  it("reads every sale — no status, date or other filter", async () => {
    await duplicatesRepository.sales();
    const [q] = queriesOf("work_orders_list");
    const filters = q.calls.filter(([name]) => !["select", "order", "range"].includes(name));
    expect(filters).toEqual([]);
  });

  it("reads only the tickets that are on a project", async () => {
    await duplicatesRepository.sales();
    const [q] = queriesOf("service_tickets");
    expect(q.calls).toContainEqual(["not", "project_id", "is", null]);
  });

  it("orders every read by a unique column and pages with .range()", async () => {
    await duplicatesRepository.sales();
    expect(queries.map((q) => q.table).sort()).toEqual([
      "payments",
      "service_tickets",
      "work_orders_list",
    ]);
    for (const q of queries) {
      expect(callsNamed(q, "order"), q.table).toEqual([["order", "id", { ascending: true }]]);
      expect(callsNamed(q, "range"), q.table).toEqual([["range", 0, ROWS_PER_PAGE - 1]]);
    }
  });
});

describe("duplicatesRepository.sales — paging", () => {
  it("reads past the 1000-row cap, page by page", async () => {
    tables.work_orders_list = Array.from({ length: 2345 }, (_, i) => saleRow(i));
    tables.service_tickets = Array.from({ length: 1001 }, () => ({ project_id: "p-1" }));
    tables.payments = Array.from({ length: 1500 }, () => ({ work_order_id: "wo-00000" }));
    const sales = await duplicatesRepository.sales();
    expect(sales).toHaveLength(2345);
    expect(sales[0].ticketCount).toBe(1001);
    expect(sales[0].paymentCount).toBe(1500);
    expect(queriesOf("payments")).toHaveLength(2);
    expect(queriesOf("work_orders_list").map((q) => callsNamed(q, "range")[0])).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
      ["range", 2000, 2999],
    ]);
    expect(queriesOf("service_tickets")).toHaveLength(2);
  });

  it("stops cleanly when the last page was exactly full", async () => {
    tables.work_orders_list = Array.from({ length: ROWS_PER_PAGE }, (_, i) => saleRow(i));
    expect(await duplicatesRepository.sales()).toHaveLength(ROWS_PER_PAGE);
    // The second page answered "range not satisfiable": the end, not an error.
    expect(queriesOf("work_orders_list")).toHaveLength(2);
  });
});

describe("duplicatesRepository.sales — failures", () => {
  it.each([
    ["work_orders_list", "sales"],
    ["service_tickets", "service tickets"],
    ["payments", "ledger entries"],
  ])("throws when %s cannot be read, rather than finding no duplicates", async (table, what) => {
    failures[table] = { code: "57014", message: "statement timeout" };
    await expect(duplicatesRepository.sales()).rejects.toThrow(
      `Could not read ${what} for the duplicate check: statement timeout`,
    );
  });

  it("reads 'range not satisfiable' as the end of the rows, not a failure", async () => {
    failures.work_orders_list = { code: "PGRST103", message: "Requested range not satisfiable" };
    expect(await duplicatesRepository.sales()).toEqual([]);
  });
});
