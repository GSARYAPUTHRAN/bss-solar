import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_STATUS_FILTERS,
  matchesCoordinator,
  matchesFeasibilityFilter,
  matchesProjectStatus,
  matchesSaleIncentiveFilter,
  type FeasibilityFilter,
  type IncentiveFilter,
} from "@/lib/domain/project-list";
import type { PageParams } from "@/lib/pagination";
import type { ProjectListRow } from "@/lib/types";

/**
 * The projects repository against a fake supabase client that records each
 * query. The list filters are checked against the row predicates the board and
 * client-mode tables use (lib/domain/project-list.ts): the same rows must come
 * out of both, or a count on one screen disagrees with the list on another.
 */

type Call = [string, ...unknown[]];
interface Recorded {
  table: string;
  calls: Call[];
}

type Response = { data: unknown; count?: number | null; error: { message: string } | null };

let queries: Recorded[];
let response: Response;

/** A thenable builder: every method is recorded and chains; awaiting resolves. */
function builder(recorded: Recorded) {
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (r: Response) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(response).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          recorded.calls.push([String(prop), ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) =>
      new Proxy(
        {},
        {
          get(_target, op) {
            return (...args: unknown[]) => {
              const recorded: Recorded = { table, calls: [[String(op), ...args]] };
              queries.push(recorded);
              return builder(recorded);
            };
          },
        },
      ),
    rpc: (fn: string, args?: unknown) => {
      const recorded: Recorded = { table: `rpc:${fn}`, calls: [["rpc", args]] };
      queries.push(recorded);
      return builder(recorded);
    },
  })),
}));

import { formatCurrency } from "@/lib/format";
import { projectsRepository } from "./projects.repository";

beforeEach(() => {
  queries = [];
  response = { data: [], count: 0, error: null };
});

function params(filters: Record<string, string> = {}, over: Partial<PageParams> = {}): PageParams {
  return { page: 1, pageSize: 10, q: "", sort: null, dir: "desc", filters, ...over };
}

const lastQuery = () => queries.at(-1)!;
/** The filters of the (last) rows query, i.e. everything but select/order/range. */
const filtersOf = (q: Recorded = lastQuery()) =>
  q.calls.filter(([name]) => !["select", "order", "range"].includes(name));
const callsNamed = (name: string, q: Recorded = lastQuery()) =>
  q.calls.filter(([n]) => n === name);

// --- A minimal PostgREST: just the operators the repository uses ------------

type Row = Record<string, unknown>;

function passes(row: Row, [op, col, ...args]: Call): boolean {
  const value = row[col as string];
  switch (op) {
    case "eq":
      return value === args[0];
    case "is":
      return value == null;
    case "not":
      return value != null; // .not(col, "is", null)
    case "gt":
      return value != null && (value as number) > (args[0] as number);
    case "gte":
      return value != null && (value as number) >= (args[0] as number);
    case "lte":
      return value != null && (value as number) <= (args[0] as number);
    case "contains":
      return (
        Array.isArray(value) &&
        (args[0] as unknown[]).every((wanted) => value.includes(wanted))
      );
    default:
      throw new Error(`the fake PostgREST does not know .${op}()`);
  }
}

function select(rows: Row[], q: Recorded): Row[] {
  return rows.filter((row) => filtersOf(q).every((call) => passes(row, call)));
}

// --- Rows as projects_list returns them -------------------------------------

const RAVI = "11111111-1111-4111-8111-111111111111";
const ABHIJITH = "22222222-2222-4222-8222-222222222222";
const MANOHAR = "33333333-3333-4333-8333-333333333333";

function listRow(id: string, over: Partial<ProjectListRow> = {}): ProjectListRow {
  const base = {
    id,
    is_completed: false,
    cancellation: null,
    cancelled_on: null,
    plan_type: "solar",
    balance_due: 0,
    feasibility_date: null,
    feasibility_days_left: null,
    feasibility_renewals: 0,
    coordinator_ids: [RAVI],
    incentive_count: 0,
    incentive_unpaid_count: 0,
    incentive_paid: 0,
    incentive_unpaid_coordinator_ids: [],
    incentive_paid_coordinator_ids: [],
    ...over,
  } as ProjectListRow;
  // The view's own rule: only a commissioned, live project can be payment-pending.
  return {
    ...base,
    payment_pending: base.is_completed && base.cancellation == null && base.balance_due! > 0,
  };
}

