import { beforeEach, describe, it, expect, vi } from "vitest";

// The loader's query chain, recorded: each call (select/eq/is/…) is kept and the
// chain resolves with whatever `pages` hands out next.
const db = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  pages: [] as { data: unknown; error: { message: string } | null }[],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      db.calls.push(["from", table]);
      const chain: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (resolve: (r: unknown) => unknown) =>
                resolve(db.pages.shift() ?? { data: [], error: null });
            }
            return (...args: unknown[]) => {
              db.calls.push([String(prop), ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  }),
}));

import {
  loadActiveFeasibilityProjects,
  runFeasibilityAlerts,
  withCachedOfficeIds,
  type FeasibilityProject,
} from "./feasibility";
import type { DeliveryReport } from "@/server/notifications/deliver";
import type { NotificationEvent } from "@/lib/domain/notifications";
import type { NotificationStore } from "@/server/notifications/store";

const TODAY = "2026-10-10";

function project(over: Partial<FeasibilityProject> = {}): FeasibilityProject {
  return {
    projectId: "p1",
    coordinatorIds: ["c1"],
    clientName: "Anand Kumar",
    feasibilityDate: TODAY,
    completedAt: null,
    isCompleted: false,
    ...over,
  };
}

function delivered(event: NotificationEvent, over: Partial<DeliveryReport> = {}): DeliveryReport {
  return {
    type: event.type,
    recipients: 2,
    inserted: 2,
    pushed: 1,
    failedPushes: 0,
    prunedSubscriptions: 0,
    ...over,
  };
}

