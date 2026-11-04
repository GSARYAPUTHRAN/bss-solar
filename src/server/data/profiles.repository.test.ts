import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The parts of the profiles repository that changed with shared sales, against
 * a fake supabase client that records each query.
 */

type Call = [string, ...unknown[]];

let recorded: Call[];
let counts: Record<string, number>;
let directory: unknown;
/** What `account_directory()` answers: a reply, or a rejection for a dropped request. */
let accountsReply: () => unknown;

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
          recorded.push([`${String(first[1])}.${String(prop)}`, ...args]);
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
          count: counts[table] ?? 0,
          data: null,
          error: null,
        })),
    }),
    rpc: (fn: string) =>
      builder(["rpc", fn], () =>
        fn === "account_directory"
          ? accountsReply()
          : { data: fn === "coordinator_directory" ? directory : null, error: null },
      ),
  })),
}));

import { profilesRepository } from "./profiles.repository";

const PRIYA = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  recorded = [];
  counts = {};
  directory = [];
  accountsReply = () => ({ data: [], error: null });
});

describe("profilesRepository.ownedWorkCount", () => {
  it("counts the sales a member shares, not only the ones they logged", async () => {
    counts = { work_order_coordinators: 3, projects_list: 2, service_tickets: 0 };
    expect(await profilesRepository.ownedWorkCount(PRIYA)).toEqual({
      workOrders: 3,
      projects: 2,
      activeTickets: 0,
    });

    // Work orders: memberships (a partner has one for every sale they share).
    expect(recorded).toContainEqual([
      "select",
      "work_order_coordinators",
      "work_order_id",
      { count: "exact", head: true },
    ]);
    expect(recorded).toContainEqual(["work_order_coordinators.eq", "coordinator_id", PRIYA]);
    // Projects: the sales' projects, read through the team the view lists.
    expect(recorded).toContainEqual(["projects_list.contains", "coordinator_ids", [PRIYA]]);
    // …and no longer the single-owner columns.
    expect(recorded.map((call) => call[1])).not.toContain("work_orders");
    expect(recorded.map((call) => call[1])).not.toContain("projects");
  });

  it("still counts an engineer's open tickets", async () => {
    counts = { service_tickets: 2 };
    expect((await profilesRepository.ownedWorkCount(PRIYA)).activeTickets).toBe(2);
    expect(recorded).toContainEqual(["service_tickets.eq", "assigned_to", PRIYA]);
    expect(recorded).toContainEqual([
      "service_tickets.in",
      "status",
      ["open", "scheduled", "in_progress"],
    ]);
  });

  it("is zero for a member with nothing", async () => {
    expect(await profilesRepository.ownedWorkCount(PRIYA)).toEqual({
      workOrders: 0,
      projects: 0,
      activeTickets: 0,
    });
  });
});

describe("profilesRepository.coordinatorDirectory", () => {
  it("lists the accounts that can own or share a sale, names and roles only", async () => {
    directory = [
      { id: "a", full_name: "BSS Admin", role: "admin", extra: "ignored" },
      { id: "r", full_name: "Rahul Menon", role: "coordinator" },
    ];
    expect(await profilesRepository.coordinatorDirectory()).toEqual([
      { id: "a", full_name: "BSS Admin", role: "admin" },
      { id: "r", full_name: "Rahul Menon", role: "coordinator" },
    ]);
    expect(recorded[0]).toEqual(["rpc", "coordinator_directory"]);
  });

  it("is empty when nothing comes back (an engineer, or a failed read)", async () => {
    directory = null;
    expect(await profilesRepository.coordinatorDirectory()).toEqual([]);
  });
});

describe("profilesRepository.accounts", () => {
  it("lists every account with its login e-mail, for the Team page and the duplicate checks", async () => {
    accountsReply = () => ({
      data: [
        { id: "r", full_name: "Ravee Kumar", email: "ravi@bsssolar.invalid", role: "coordinator", extra: "ignored" },
        { id: "a", full_name: "BSS Admin", email: "admin@bsssolar.test", role: "admin" },
      ],
      error: null,
    });
    expect(await profilesRepository.accounts()).toEqual({
      accounts: [
        { id: "r", fullName: "Ravee Kumar", email: "ravi@bsssolar.invalid", role: "coordinator" },
        { id: "a", fullName: "BSS Admin", email: "admin@bsssolar.test", role: "admin" },
      ],
      error: null,
    });
    expect(recorded[0]).toEqual(["rpc", "account_directory"]);
  });

  it("keeps an account with no e-mail on record, as null", async () => {
    accountsReply = () => ({
      data: [{ id: "x", full_name: "No Login", email: null, role: "coordinator" }],
      error: null,
    });
    expect((await profilesRepository.accounts()).accounts[0].email).toBeNull();
  });

  it("reports a refused read instead of passing it off as an empty team", async () => {
    accountsReply = () => ({
      data: null,
      error: { message: "Only office staff can read the account directory" },
    });
    expect(await profilesRepository.accounts()).toEqual({
      accounts: [],
      error: "Only office staff can read the account directory",
    });
  });

  it("reports a request that never completed", async () => {
    accountsReply = () => Promise.reject(new TypeError("fetch failed"));
    expect(await profilesRepository.accounts()).toEqual({
      accounts: [],
      error: "The request did not complete",
    });
  });
});

describe("profilesRepository.page", () => {
  it("breaks ties on id, so accounts created together page without repeats or gaps", async () => {
    await profilesRepository.page({
      page: 2,
      pageSize: 10,
      q: "",
      sort: "created_at",
      dir: "desc",
      filters: {},
    });
    const orders = recorded.filter(([name]) => name === "profiles.order");
    expect(orders[0]).toEqual(["profiles.order", "created_at", { ascending: false }]);
    expect(orders[orders.length - 1]).toEqual(["profiles.order", "id", { ascending: true }]);
    expect(recorded).toContainEqual(["profiles.range", 10, 19]);
  });
});
