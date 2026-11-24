import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The import's data access against a fake supabase client. The fake applies
 * the `neq`, `order` and `range` a query asks for to an in-memory table, and,
 * like PostgREST (`max_rows`), never returns more than 1,000 rows at once — so
 * a read that does not page loses rows here as it would in production.
 */

type Row = {
  id: string | null;
  client_name: string | null;
  order_date: string | null;
  created_at: string | null;
  coordinator_names: string[] | null;
  total_cost: number | string | null;
  status: "pending" | "approved" | "rejected";
};

const MAX_ROWS = 1000;

let table: Row[];
/** Every query: its table, columns, filters, order and range. */
let queries: {
  table: string;
  columns: string;
  neq?: [string, string];
  order: [string, unknown][];
  range?: [number, number];
}[];
/** Reads from the `from`-th on (the first is 0) answer this instead of rows. */
let failure: { from: number; answer: () => unknown } | null;
let reads: number;
let rpcReply: () => unknown;
let rpcCalls: [string, unknown][];

function query(name: string, columns: string) {
  const q: (typeof queries)[number] = { table: name, columns, order: [] };
  queries.push(q);
  const result = () => {
    if (failure && reads++ >= failure.from) return failure.answer();
    const rows = table
      .filter((r) => !q.neq || String(r[q.neq[0] as keyof Row]) !== q.neq[1])
      .sort((a, b) => {
        for (const [col] of q.order) {
          const x = String(a[col as keyof Row]);
          const y = String(b[col as keyof Row]);
          if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
      });
    const [from, to] = q.range ?? [0, rows.length - 1];
    return { data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null };
  };
  const builder = {
    neq(column: string, value: string) {
      q.neq = [column, value];
      return builder;
    },
    order(column: string, options: unknown) {
      q.order.push([column, options]);
      return builder;
    },
    range(from: number, to: number) {
      q.range = [from, to];
      return builder;
    },
    then(resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve().then(result).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (name: string) => ({ select: (columns: string) => query(name, columns) }),
    rpc: (fn: string, args?: unknown) => {
      rpcCalls.push([fn, args]);
      return Promise.resolve().then(rpcReply);
    },
  })),
}));

import type { ImportRow } from "@/lib/domain/import";
import { importsRepository } from "./imports.repository";

const sale = (n: number, order_date: string | null, over: Partial<Row> = {}): Row => ({
  id: `wo-${String(n).padStart(5, "0")}`,
  client_name: `Customer ${n}`,
  order_date,
  created_at: "2026-11-08T05:00:00+00:00",
  coordinator_names: ["Rahul Menon"],
  total_cost: 195000,
  status: "approved",
  ...over,
});

/** 2026-01-01 plus `n` days, as an ISO date. */
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  table = [];
  queries = [];
  failure = null;
  reads = 0;
  rpcReply = () => ({ data: [], error: null });
  rpcCalls = [];
});