const ROWS: ProjectListRow[] = [
  listRow("active"),
  listRow("active-clock", {
    feasibility_date: "2026-09-25",
    feasibility_days_left: 3,
    feasibility_renewals: 0,
    coordinator_ids: [RAVI, ABHIJITH],
  }),
  listRow("active-far", { feasibility_date: "2026-10-05", feasibility_days_left: 25 }),
  listRow("active-extended", {
    feasibility_date: "2026-08-01",
    feasibility_days_left: 20,
    feasibility_renewals: 1,
  }),
  listRow("done-paid", { is_completed: true }),
  listRow("done-unpaid", { is_completed: true, balance_due: 40000, coordinator_ids: [ABHIJITH] }),
  listRow("done-extended", { is_completed: true, feasibility_date: "2026-01-01", feasibility_renewals: 2 }),
  listRow("cancelled", { cancellation: "cancelled", cancelled_on: "2026-10-01", balance_due: 15000 }),
  listRow("refunded", {
    cancellation: "refunded",
    cancelled_on: "2026-10-01",
    feasibility_date: "2026-08-01",
    // The view leaves days-left null once a project is cancelled.
    feasibility_days_left: null,
    feasibility_renewals: 1,
    coordinator_ids: [RAVI, MANOHAR],
  }),
  listRow("refunded-after-commissioning", {
    is_completed: true,
    cancellation: "refunded",
    balance_due: 5000,
  }),
  listRow("custom", { plan_type: "custom", is_completed: false }),
  listRow("custom-cancelled", { plan_type: "custom", cancellation: "cancelled" }),
  listRow("incentive-pending", {
    incentive_count: 2,
    incentive_unpaid_count: 2,
    incentive_unpaid_coordinator_ids: [RAVI, ABHIJITH],
    coordinator_ids: [RAVI, ABHIJITH],
  }),
  // Ravi is paid in full; Abhijith has had nothing.
  listRow("incentive-partly-paid", {
    incentive_count: 2,
    incentive_unpaid_count: 1,
    incentive_paid: 6000,
    incentive_unpaid_coordinator_ids: [ABHIJITH],
    incentive_paid_coordinator_ids: [RAVI],
    coordinator_ids: [RAVI, ABHIJITH],
  }),
  // One person, paid in two instalments of three: still owed the rest.
  listRow("incentive-instalments", {
    incentive_count: 1,
    incentive_unpaid_count: 1,
    incentive_paid: 4000,
    incentive_unpaid_coordinator_ids: [RAVI],
  }),
  listRow("incentive-paid", {
    incentive_count: 1,
    incentive_unpaid_count: 0,
    incentive_paid: 6000,
    incentive_paid_coordinator_ids: [RAVI],
  }),
];

const idsOf = (rows: Row[]) => rows.map((r) => r.id).sort();

async function filtered(filters: Record<string, string>): Promise<Row[]> {
  await projectsRepository.page(params(filters));
  return select(ROWS as unknown as Row[], lastQuery());
}

