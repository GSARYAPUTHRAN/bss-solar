import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The paged repository reads, against a fake supabase client that records each
 * query: a page past the end (PostgREST's HTTP 416 / PGRST103) must come back
 * empty with the total from a head count carrying the SAME filters, and any
 * other failure must throw rather than read as an empty list.
 */

type Response = {
  data: unknown[] | null;
  count: number | null;
  error: { code?: string; message: string } | null;
};

interface RecordedQuery {
  head: boolean;
  calls: [string, ...unknown[]][];
}

let responses: { rows: Response; head: Response };
let queries: RecordedQuery[];

/** A thenable builder: every method is recorded and chains; awaiting resolves. */
function builder(head: boolean, first: [string, ...unknown[]]) {
  const query: RecordedQuery = { head, calls: [first] };
  queries.push(query);
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const res = head ? responses.head : responses.rows;
          return (resolve: (r: Response) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(res).then(resolve, reject);
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
      select: (columns: string, opts?: { head?: boolean }) =>
        builder(Boolean(opts?.head), ["from", table, columns]),
    }),
    rpc: (fn: string, _args: unknown, opts?: { head?: boolean }) =>
      builder(Boolean(opts?.head), ["rpc", fn]),
  })),
}));

import { notificationsRepository } from "./notifications.repository";
import { ticketsRepository } from "./tickets.repository";
import { projectsRepository } from "./projects.repository";
import { workOrdersRepository } from "./work-orders.repository";
import type { PageParams } from "@/lib/pagination";

const PAST_THE_END: Response = {
  data: null,
  count: null,
  error: { code: "PGRST103", message: "Requested range not satisfiable" },
};

function params(overrides: Partial<PageParams> = {}): PageParams {
  return { page: 2, pageSize: 10, q: "", sort: null, dir: "desc", filters: {}, ...overrides };
}

const rowsQuery = () => queries.find((q) => !q.head);
const headQuery = () => queries.find((q) => q.head);
/** The filter calls, i.e. everything but the paging/ordering of the rows. */
const filtersOf = (q: RecordedQuery | undefined) =>
  q?.calls.filter(([name]) => name !== "order" && name !== "range").slice(1);

beforeEach(() => {
  queries = [];
  responses = {
    rows: { data: [], count: 0, error: null },
    head: { data: null, count: 0, error: null },
  };
});

describe("notificationsRepository.page", () => {
  it("returns the page when it exists, with no extra count", async () => {
    responses.rows = { data: [{ id: "n1" }], count: 21, error: null };
    const result = await notificationsRepository.page({ page: 2, pageSize: 20 });
    expect(result).toEqual({ rows: [{ id: "n1" }], total: 21, page: 2, pageSize: 20 });
    expect(rowsQuery()?.calls).toContainEqual(["range", 20, 39]);
    expect(headQuery()).toBeUndefined();
  });

  it("answers a page past the end (after 'Mark all read') with no rows and the real total", async () => {
    responses.rows = PAST_THE_END;
    responses.head = { data: null, count: 3, error: null };
    const result = await notificationsRepository.page({
      page: 2,
      pageSize: 20,
      unreadOnly: true,
    });
    expect(result).toEqual({ rows: [], total: 3, page: 2, pageSize: 20 });
    expect(filtersOf(headQuery())).toEqual([["is", "read_at", null]]);
    expect(filtersOf(headQuery())).toEqual(filtersOf(rowsQuery()));
  });

  it("throws on any other failure", async () => {
    responses.rows = { data: null, count: null, error: { code: "42501", message: "denied" } };
    await expect(notificationsRepository.page({ page: 1, pageSize: 20 })).rejects.toThrow(
      "Could not load notifications: denied",
    );
  });
});

describe("ticketsRepository.pageForEngineer", () => {
  const scoped = params({ q: "TKT-7", filters: { type: "adhoc" } });
  const ACTIVE = ["open", "scheduled", "in_progress"] as const;

  it("keeps the real total for a page past the end, so the list can offer a way back", async () => {
    responses.rows = PAST_THE_END;
    responses.head = { data: null, count: 9, error: null };
    const result = await ticketsRepository.pageForEngineer(scoped, ACTIVE);
    expect(result).toEqual({ rows: [], total: 9, page: 2, pageSize: 10 });

    const filters = filtersOf(headQuery());
    expect(filters).toEqual(filtersOf(rowsQuery()));
    expect(filters).toContainEqual(["in", "status", ACTIVE]);
    expect(filters).toContainEqual(["eq", "ticket_type", "adhoc"]);
    expect(headQuery()?.calls[0]).toEqual(["rpc", "engineer_tickets"]);
  });

  it("no longer reads a failed query as 'all caught up'", async () => {
    responses.rows = { data: null, count: null, error: { message: "FetchError: timeout" } };
    await expect(ticketsRepository.pageForEngineer(scoped, ACTIVE)).rejects.toThrow(
      "Could not load your service tickets: FetchError: timeout",
    );
  });
});

describe("the office lists", () => {
  it("tickets: a page past the end keeps the filtered total", async () => {
    responses.rows = PAST_THE_END;
    responses.head = { data: null, count: 4, error: null };
    const result = await ticketsRepository.page(params({ filters: { status: "open" } }));
    expect(result).toMatchObject({ rows: [], total: 4 });
    expect(filtersOf(headQuery())).toEqual([["eq", "status", "open"]]);
  });

  it("work orders: a page past the end keeps the filtered total", async () => {
    responses.rows = PAST_THE_END;
    responses.head = { data: null, count: 6, error: null };
    const result = await workOrdersRepository.page(
      params({ filters: { status: "pending", payment: "pending" } }),
    );
    expect(result).toMatchObject({ rows: [], total: 6 });
    expect(filtersOf(headQuery())).toEqual([
      ["eq", "status", "pending"],
      ["gt", "balance_due", 0],
    ]);
  });

  it("work orders: any other failure throws instead of an empty list", async () => {
    responses.rows = { data: null, count: null, error: { message: "boom" } };
    await expect(workOrdersRepository.page(params())).rejects.toThrow(
      "Could not load work orders: boom",
    );
  });

  it("projects: a page past the end keeps the filtered total", async () => {
    responses.rows = PAST_THE_END;
    responses.head = { data: null, count: 2, error: null };
    const result = await projectsRepository.page(
      params({ filters: { feasibility: "expiring" } }),
    );
    expect(result).toMatchObject({ rows: [], total: 2 });
    expect(filtersOf(headQuery())).toEqual(filtersOf(rowsQuery()));
  });
});

describe("projectsRepository.page feasibility filters", () => {
  it("'extended' includes commissioned projects (the dashboard's extension cost counts them)", async () => {
    await projectsRepository.page(params({ filters: { feasibility: "extended" } }));
    const filters = filtersOf(rowsQuery());
    expect(filters).toEqual([["gt", "feasibility_renewals", 0]]);
  });

  it.each(["expiring", "not_set"])("'%s' only selects active projects", async (feasibility) => {
    await projectsRepository.page(params({ filters: { feasibility } }));
    expect(filtersOf(rowsQuery())).toContainEqual(["eq", "is_completed", false]);
  });
});