describe("importsRepository.existingSales", () => {
  it("reads only the columns the duplicate check needs, from the work orders list, by id, rejected left out", async () => {
    table = [sale(1, "2026-11-08")];
    await importsRepository.existingSales();
    expect(queries).toEqual([
      {
        table: "work_orders_list",
        columns: "id, client_name, order_date, created_at, coordinator_names, total_cost",
        neq: ["status", "rejected"],
        order: [["id", { ascending: true }]],
        range: [0, 999],
      },
    ]);
  });

  it("maps each sale, whatever its order date", async () => {
    table = [
      sale(1, "2026-11-08", { total_cost: "195000.50", coordinator_names: ["Rahul Menon", "Priya Suresh"] }),
      sale(2, "2019-04-01", { status: "pending" }),
    ];
    const { sales, error } = await importsRepository.existingSales();
    expect(error).toBeNull();
    expect(sales).toEqual([
      {
        id: "wo-00001",
        clientName: "Customer 1",
        orderDate: "2026-11-08",
        createdAt: "2026-11-08T05:00:00+00:00",
        coordinatorNames: ["Rahul Menon", "Priya Suresh"],
        totalCost: 195000.5,
      },
      {
        id: "wo-00002",
        clientName: "Customer 2",
        orderDate: "2019-04-01",
        createdAt: "2026-11-08T05:00:00+00:00",
        coordinatorNames: ["Rahul Menon"],
        totalCost: 195000,
      },
    ]);
  });

  it("leaves out a rejected work order: it is not a sale in the system", async () => {
    table = [
      sale(1, "2026-11-08", { status: "rejected" }),
      sale(2, "2026-11-08", { status: "pending" }),
      sale(3, "2026-11-08", { status: "approved" }),
    ];
    const { sales } = await importsRepository.existingSales();
    expect(sales.map((s) => s.id)).toEqual(["wo-00002", "wo-00003"]);
  });

  it("keeps a sale with no coordinators, value or time, and drops a row with no identity", async () => {
    table = [
      sale(1, "2026-11-08", { coordinator_names: null, total_cost: null, created_at: null }),
      sale(2, "2026-11-08", { client_name: null }),
      sale(3, "2026-11-08", { id: null }),
      sale(4, null),
    ];
    const { sales } = await importsRepository.existingSales();
    expect(sales).toEqual([
      {
        id: "wo-00001",
        clientName: "Customer 1",
        orderDate: "2026-11-08",
        createdAt: "",
        coordinatorNames: [],
        totalCost: 0,
      },
    ]);
  });

  it("is empty, without error, when there are no sales", async () => {
    expect(await importsRepository.existingSales()).toEqual({ sales: [], error: null });
  });

  it("pages past 1,000 sales across every date, without repeats or gaps", async () => {
    // Stored out of id order, over 2,345 days.
    table = Array.from({ length: 2345 }, (_, i) => sale(2344 - i, day(i)));
    const { sales, error } = await importsRepository.existingSales();
    expect(error).toBeNull();
    expect(sales).toHaveLength(2345);
    expect(new Set(sales.map((s) => s.id)).size).toBe(2345);
    expect(queries.map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after a full last page with an empty one", async () => {
    table = Array.from({ length: 1000 }, (_, i) => sale(i, "2026-11-08"));
    const { sales } = await importsRepository.existingSales();
    expect(sales).toHaveLength(1000);
    expect(queries.map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("reports a refused read instead of passing it off as no sales", async () => {
    table = [sale(1, "2026-11-08")];
    failure = { from: 0, answer: () => ({ data: null, error: { message: "permission denied" } }) };
    expect(await importsRepository.existingSales()).toEqual({
      sales: [],
      error: "permission denied",
    });
  });

  it("reports a request that never completed", async () => {
    failure = { from: 0, answer: () => Promise.reject(new TypeError("fetch failed")) };
    expect(await importsRepository.existingSales()).toEqual({
      sales: [],
      error: "The request did not complete",
    });
  });

  it("reports a failure on a later page, dropping what the earlier pages read", async () => {
    table = Array.from({ length: 1500 }, (_, i) => sale(i, "2026-11-08"));
    failure = { from: 1, answer: () => ({ data: null, error: { message: "timeout" } }) };
    const result = await importsRepository.existingSales();
    expect(result).toEqual({ sales: [], error: "timeout" });
  });
});

describe("importsRepository.directory", () => {
  it("lists every account with its e-mail and role", async () => {
    rpcReply = () => ({
      data: [{ id: "r", full_name: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" }],
      error: null,
    });
    expect(await importsRepository.directory()).toEqual({
      accounts: [{ id: "r", fullName: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" }],
      error: null,
    });
    expect(rpcCalls[0][0]).toBe("account_directory");
  });

  it("reports a refused or dropped read", async () => {
    rpcReply = () => ({ data: null, error: { message: "Only office staff" } });
    expect(await importsRepository.directory()).toEqual({ accounts: [], error: "Only office staff" });
    rpcReply = () => Promise.reject(new TypeError("fetch failed"));
    expect(await importsRepository.directory()).toEqual({
      accounts: [],
      error: "The request did not complete",
    });
  });
});

describe("importsRepository.run", () => {
  const batch = [{ row_no: 2, client_name: "A" }] as unknown as ImportRow[];

  it("sends the batch, the default coordinator and the skip setting", async () => {
    rpcReply = () => ({ data: [{ row_no: 2, status: "imported", message: null }], error: null });
    expect(await importsRepository.run(batch, "id-admin", true)).toEqual({
      outcomes: [{ row_no: 2, status: "imported", message: null }],
      failure: null,
    });
    expect(rpcCalls[0]).toEqual([
      "import_projects",
      { p_rows: batch, p_default_coordinator: "id-admin", p_skip_existing: true },
    ]);
  });

  it("passes a refusal's code on, and has none when the request never completed", async () => {
    rpcReply = () => ({ data: null, error: { code: "42501", message: "Only office staff" } });
    expect(await importsRepository.run(batch, "id-admin", false)).toEqual({
      outcomes: [],
      failure: { code: "42501", message: "Only office staff" },
    });
    rpcReply = () => Promise.reject(new TypeError("fetch failed"));
    expect(await importsRepository.run(batch, "id-admin", false)).toEqual({
      outcomes: [],
      failure: { message: "The request did not complete" },
    });
  });
});