describe("projectsRepository.page — filters agree with the row predicates", () => {
  it.each(PROJECT_STATUS_FILTERS)("status=%s", async (status) => {
    expect(idsOf(await filtered({ status }))).toEqual(
      idsOf(ROWS.filter((r) => matchesProjectStatus(r, status)) as unknown as Row[]),
    );
  });

  it("status: active and commissioned exclude cancelled and refunded; closed is both", async () => {
    expect(idsOf(await filtered({ status: "active" }))).not.toContain("cancelled");
    expect(idsOf(await filtered({ status: "completed" }))).not.toContain(
      "refunded-after-commissioning",
    );
    expect(idsOf(await filtered({ status: "closed" }))).toEqual([
      "cancelled",
      "custom-cancelled",
      "refunded",
      "refunded-after-commissioning",
    ]);
    expect(idsOf(await filtered({ status: "payment_pending" }))).toEqual(["done-unpaid"]);
    expect(idsOf(await filtered({ status: "refunded" }))).toEqual([
      "refunded",
      "refunded-after-commissioning",
    ]);
  });

  it.each(["expiring", "extended", "not_set"] as FeasibilityFilter[])(
    "feasibility=%s",
    async (feasibility) => {
      expect(idsOf(await filtered({ feasibility }))).toEqual(
        idsOf(ROWS.filter((r) => matchesFeasibilityFilter(r, feasibility)) as unknown as Row[]),
      );
    },
  );

  it("feasibility: a cancelled project is never expiring or 'not set', a custom plan never 'not set'", async () => {
    const notSet = idsOf(await filtered({ feasibility: "not_set" }));
    expect(notSet).not.toContain("custom");
    expect(notSet).not.toContain("cancelled");
    expect(notSet).toContain("active");
    // Renewals BSS bore stay visible after the clock stopped.
    expect(idsOf(await filtered({ feasibility: "extended" }))).toContain("refunded");
  });

  it("coordinator matches any member of the sale, not only the first", async () => {
    for (const id of [RAVI, ABHIJITH, MANOHAR]) {
      expect(idsOf(await filtered({ coordinator: id }))).toEqual(
        idsOf(ROWS.filter((r) => matchesCoordinator(r, id)) as unknown as Row[]),
      );
    }
    expect(idsOf(await filtered({ coordinator: MANOHAR }))).toEqual(["refunded"]);
    expect(callsNamed("contains")).toContainEqual(["contains", "coordinator_ids", [MANOHAR]]);
  });

  it("ignores a coordinator that is not a uuid instead of failing the whole page", async () => {
    await projectsRepository.page(params({ coordinator: "not-a-uuid" }));
    expect(filtersOf()).toEqual([]);
  });

  it("plan", async () => {
    expect(idsOf(await filtered({ plan: "custom" }))).toEqual(["custom", "custom-cancelled"]);
    expect(idsOf(await filtered({ plan: "solar" }))).not.toContain("custom");
    // Unknown values are ignored, not handed to Postgres as a bad enum.
    await projectsRepository.page(params({ plan: "hybrid" }));
    expect(filtersOf()).toEqual([]);
  });

  describe("incentive", () => {
    it.each([
      ["pending", undefined],
      ["paid", undefined],
      ["pending", RAVI],
      ["pending", ABHIJITH],
      ["paid", RAVI],
      ["paid", ABHIJITH],
      ["partly_paid", undefined],
      ["partly_paid", RAVI],
      ["partly_paid", ABHIJITH],
    ] as [IncentiveFilter, string | undefined][])(
      "incentive=%s coordinator=%s",
      async (incentive, coordinator) => {
        const rows = await filtered({ incentive, ...(coordinator ? { coordinator } : {}) });
        expect(idsOf(rows)).toEqual(
          idsOf(
            ROWS.filter(
              (r) =>
                matchesSaleIncentiveFilter(r, incentive, coordinator) &&
                (!coordinator || matchesCoordinator(r, coordinator)),
            ) as unknown as Row[],
          ),
        );
      },
    );

    it("a sale is 'pending' while anyone is unpaid and 'paid' only when everyone set is paid", async () => {
      expect(idsOf(await filtered({ incentive: "pending" }))).toEqual([
        "incentive-instalments",
        "incentive-partly-paid",
        "incentive-pending",
      ]);
      expect(idsOf(await filtered({ incentive: "paid" }))).toEqual(["incentive-paid"]);
    });

    it("'partly paid' is money paid with something still to pay — instalments count, not only people", async () => {
      expect(idsOf(await filtered({ incentive: "partly_paid" }))).toEqual([
        "incentive-instalments",
        "incentive-partly-paid",
      ]);
      expect(callsNamed("gt")).toEqual([
        ["gt", "incentive_unpaid_count", 0],
        ["gt", "incentive_paid", 0],
      ]);
    });

    it("narrowed to one person, it is about that person's own incentive", async () => {
      // Ravi is paid on the partly-paid sale, Abhijith is not.
      expect(idsOf(await filtered({ incentive: "paid", coordinator: RAVI }))).toEqual([
        "incentive-paid",
        "incentive-partly-paid",
      ]);
      expect(idsOf(await filtered({ incentive: "pending", coordinator: RAVI }))).toEqual([
        "incentive-instalments",
        "incentive-pending",
      ]);
    });

    it("narrowed to one person, 'partly paid' needs them to be owed while money has been paid", async () => {
      expect(idsOf(await filtered({ incentive: "partly_paid", coordinator: RAVI }))).toEqual([
        "incentive-instalments",
      ]);
      expect(idsOf(await filtered({ incentive: "partly_paid", coordinator: ABHIJITH }))).toEqual([
        "incentive-partly-paid",
      ]);
    });
  });
});

