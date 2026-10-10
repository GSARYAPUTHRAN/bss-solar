import { describe, it, expect, vi, beforeEach } from "vitest";

// The service-role client, replaced by a recorder: these tests pin the exact
// requests the store makes (tests/integration/notifications.test.ts runs it
// against a real database).
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));

import { serviceRoleStore, type NewNotification } from "./store";

type Result = { data: unknown; error: { message: string } | null };

/** A PostgREST query builder that records each call and resolves to `result`. */
function recordedQuery(result: Result) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of ["select", "in", "order", "limit", "delete"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}

const ok = (data: unknown): Result => ({ data, error: null });

function row(recipient: string, dedupeKey: string | null): NewNotification {
  return {
    recipient_id: recipient,
    type: "feasibility.expiring",
    title: "Feasibility expires in 7 days",
    body: "Anil Kumar",
    link: "/projects/pr-1",
    dedupe_key: dedupeKey,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("insert", () => {
  it("writes through insert_notifications and returns the recipients actually written", async () => {
    db.rpc.mockResolvedValue(ok([{ id: "n-2", recipient_id: "admin-2" }]));
    const rows = [row("admin-1", "feasibility.expiring:pr-1:d7"), row("admin-2", null)];

    expect(await serviceRoleStore().insert(rows)).toEqual(["admin-2"]);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("insert_notifications", { p_rows: rows });
  });

  it("sends only the notification's own fields", async () => {
    db.rpc.mockResolvedValue(ok([]));
    const extra = { ...row("admin-1", null), read_at: "2026-01-01" } as NewNotification;

    await serviceRoleStore().insert([extra]);
    expect(db.rpc.mock.calls[0][1]).toEqual({ p_rows: [row("admin-1", null)] });
  });

  it("makes no call for no rows", async () => {
    expect(await serviceRoleStore().insert([])).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("throws on a storage error", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(serviceRoleStore().insert([row("admin-1", null)])).rejects.toThrow(
      "notification insert failed: boom",
    );
  });
});

describe("subscriptionsFor", () => {
  it("asks for at most 100 users at a time, each capped at their 10 newest devices", async () => {
    // 1000 rows is PostgREST's max_rows: 100 users × 10 devices always fits.
    const users = Array.from({ length: 250 }, (_, i) => `user-${i}`);
    const lookups = [0, 1, 2].map((n) =>
      recordedQuery(ok([{ id: `sub-${n}`, endpoint: `https://fcm.googleapis.com/${n}`, p256dh: "k", auth: "a" }])),
    );
    let next = 0;
    db.from.mockImplementation(() => lookups[next++].builder);

    const subscriptions = await serviceRoleStore().subscriptionsFor(users);

    expect(subscriptions.map((s) => s.id)).toEqual(["sub-0", "sub-1", "sub-2"]);
    expect(db.from).toHaveBeenCalledTimes(3);
    expect(db.from).toHaveBeenCalledWith("push_subscriptions");
    lookups.forEach(({ calls }, n) => {
      const chunk = users.slice(n * 100, n * 100 + 100);
      expect(calls).toEqual([
        ["select", "id, endpoint, p256dh, auth"],
        ["in", "user_id", chunk],
        ["order", "user_id"],
        ["order", "last_seen_at", { ascending: false }],
        ["order", "id"],
        ["limit", chunk.length * 10],
      ]);
    });
  });

  it("makes no call for no users", async () => {
    expect(await serviceRoleStore().subscriptionsFor([])).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("throws on a storage error", async () => {
    db.from.mockReturnValue(recordedQuery({ data: null, error: { message: "boom" } }).builder);
    await expect(serviceRoleStore().subscriptionsFor(["user-1"])).rejects.toThrow(
      "subscription lookup failed: boom",
    );
  });
});