describe("runFeasibilityAlerts", () => {
  it("delivers what each project's clock warrants and totals the results", async () => {
    const deliver = vi.fn(async (e: NotificationEvent) => delivered(e));
    const report = await runFeasibilityAlerts({
      today: TODAY,
      loadProjects: async () => [
        // Day 25 of 30: expiring (7-day threshold).
        project({ projectId: "expiring", feasibilityDate: "2026-09-15" }),
        // Day 32: renewed yesterday and not yet expiring.
        project({ projectId: "extended", feasibilityDate: "2026-09-08" }),
        // Day 40: renewed 9 days ago (e.g. an imported legacy project) — old news.
        project({ projectId: "renewed-earlier", feasibilityDate: "2026-08-31" }),
        // Started today: nothing to say.
        project({ projectId: "fresh" }),
      ],
      deliver,
    });

    const types = deliver.mock.calls.map(([e]) => `${e.type}:${"projectId" in e ? e.projectId : ""}`);
    expect(types.sort()).toEqual([
      "feasibility.expiring:expiring",
      "feasibility.extended:extended",
    ]);
    expect(report).toEqual({
      date: TODAY,
      projectsScanned: 4,
      events: 2,
      delivered: 2,
      failed: 0,
      inserted: 4,
      pushed: 2,
      failedPushes: 0,
      prunedSubscriptions: 0,
    });
  });

  it("is a system event — no actor to exclude", async () => {
    const deliver = vi.fn(async (e: NotificationEvent) => delivered(e));
    await runFeasibilityAlerts({
      today: TODAY,
      loadProjects: async () => [project({ feasibilityDate: "2026-09-15" })],
      deliver,
    });
    expect(deliver.mock.calls[0][0].actorId).toBeNull();
  });

  it("keeps going when one delivery throws", async () => {
    const deliver = vi.fn(async (e: NotificationEvent) => {
      if ("projectId" in e && e.projectId === "bad") throw new Error("db down");
      return delivered(e);
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await runFeasibilityAlerts({
      today: TODAY,
      loadProjects: async () => [
        project({ projectId: "bad", feasibilityDate: "2026-09-15" }),
        project({ projectId: "good", feasibilityDate: "2026-09-15" }),
      ],
      deliver,
    });
    expect(report).toMatchObject({ events: 2, delivered: 1, failed: 1, inserted: 2 });
    error.mockRestore();
  });

  it("skips a project with a malformed date instead of aborting the run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deliver = vi.fn(async (e: NotificationEvent) => delivered(e));
    const report = await runFeasibilityAlerts({
      today: TODAY,
      loadProjects: async () => [
        project({ projectId: "broken", feasibilityDate: "15/09/2026" }),
        project({ projectId: "ok", feasibilityDate: "2026-09-15" }),
      ],
      deliver,
    });
    expect(report).toMatchObject({ projectsScanned: 2, events: 1, delivered: 1 });
    error.mockRestore();
  });

  it("never runs more deliveries at once than the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const deliver = vi.fn(async (e: NotificationEvent) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return delivered(e);
    });
    const report = await runFeasibilityAlerts({
      today: TODAY,
      loadProjects: async () =>
        Array.from({ length: 9 }, (_, i) =>
          project({ projectId: `p${i}`, feasibilityDate: "2026-09-15" }),
        ),
      deliver,
      concurrency: 3,
    });
    expect(report.delivered).toBe(9);
    expect(peak).toBe(3);
  });

  it("handles a day with nothing to send", async () => {
    const deliver = vi.fn();
    const report = await runFeasibilityAlerts({
      today: TODAY,
      loadProjects: async () => [],
      deliver,
    });
    expect(report).toMatchObject({ projectsScanned: 0, events: 0, delivered: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("lets a failure to load projects fail the run", async () => {
    await expect(
      runFeasibilityAlerts({
        today: TODAY,
        loadProjects: async () => {
          throw new Error("no service role");
        },
        deliver: vi.fn(),
      }),
    ).rejects.toThrow("no service role");
  });
});

describe("runFeasibilityAlerts — shared and cancelled sales", () => {
  it("alerts every coordinator of a shared sale, not only the first", async () => {
    const deliver = vi.fn(async (e: NotificationEvent) => delivered(e));
    await runFeasibilityAlerts({
      today: TODAY,
      loadProjects: async () => [
        project({ coordinatorIds: ["c1", "c2", "c3"], feasibilityDate: "2026-09-15" }),
      ],
      deliver,
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toMatchObject({
      type: "feasibility.expiring",
      coordinatorIds: ["c1", "c2", "c3"],
    });
  });

  it.each(["cancelled", "refunded"] as const)(
    "says nothing about a %s project even when its date is about to lapse",
    async (cancellation) => {
      const deliver = vi.fn(async (e: NotificationEvent) => delivered(e));
      const report = await runFeasibilityAlerts({
        today: TODAY,
        loadProjects: async () => [
          project({ feasibilityDate: "2026-09-15", cancellation }),
        ],
        deliver,
      });
      expect(deliver).not.toHaveBeenCalled();
      expect(report).toMatchObject({ projectsScanned: 1, events: 0 });
    },
  );
});

describe("loadActiveFeasibilityProjects", () => {
  const MEMBER = (coordinator_id: string, sort_order: number) => ({ coordinator_id, sort_order });

  beforeEach(() => {
    db.calls = [];
    db.pages = [];
  });

  it("hands each project every coordinator of its sale, in the sale's order", async () => {
    db.pages = [
      {
        data: [
          {
            id: "p1",
            feasibility_date: "2026-09-15",
            completed_at: null,
            is_completed: false,
            cancellation: null,
            work_order: {
              client_name: "Anand Kumar",
              // The embed's order is not the sale's order.
              coordinators: [MEMBER("c2", 2), MEMBER("c3", 3), MEMBER("c1", 1)],
            },
          },
        ],
        error: null,
      },
    ];
    expect(await loadActiveFeasibilityProjects()).toEqual([
      {
        projectId: "p1",
        coordinatorIds: ["c1", "c2", "c3"],
        clientName: "Anand Kumar",
        feasibilityDate: "2026-09-15",
        completedAt: null,
        isCompleted: false,
        cancellation: null,
      },
    ]);
  });

  it("reads only live, uncommissioned projects with a clock — cancelled and refunded ones are out", async () => {
    await loadActiveFeasibilityProjects();
    expect(db.calls).toContainEqual(["eq", "is_completed", false]);
    expect(db.calls).toContainEqual(["is", "cancellation", null]);
    expect(db.calls).toContainEqual(["not", "feasibility_date", "is", null]);

    const columns = String(db.calls.find(([name]) => name === "select")?.[1]);
    expect(columns).toContain(
      "coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(coordinator_id, sort_order)",
    );
    // The deprecated projects.coordinator_id copy is not what the alerts go to.
    expect(columns.split("work_order:")[0]).not.toContain("coordinator_id");
  });

  it("copes with a project whose work order cannot be read", async () => {
    db.pages = [
      {
        data: [
          {
            id: "p1",
            feasibility_date: "2026-09-15",
            completed_at: null,
            is_completed: false,
            cancellation: null,
            work_order: null,
          },
        ],
        error: null,
      },
    ];
    expect(await loadActiveFeasibilityProjects()).toMatchObject([
      { projectId: "p1", coordinatorIds: [], clientName: "A project" },
    ]);
  });

  it("pages through a long list", async () => {
    const row = (i: number) => ({
      id: `p${i}`,
      feasibility_date: "2026-09-15",
      completed_at: null,
      is_completed: false,
      cancellation: null,
      work_order: { client_name: "X", coordinators: [MEMBER("c1", 1)] },
    });
    db.pages = [
      { data: Array.from({ length: 1000 }, (_, i) => row(i)), error: null },
      { data: [row(1000)], error: null },
    ];
    expect(await loadActiveFeasibilityProjects()).toHaveLength(1001);
    expect(db.calls.filter(([name]) => name === "range")).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
    ]);
  });

  it("fails the run when the lookup fails (no alerts is not the same as no projects)", async () => {
    db.pages = [{ data: null, error: { message: "permission denied" } }];
    await expect(loadActiveFeasibilityProjects()).rejects.toThrow(
      "feasibility project lookup failed: permission denied",
    );
  });
});

describe("withCachedOfficeIds", () => {
  function store(officeIds: NotificationStore["officeIds"]): NotificationStore {
    return {
      officeIds,
      insert: vi.fn(async () => []),
      subscriptionsFor: vi.fn(async () => []),
      removeSubscriptions: vi.fn(async () => {}),
    };
  }

  it("looks the office up once per run", async () => {
    const lookup = vi.fn(async () => ["a1", "s1"]);
    const cached = withCachedOfficeIds(store(lookup));
    expect(await cached.officeIds()).toEqual(["a1", "s1"]);
    expect(await cached.officeIds()).toEqual(["a1", "s1"]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed lookup", async () => {
    const lookup = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(["a1"]);
    const cached = withCachedOfficeIds(store(lookup));
    await expect(cached.officeIds()).rejects.toThrow("blip");
    expect(await cached.officeIds()).toEqual(["a1"]);
  });

  it("passes every other store call straight through", async () => {
    const base = store(async () => []);
    const cached = withCachedOfficeIds(base);
    await cached.insert([]);
    expect(base.insert).toHaveBeenCalled();
  });
});