describe("projectsRepository.page — search and order", () => {
  it("searches the combined coordinator names", async () => {
    await projectsRepository.page(params({}, { q: "Abhijith" }));
    expect(callsNamed("or")[0][1]).toContain("coordinator_name.ilike.%Abhijith%");
  });

  it("sorts by the sale's incentive total, last when empty", async () => {
    await projectsRepository.page(params({}, { sort: "incentive_total", dir: "asc" }));
    expect(callsNamed("order")).toContainEqual([
      "order",
      "incentive_total",
      { ascending: true, nullsFirst: false },
    ]);
  });

  it.each(["coordinator_incentive", "incentive_paid_on", "nope; drop table"])(
    "does not sort by %s (not an offered column)",
    async (sort) => {
      await projectsRepository.page(params({}, { sort }));
      expect(callsNamed("order")[0][1]).toBe("created_at");
    },
  );

  it.each([
    ["the default sort", null, "desc"],
    ["client_name asc", "client_name", "asc"],
    ["feasibility_days_left desc", "feasibility_days_left", "desc"],
  ] as const)(
    "ends on the unique id whatever the sort (%s), so an import's tied rows page cleanly",
    async (_label, sort, dir) => {
      await projectsRepository.page(params({}, { sort, dir }));
      // An import creates every row in one transaction: created_at, the
      // coordinators and the stage all tie, and paging over ties skips and repeats rows.
      expect(callsNamed("order").at(-1)).toEqual(["order", "id", { ascending: true }]);
      // The sort, then the newest first, then id — except a created_at sort, which is the newest first already.
      expect(callsNamed("order")).toHaveLength(sort === null ? 2 : 3);
      if (sort !== null) {
        expect(callsNamed("order")[1]).toEqual(["order", "created_at", { ascending: false }]);
      }
    },
  );
});

describe("projectsRepository.board", () => {
  it("is newest first and ends on the unique id, so the same rows make the cut", async () => {
    await projectsRepository.board(25);
    expect(lastQuery().table).toBe("projects_list");
    expect(callsNamed("order")).toEqual([
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: true }],
    ]);
    expect(callsNamed("limit")).toEqual([["limit", 25]]);
  });
});

