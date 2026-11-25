import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupDeletions } from "@/lib/domain/deletion-log";

/**
 * The deletion log's read against a fake supabase client that records every
 * call: the latest deletes are named first (`recent_deletion_txs`), then every
 * row of them is read in id order, page by page, and mapped to the domain's
 * rows, newest first. A failed read throws rather than showing an empty log.
 */

type Call = [string, ...unknown[]];
type Failure = { code?: string; message: string } | null;

interface LogRow {
  id: number | string;
  table_name: string;
  record_id: string;
  snapshot: unknown;
  deleted_by_name: string | null;
  deleted_at: string;
  tx: number | string;
}

let recorded: Call[];
/** What `recent_deletion_txs` answers. */
let txReply: { data: unknown; error: Failure };
/** Every row in `deleted_records`. */
let log: LogRow[];
/** When set, every page of the rows read fails with it. */
let pageFailure: Failure;

/** A thenable query on `deleted_records`: records each call; awaiting answers its page. */
function builder(first: Call) {
  recorded.push(first);
  const calls: Call[] = [];
  const answer = () => {
    if (pageFailure) return { data: null, error: pageFailure };
    const inTx = calls.find(([name]) => name === "in");
    const wanted = new Set(((inTx?.[2] as unknown[]) ?? []).map(Number));
    const rows = log
      .filter((row) => wanted.has(Number(row.tx)))
      .sort((a, b) => Number(a.id) - Number(b.id));
    const range = calls.find(([name]) => name === "range") as [string, number, number] | undefined;
    if (!range) return { data: rows, error: null };
    const [, from, to] = range;
    if (from > 0 && from >= rows.length) {
      return { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } };
    }
    return { data: rows.slice(from, to + 1), error: null };
  };
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(answer()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          const call: Call = [String(prop), ...args];
          calls.push(call);
          recorded.push(call);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: (name: string, args: unknown) => {
      recorded.push(["rpc", name, args]);
      return Promise.resolve(txReply);
    },
    from: (table: string) => ({
      select: (columns: string) => builder(["select", table, columns]),
    }),
  })),
}));

import { deletionLogRepository, MAX_RECENT_DELETES } from "./deletion-log.repository";
import { deletionLogRepository as fromIndex } from "@/server/data";

const COLUMNS = "id, table_name, record_id, snapshot, deleted_by_name, deleted_at, tx";

const ROW: LogRow = {
  id: 42,
  table_name: "work_orders",
  record_id: "wo-1",
  snapshot: { id: "wo-1", client_name: "Anil Kumar", total_cost: 235000 },
  deleted_by_name: "BSS Admin",
  deleted_at: "2026-11-25T06:30:00+00:00",
  tx: 98765,
};

beforeEach(() => {
  recorded = [];
  txReply = { data: [98765], error: null };
  log = [ROW];
  pageFailure = null;
});

