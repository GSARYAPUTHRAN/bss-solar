import { describe, it, expect, vi } from "vitest";
import {
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
    coordinatorId: "c1",
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