describe("projectsRepository.byId", () => {
  const MEMBER_PARTNER = {
    coordinator_id: ABHIJITH,
    sort_order: 2,
    created_at: "2026-09-02T10:00:00Z",
    profile: { id: ABHIJITH, full_name: "Abhijith Nair" },
    // Newer PostgREST: the one-to-one embed arrives as an object…
    incentive: { amount: "3500.00", paid_on: null, payments: [] },
  };
  const MEMBER_FIRST = {
    coordinator_id: RAVI,
    sort_order: 1,
    created_at: "2026-09-01T10:00:00Z",
    profile: { id: RAVI, full_name: "Ravi Kumar" },
    // …older versions wrap it in an array.
    incentive: [
      {
        amount: 2000,
        paid_on: "2026-10-01",
        // Out of order, as nothing orders a nested embed: oldest first is ours.
        payments: [
          {
            id: "pay-2",
            amount: "1500.00",
            paid_on: "2026-10-01",
            note: "Cheque 004211",
            recorded_by: "admin-1",
            created_at: "2026-10-01T09:00:00Z",
            recorder: { full_name: "BSS Admin" },
          },
          {
            id: "pay-1",
            amount: 500,
            paid_on: "2026-09-20",
            note: null,
            recorded_by: null,
            created_at: "2026-09-20T09:00:00Z",
            // The recorder's profile is gone (ON DELETE SET NULL).
            recorder: null,
          },
        ],
      },
    ],
  };
  const DETAIL = {
    id: "p1",
    work_order_id: "wo1",
    current_stage: "material_dispatch",
    is_completed: false,
    cancellation: "refunded",
    cancelled_on: "2026-10-01",
    cancelled_by: "admin-1",
    cancellation_remarks: "Refunded in full",
    cancelled_by_profile: { full_name: "BSS Admin" },
    milestones: [],
    work_order: {
      id: "wo1",
      coordinator_id: RAVI,
      client_name: "Anand Kumar",
      plan_type: "solar",
      // Deliberately out of order: the database's order is sort_order.
      coordinators: [MEMBER_PARTNER, MEMBER_FIRST],
    },
  };

  it("reads each coordinator and the incentive the viewer may see, in the sale's order", async () => {
    response = { data: DETAIL, error: null };
    const project = await projectsRepository.byId("p1");

    expect(project?.coordinators).toEqual([
      {
        id: RAVI,
        full_name: "Ravi Kumar",
        sort_order: 1,
        incentive: {
          amount: 2000,
          paid_on: "2026-10-01",
          // Oldest first; amounts are numbers; the recorder is named when known.
          payments: [
            {
              id: "pay-1",
              amount: 500,
              paid_on: "2026-09-20",
              note: null,
              recorded_by: null,
              recorded_by_name: null,
            },
            {
              id: "pay-2",
              amount: 1500,
              paid_on: "2026-10-01",
              note: "Cheque 004211",
              recorded_by: "admin-1",
              recorded_by_name: "BSS Admin",
            },
          ],
          paid: 2000,
        },
      },
      {
        id: ABHIJITH,
        full_name: "Abhijith Nair",
        sort_order: 2,
        incentive: { amount: 3500, paid_on: null, payments: [], paid: 0 },
      },
    ]);
    expect(project?.cancelled_by_name).toBe("BSS Admin");
    // The work order is the order alone; the people live on the project.
    expect(project?.work_order).not.toHaveProperty("coordinators");
    expect(project?.work_order).toMatchObject({ client_name: "Anand Kumar", plan_type: "solar" });
  });

  it("a recorder embedded as a one-element array still names who recorded it", async () => {
    response = {
      data: {
        ...DETAIL,
        work_order: {
          ...DETAIL.work_order,
          coordinators: [
            {
              ...MEMBER_FIRST,
              incentive: {
                amount: 1000,
                paid_on: null,
                payments: [
                  {
                    id: "pay-1",
                    amount: "400.50",
                    paid_on: "2026-10-01",
                    note: null,
                    recorded_by: "admin-1",
                    created_at: "2026-10-01T09:00:00Z",
                    recorder: [{ full_name: "BSS Admin" }],
                  },
                ],
              },
            },
          ],
        },
      },
      error: null,
    };
    const project = await projectsRepository.byId("p1");
    expect(project?.coordinators[0].incentive?.payments[0]).toMatchObject({
      amount: 400.5,
      recorded_by_name: "BSS Admin",
    });
    // Σ instalments, to the paisa.
    expect(project?.coordinators[0].incentive?.paid).toBe(400.5);
  });

  it("a coordinator never sees a partner's incentive: RLS hides the row, and so do we", async () => {
    response = {
      data: {
        ...DETAIL,
        cancelled_by_profile: null,
        work_order: {
          ...DETAIL.work_order,
          coordinators: [
            MEMBER_FIRST,
            { ...MEMBER_PARTNER, incentive: null },
          ],
        },
      },
      error: null,
    };
    const project = await projectsRepository.byId("p1");
    const [own, partner] = project!.coordinators;
    // Their own instalments come with the row…
    expect(own.incentive).toMatchObject({ amount: 2000, paid: 2000 });
    expect(own.incentive?.payments).toHaveLength(2);
    // …and nothing of the partner's: no amount, no instalments.
    expect(partner.incentive).toBeNull();
    expect(JSON.stringify(partner)).not.toMatch(/3500|payments/);
    expect(project?.cancelled_by_name).toBeNull();
  });

  it("an unset incentive is an empty record, not a missing one", async () => {
    response = {
      data: {
        ...DETAIL,
        work_order: {
          ...DETAIL.work_order,
          coordinators: [
            { ...MEMBER_FIRST, incentive: { amount: null, paid_on: null, payments: [] } },
          ],
        },
      },
      error: null,
    };
    const project = await projectsRepository.byId("p1");
    expect(project?.coordinators[0].incentive).toEqual({
      amount: null,
      paid_on: null,
      payments: [],
      paid: 0,
    });
  });

  it("is null for a project that is not there", async () => {
    response = { data: null, error: null };
    expect(await projectsRepository.byId("gone")).toBeNull();
  });

  it("selects the sale's coordinators and incentives, never the legacy single-incentive columns", async () => {
    response = { data: null, error: null };
    await projectsRepository.byId("p1");
    const columns = String(lastQuery().calls[0][1]);

    expect(columns).toContain(
      "coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(",
    );
    expect(columns).toContain("profiles!work_order_coordinators_coordinator_id_fkey(id, full_name)");
    // The instalments hang off the incentive by the composite key — always named — and
    // the recorder by its own; a bare embed would be ambiguous.
    expect(columns).toContain("incentive:coordinator_incentives(amount, paid_on,");
    expect(columns).toContain(
      "payments:coordinator_incentive_payments!coordinator_incentive_payments_incentive_fkey(",
    );
    expect(columns).toContain(
      "recorder:profiles!coordinator_incentive_payments_recorded_by_fkey(full_name)",
    );
    expect(columns).toContain("cancelled_by_profile:profiles!projects_cancelled_by_fkey(full_name)");
    // projects.coordinator_id / coordinator_incentive / incentive_paid_on are deprecated.
    expect(columns).not.toContain("projects_coordinator_id_fkey");
    expect(columns).not.toMatch(/\bcoordinator_incentive\b/);
    expect(columns).not.toContain("incentive_paid_on");
    // …nor the deprecated projects.coordinator_id copy (the work order's own is fine).
    expect(columns.split("work_order:")[0]).not.toContain("coordinator_id");
  });
});