describe("deletionLogRepository.recent", () => {
  it("names the latest 50 deletes, then reads every row of them in id order, page by page", async () => {
    await deletionLogRepository.recent();
    expect(recorded).toEqual([
      ["rpc", "recent_deletion_txs", { p_limit: 50 }],
      ["select", "deleted_records", COLUMNS],
      ["in", "tx", [98765]],
      ["order", "id", { ascending: true }],
      ["range", 0, 999],
    ]);
  });

  it("maps a row to the domain's shape", async () => {
    expect(await deletionLogRepository.recent()).toEqual([
      {
        id: 42,
        tableName: "work_orders",
        recordId: "wo-1",
        snapshot: { id: "wo-1", client_name: "Anil Kumar", total_cost: 235000 },
        deletedByName: "BSS Admin",
        deletedAt: "2026-11-25T06:30:00+00:00",
        tx: 98765,
      },
    ]);
  });

  it("reads bigint ids that arrive as strings as numbers", async () => {
    txReply = { data: ["98765"], error: null };
    log = [{ ...ROW, id: "42", tx: "98765" }];
    const [row] = await deletionLogRepository.recent();
    expect(recorded).toContainEqual(["in", "tx", [98765]]);
    expect(row.id).toBe(42);
    expect(row.tx).toBe(98765);
  });

  it.each([null, "text", 5, ["array"]])("reads a snapshot of %j as empty", async (snapshot) => {
    log = [{ ...ROW, snapshot }];
    expect((await deletionLogRepository.recent())[0].snapshot).toEqual({});
  });

  it("keeps an unknown actor as null", async () => {
    log = [{ ...ROW, deleted_by_name: null }];
    expect((await deletionLogRepository.recent())[0].deletedByName).toBeNull();
  });

  it.each([
    [50, 50],
    [200, 200],
    [5000, MAX_RECENT_DELETES],
    [0, 1],
    [-3, 1],
    [12.7, 12],
    [Number.NaN, 1],
  ])("asks for %s deletes as %s (at least one, at most the function's cap)", async (groups, sent) => {
    await deletionLogRepository.recent(groups);
    expect(recorded[0]).toEqual(["rpc", "recent_deletion_txs", { p_limit: sent }]);
    expect(MAX_RECENT_DELETES).toBe(200);
  });

  it("is empty for an empty log, without reading any rows", async () => {
    txReply = { data: [], error: null };
    expect(await deletionLogRepository.recent()).toEqual([]);
    txReply = { data: null, error: null };
    expect(await deletionLogRepository.recent()).toEqual([]);
    expect(recorded.filter(([name]) => name === "select")).toEqual([]);
  });

  it("throws when the deletes cannot be named, rather than showing nothing deleted", async () => {
    txReply = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(deletionLogRepository.recent()).rejects.toThrow(
      "Could not read the deletion log: permission denied",
    );
  });

  it("throws when their rows cannot be read", async () => {
    pageFailure = { code: "57014", message: "statement timeout" };
    await expect(deletionLogRepository.recent()).rejects.toThrow(
      "Could not read the deletion log: statement timeout",
    );
  });

  it("returns the rows newest first, the id breaking ties", async () => {
    txReply = { data: [2, 1], error: null };
    log = [
      { ...ROW, id: 1, tx: 1, deleted_at: "2026-11-20T06:30:00+00:00" },
      { ...ROW, id: 2, tx: 1, deleted_at: "2026-11-20T06:30:00+00:00" },
      { ...ROW, id: 3, tx: 2, deleted_at: "2026-11-25T06:30:00.123456+00:00" },
    ];
    expect((await deletionLogRepository.recent()).map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("is exported from the data index too", () => {
    expect(fromIndex).toBe(deletionLogRepository);
  });
});

describe("deletionLogRepository.recent — a bulk clean-up", () => {
  /**
   * One bulk delete of 300 sales, each with its project and two ledger entries:
   * 1200 rows in one transaction, the sales logged first (the lowest ids), then
   * the cascaded children. Before it, an older delete of one engineer.
   */
  function bulkCleanUp() {
    const at = "2026-11-25T06:30:00.5+00:00";
    const rows: LogRow[] = [{ ...ROW, id: 1, tx: 500, table_name: "profiles", record_id: "eng-1",
      snapshot: { id: "eng-1", full_name: "Vineeth Nair", role: "service_engineer" },
      deleted_at: "2026-11-24T10:00:00+00:00" }];
    let id = 100;
    const sale = (i: number) => `wo-${String(i).padStart(4, "0")}`;
    for (let i = 0; i < 300; i++) {
      rows.push({ ...ROW, id: id++, tx: 900, record_id: sale(i), deleted_at: at,
        snapshot: { id: sale(i), client_name: `Client ${i}` } });
    }
    for (let i = 0; i < 300; i++) {
      rows.push({ ...ROW, id: id++, tx: 900, table_name: "projects", record_id: `p-${i}`,
        deleted_at: at, snapshot: { id: `p-${i}`, work_order_id: sale(i), service_ticket_ids: [] } });
    }
    for (let i = 0; i < 600; i++) {
      rows.push({ ...ROW, id: id++, tx: 900, table_name: "payments", record_id: `pay-${i}`,
        deleted_at: at, snapshot: { id: `pay-${i}`, work_order_id: sale(i % 300), amount: 1000 } });
    }
    return rows;
  }

  beforeEach(() => {
    log = bulkCleanUp();
    txReply = { data: [900, 500], error: null };
  });

  it("reads every row of the delete, past the 1000-row cap", async () => {
    const rows = await deletionLogRepository.recent();
    expect(rows).toHaveLength(1201);
    expect(recorded.filter(([name]) => name === "range")).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
    ]);
  });

  it("is headed by the sales, counts all of what went with them, and still lists the older delete", async () => {
    const groups = groupDeletions(await deletionLogRepository.recent());
    expect(groups.map((g) => [g.tx, g.kind])).toEqual([
      [900, "work_orders"],
      [500, "profiles"],
    ]);
    expect(groups[0].headline).toHaveLength(300);
    expect(groups[0].headline[0]).toBe("Sale — Client 0");
    expect(groups[0].alsoRemoved.map((a) => a.label)).toEqual(["300 projects", "600 ledger entries"]);
    expect(groups[1].headline).toEqual(["Team member — Vineeth Nair (Service Engineer)"]);
  });
});