describe("projectsRepository.brief", () => {
  it("carries the order date, plan and every coordinator for the actions", async () => {
    response = {
      data: {
        id: "p1",
        work_order_id: "wo1",
        is_completed: false,
        completed_at: null,
        feasibility_date: "2026-09-20",
        cancellation: null,
        cancelled_on: null,
        cancellation_remarks: null,
        work_order: {
          client_name: "Anand Kumar",
          plan_type: "custom",
          order_date: "2026-08-01",
          coordinators: [
            {
              coordinator_id: RAVI,
              sort_order: 1,
              created_at: "2026-09-01T10:00:00Z",
              profile: { id: RAVI, full_name: "Ravi Kumar" },
              incentive: {
                amount: 1000,
                paid_on: null,
                payments: [
                  {
                    id: "pay-1",
                    amount: "250.00",
                    paid_on: "2026-10-01",
                    note: null,
                    recorded_by: "admin-1",
                    created_at: "2026-10-01T09:00:00Z",
                  },
                ],
              },
            },
          ],
        },
      },
      error: null,
    };
    expect(await projectsRepository.brief("p1")).toEqual({
      id: "p1",
      work_order_id: "wo1",
      is_completed: false,
      completed_at: null,
      feasibility_date: "2026-09-20",
      cancellation: null,
      cancelled_on: null,
      cancellation_remarks: null,
      client_name: "Anand Kumar",
      plan_type: "custom",
      order_date: "2026-08-01",
      coordinators: [
        {
          id: RAVI,
          full_name: "Ravi Kumar",
          sort_order: 1,
          // The brief carries the instalments (the actions plan against them), not who recorded them.
          incentive: {
            amount: 1000,
            paid_on: null,
            payments: [
              {
                id: "pay-1",
                amount: 250,
                paid_on: "2026-10-01",
                note: null,
                recorded_by: "admin-1",
                recorded_by_name: null,
              },
            ],
            paid: 250,
          },
        },
      ],
    });
  });

  it("asks for the instalments but not their recorders", async () => {
    response = { data: null, error: null };
    await projectsRepository.brief("p1");
    const columns = String(lastQuery().calls[0][1]);
    expect(columns).toContain(
      "payments:coordinator_incentive_payments!coordinator_incentive_payments_incentive_fkey(",
    );
    expect(columns).not.toContain("recorder:");
  });

  it("is null when the work order cannot be read (nothing can be decided without it)", async () => {
    response = { data: { id: "p1", work_order: null }, error: null };
    expect(await projectsRepository.brief("p1")).toBeNull();
  });
});

describe("projectsRepository writes", () => {
  const written = () => queries.find((q) => q.calls[0][0] === "update")!;

  it("setCoordinatorIncentive updates that person's row — the amount alone, never the derived paid date", async () => {
    response = { data: [{ coordinator_id: ABHIJITH }], error: null };
    const res = await projectsRepository.setCoordinatorIncentive("wo1", ABHIJITH, {
      amount: 3500,
    });
    expect(res).toEqual({ error: null });
    expect(written().table).toBe("coordinator_incentives");
    expect(written().calls[0]).toEqual(["update", { amount: 3500 }]);
    expect(JSON.stringify(written().calls[0])).not.toContain("paid_on");
    expect(written().calls).toContainEqual(["eq", "work_order_id", "wo1"]);
    expect(written().calls).toContainEqual(["eq", "coordinator_id", ABHIJITH]);
  });

  it("setCoordinatorIncentive does not claim a write that matched no row", async () => {
    response = { data: [], error: null };
    const res = await projectsRepository.setCoordinatorIncentive("wo1", ABHIJITH, {
      amount: 1,
    });
    expect(res.error).toMatch(/not saved/);
  });

  it("setCoordinatorIncentive words the database's refusal to go below what is paid", async () => {
    response = {
      data: null,
      error: { message: "The incentive cannot be less than the 4500.00 already paid" },
    };
    const res = await projectsRepository.setCoordinatorIncentive("wo1", ABHIJITH, { amount: 100 });
    expect(res.error).toBe(
      `The incentive cannot be less than the ${formatCurrency(4500)} already paid.`,
    );
  });

  describe("instalments", () => {
    const PAYMENT = { amount: 2360, paid_on: "2026-10-01", note: "Cheque 004211" };
    const sent = (op: string) => queries.find((q) => q.calls[0][0] === op)!;

    it("recordIncentivePayment inserts the five writable columns — who recorded it is the database's", async () => {
      response = { data: [{ id: "pay-1" }], error: null };
      const res = await projectsRepository.recordIncentivePayment("wo1", ABHIJITH, PAYMENT);
      expect(res).toEqual({ error: null });
      expect(sent("insert").table).toBe("coordinator_incentive_payments");
      expect(sent("insert").calls[0]).toEqual([
        "insert",
        { work_order_id: "wo1", coordinator_id: ABHIJITH, ...PAYMENT },
      ]);
      expect(JSON.stringify(sent("insert").calls[0])).not.toContain("recorded_by");
    });

    it.each([
      ["Set the incentive amount first", "Set the incentive amount first."],
      [
        "Instalments exceed the incentive",
        "That would take the payments above the agreed incentive — it may have changed meanwhile; reload to see what has been paid.",
      ],
    ])("recordIncentivePayment words the database's refusal %j", async (message, worded) => {
      response = { data: null, error: { message } };
      const res = await projectsRepository.recordIncentivePayment("wo1", ABHIJITH, PAYMENT);
      expect(res).toEqual({ error: worded });
    });

    it("recordIncentivePayment explains a person who has left the sale (no incentive row to pay against)", async () => {
      response = {
        data: null,
        error: { message: "violates foreign key constraint", code: "23503" },
      } as unknown as Response;
      const res = await projectsRepository.recordIncentivePayment("wo1", ABHIJITH, PAYMENT);
      expect(res.error).toBe("That person no longer has an incentive on this sale.");
    });

    it("recordIncentivePayment does not claim a write nothing stored", async () => {
      response = { data: [], error: null };
      const res = await projectsRepository.recordIncentivePayment("wo1", ABHIJITH, PAYMENT);
      expect(res.error).toMatch(/not saved/);
    });

    it("updateIncentivePayment changes amount, date and note of that one instalment", async () => {
      response = { data: [{ id: "pay-1" }], error: null };
      const res = await projectsRepository.updateIncentivePayment("pay-1", PAYMENT);
      expect(res).toEqual({ error: null });
      expect(written().table).toBe("coordinator_incentive_payments");
      expect(written().calls[0]).toEqual(["update", PAYMENT]);
      expect(written().calls).toContainEqual(["eq", "id", "pay-1"]);
    });

    it("updateIncentivePayment reports an instalment RLS filtered out or that is gone", async () => {
      response = { data: [], error: null };
      const res = await projectsRepository.updateIncentivePayment("pay-1", PAYMENT);
      expect(res.error).toBe("That payment was not found, or you cannot change it.");
    });

    it("deleteIncentivePayment removes that one instalment", async () => {
      response = { data: [{ id: "pay-1" }], error: null };
      const res = await projectsRepository.deleteIncentivePayment("pay-1");
      expect(res).toEqual({ error: null });
      expect(sent("delete").table).toBe("coordinator_incentive_payments");
      expect(sent("delete").calls).toContainEqual(["eq", "id", "pay-1"]);
    });

    it("deleteIncentivePayment reports a delete that removed nothing", async () => {
      response = { data: [], error: null };
      const res = await projectsRepository.deleteIncentivePayment("pay-1");
      expect(res.error).toBe("That payment was not found, or you cannot remove it.");
    });
  });

  it("setCancellation writes the status, date and remarks — never who recorded it", async () => {
    response = { data: [{ id: "p1" }], error: null };
    await projectsRepository.setCancellation("p1", {
      cancellation: "refunded",
      cancelled_on: "2026-10-01",
      cancellation_remarks: "Refunded in full",
    });
    expect(written().table).toBe("projects");
    expect(written().calls[0]).toEqual([
      "update",
      { cancellation: "refunded", cancelled_on: "2026-10-01", cancellation_remarks: "Refunded in full" },
    ]);
  });

  it("setCancellation reports a write RLS filtered out", async () => {
    response = { data: [], error: null };
    const res = await projectsRepository.setCancellation("p1", {
      cancellation: "cancelled",
      cancelled_on: null,
      cancellation_remarks: null,
    });
    expect(res.error).toBe("Project not found, or you cannot edit it.");
  });

  it("reinstate is ONE update: status and date cleared, remarks kept, no feasibility change", async () => {
    response = { data: [{ id: "p1" }], error: null };
    await projectsRepository.reinstate("p1", { remarks: "Refunded in full" });
    expect(queries.filter((q) => q.calls[0][0] === "update")).toHaveLength(1);
    expect(written().calls[0]).toEqual([
      "update",
      { cancellation: null, cancelled_on: null, cancellation_remarks: "Refunded in full" },
    ]);
  });

  it("reinstate puts a new feasibility date in that same update", async () => {
    response = { data: [{ id: "p1" }], error: null };
    await projectsRepository.reinstate("p1", { remarks: null, feasibility_date: "2026-10-05" });
    expect(queries.filter((q) => q.calls[0][0] === "update")).toHaveLength(1);
    expect(written().calls[0]).toEqual([
      "update",
      {
        cancellation: null,
        cancelled_on: null,
        cancellation_remarks: null,
        feasibility_date: "2026-10-05",
      },
    ]);
  });

  it("setFeasibilityDate writes the date alone", async () => {
    response = { data: [{ id: "p1" }], error: null };
    await projectsRepository.setFeasibilityDate("p1", null);
    expect(written().calls[0]).toEqual(["update", { feasibility_date: null }]);
  });
});

describe("projectsRepository.options", () => {
  it("says which projects were cancelled or refunded, so a picker can", async () => {
    response = {
      data: [
        { id: "p1", cancellation: null, work_order: { client_name: "A", plant_capacity: "3kW" } },
        { id: "p2", cancellation: "refunded", work_order: { client_name: "B", plant_capacity: "Inverter + panel" } },
      ],
      error: null,
    };
    expect(await projectsRepository.options()).toEqual([
      { id: "p1", client_name: "A", plant_capacity: "3kW", cancellation: null },
      { id: "p2", client_name: "B", plant_capacity: "Inverter + panel", cancellation: "refunded" },
    ]);
  });
});

describe("projectsRepository.incentiveSummary", () => {
  it("reads agreed, paid and pending as numbers (the RPC returns numerics as strings)", async () => {
    response = {
      data: { projects: "3", pending_projects: 2, total: "90000.00", paid: "50000.50", pending: "39999.50" },
      error: null,
    };
    expect(await projectsRepository.incentiveSummary()).toEqual({
      projects: 3,
      pendingProjects: 2,
      total: 90000,
      paid: 50000.5,
      pending: 39999.5,
    });
    expect(lastQuery().table).toBe("rpc:incentive_summary");
    // No scope: the caller's own (a coordinator) or everyone's (the office).
    expect(lastQuery().calls[0]).toEqual(["rpc", {}]);
  });

  it("narrows the office to one coordinator", async () => {
    response = { data: null, error: null };
    await projectsRepository.incentiveSummary(ABHIJITH);
    expect(lastQuery().calls[0]).toEqual(["rpc", { p_coordinator: ABHIJITH }]);
  });

  it("is zero for nobody with an incentive, and null — hidden — when it cannot be read", async () => {
    response = { data: null, error: null };
    expect(await projectsRepository.incentiveSummary()).toEqual({
      projects: 0,
      pendingProjects: 0,
      total: 0,
      paid: 0,
      pending: 0,
    });
    response = { data: null, error: { message: "boom" } };
    expect(await projectsRepository.incentiveSummary()).toBeNull();
  });
});
