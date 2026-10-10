import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import webpush from "web-push";
import { describe as describeEvent, type NotificationEvent } from "@/lib/domain/notifications";
import type { PushConfig } from "./config";
import type { PushSender, StoredSubscription } from "./push";
import type { NewNotification, NotificationStore } from "./store";

// deliver() must never reach for the service-role client when a store is
// injected; the mock lets the default-wiring tests hand back a fake instead.
vi.mock("./store", () => ({
  serviceRoleStore: vi.fn(() => {
    throw new Error("serviceRoleStore() must not be called in this test");
  }),
}));

import { deliver } from "./deliver";
import { serviceRoleStore } from "./store";

const PUSH: PushConfig = {
  publicKey: "public-key",
  privateKey: "private-key",
  subject: "mailto:ops@bss.example",
};

const OFFICE = ["admin-1", "admin-2", "super-1"];

function sub(userId: string, n = 1): StoredSubscription {
  return {
    id: `sub-${userId}-${n}`,
    endpoint: `https://push.example/${userId}/${n}`,
    p256dh: "p256dh",
    auth: "auth",
  };
}

/**
 * In-memory NotificationStore. `existing` holds "recipient|dedupe_key" pairs
 * already in the inbox, emulating ON CONFLICT DO NOTHING (NULL keys never
 * conflict).
 */
function fakeStore(
  opts: {
    officeIds?: string[];
    existing?: string[];
    subscriptions?: Record<string, StoredSubscription[]>;
  } = {},
) {
  const existing = new Set(opts.existing ?? []);
  const written: NewNotification[] = [];
  const store = {
    officeIds: vi.fn<NotificationStore["officeIds"]>(async () => opts.officeIds ?? OFFICE),
    insert: vi.fn<NotificationStore["insert"]>(async (rows) => {
      const fresh = rows.filter(
        (r) => r.dedupe_key === null || !existing.has(`${r.recipient_id}|${r.dedupe_key}`),
      );
      written.push(...fresh);
      return fresh.map((r) => r.recipient_id);
    }),
    subscriptionsFor: vi.fn<NotificationStore["subscriptionsFor"]>(async (ids) =>
      ids.flatMap((id) => opts.subscriptions?.[id] ?? []),
    ),
    removeSubscriptions: vi.fn<NotificationStore["removeSubscriptions"]>(async () => {}),
  } satisfies NotificationStore;
  return { store, written };
}

type EventOf<T extends NotificationEvent["type"]> = Extract<NotificationEvent, { type: T }>;

const okSender = () => vi.fn<PushSender>().mockResolvedValue({ statusCode: 201 });

const approved: EventOf<"work_order.approved"> = {
  type: "work_order.approved",
  actorId: "admin-1",
  coordinatorId: "coord-1",
  workOrderId: "wo-1",
  projectId: "pr-1",
  clientName: "Anil Kumar",
};

const submitted: EventOf<"work_order.submitted"> = {
  type: "work_order.submitted",
  actorId: "coord-1",
  actorName: "Rahul",
  workOrderId: "wo-1",
  clientName: "Anil Kumar",
  capacity: "3kW",
};

const expiring: EventOf<"feasibility.expiring"> = {
  type: "feasibility.expiring",
  actorId: null,
  coordinatorId: "coord-1",
  projectId: "pr-1",
  clientName: "Anil Kumar",
  daysLeft: 7,
  validUntil: "2026-01-31",
  period: 1,
  threshold: 7,
};

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  vi.unstubAllEnvs();
});

describe("deliver — recipients and rows", () => {
  it("writes one row for a single-user audience without looking up the office", async () => {
    const { store, written } = fakeStore();
    const report = await deliver(approved, { store, push: null });

    expect(store.officeIds).not.toHaveBeenCalled();
    const message = describeEvent(approved);
    expect(written).toEqual([
      {
        recipient_id: "coord-1",
        type: "work_order.approved",
        title: message.title,
        body: message.body,
        link: message.link,
        dedupe_key: null,
      },
    ]);
    expect(report).toEqual({
      type: "work_order.approved",
      recipients: 1,
      inserted: 1,
      pushed: 0,
      failedPushes: 0,
      prunedSubscriptions: 0,
    });
  });

  it("fans an office event out to every admin and the SuperAdmin", async () => {
    const { store, written } = fakeStore();
    const report = await deliver(submitted, { store, push: null });

    expect(store.officeIds).toHaveBeenCalledTimes(1);
    expect(written.map((r) => r.recipient_id).sort()).toEqual([...OFFICE].sort());
    expect(new Set(written.map((r) => r.title)).size).toBe(1);
    expect(report).toMatchObject({ recipients: 3, inserted: 3 });
  });

  it("never notifies the actor, even when the actor is office staff", async () => {
    const { store, written } = fakeStore();
    await deliver(
      {
        type: "ticket.status_changed",
        actorId: "admin-2",
        actorName: "Office",
        ticketId: "t-1",
        ticketNo: "ST-1",
        status: "completed",
        clientName: null,
      },
      { store, push: null },
    );
    expect(written.map((r) => r.recipient_id).sort()).toEqual(["admin-1", "super-1"]);
  });

  it("merges the coordinator with the office without duplicating a coordinator who is office staff", async () => {
    const { store, written } = fakeStore();
    await deliver({ ...expiring, coordinatorId: "admin-1" }, { store, push: null });
    expect(written.map((r) => r.recipient_id).sort()).toEqual([...OFFICE].sort());
  });

  it("writes nothing when the only recipient is the actor", async () => {
    const { store } = fakeStore();
    const report = await deliver({ ...approved, actorId: "coord-1" }, { store, push: PUSH, send: okSender() });
    expect(store.insert).not.toHaveBeenCalled();
    expect(store.subscriptionsFor).not.toHaveBeenCalled();
    expect(report).toEqual({
      type: "work_order.approved",
      recipients: 0,
      inserted: 0,
      pushed: 0,
      failedPushes: 0,
      prunedSubscriptions: 0,
    });
  });

  it("writes nothing for an office event when there is no office", async () => {
    const { store } = fakeStore({ officeIds: [] });
    const report = await deliver(submitted, { store, push: null });
    expect(store.insert).not.toHaveBeenCalled();
    expect(report.recipients).toBe(0);
  });

  it("carries the feasibility dedupe key on every row", async () => {
    const { store, written } = fakeStore();
    await deliver(expiring, { store, push: null });
    expect(written).toHaveLength(4);
    for (const row of written) expect(row.dedupe_key).toBe("feasibility.expiring:pr-1:2026-01-31:d7");
  });

  it("propagates storage failures (notify() is the layer that swallows)", async () => {
    const officeDown = fakeStore();
    officeDown.store.officeIds.mockRejectedValue(new Error("office lookup failed"));
    await expect(deliver(submitted, { store: officeDown.store, push: null })).rejects.toThrow(
      "office lookup failed",
    );

    const insertDown = fakeStore();
    insertDown.store.insert.mockRejectedValue(new Error("notification insert failed"));
    const send = okSender();
    await expect(
      deliver(approved, { store: insertDown.store, push: PUSH, send }),
    ).rejects.toThrow("notification insert failed");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("deliver — push", () => {
  it("pushes to every device of every newly notified recipient", async () => {
    const { store } = fakeStore({
      subscriptions: { "coord-1": [sub("coord-1", 1), sub("coord-1", 2)] },
    });
    const send = okSender();
    const report = await deliver(approved, { store, push: PUSH, send });

    expect(store.subscriptionsFor).toHaveBeenCalledWith(["coord-1"]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ inserted: 1, pushed: 2, failedPushes: 0, prunedSubscriptions: 0 });
  });

  it("sends the message's title, body, in-app link and dedupe tag", async () => {
    const { store } = fakeStore({ subscriptions: { "coord-1": [sub("coord-1")] } });
    const send = okSender();
    await deliver(expiring, { store, push: PUSH, send });

    const message = describeEvent(expiring);
    expect(JSON.parse(send.mock.calls[0][1])).toEqual({
      title: message.title,
      body: message.body,
      url: "/projects/pr-1",
      tag: "feasibility.expiring:pr-1:2026-01-31:d7",
    });
    expect(send.mock.calls[0][2].vapidDetails).toEqual({
      subject: PUSH.subject,
      publicKey: PUSH.publicKey,
      privateKey: PUSH.privateKey,
    });
  });

  it("does not tag one-off notifications (each one shows on the device)", async () => {
    const { store } = fakeStore({ subscriptions: { "coord-1": [sub("coord-1")] } });
    const send = okSender();
    await deliver(approved, { store, push: PUSH, send });
    expect(JSON.parse(send.mock.calls[0][1])).not.toHaveProperty("tag");
  });

  it("does not re-buzz recipients whose alert was already in the inbox", async () => {
    const { store, written } = fakeStore({
      existing: ["admin-1|feasibility.expiring:pr-1:2026-01-31:d7", "coord-1|feasibility.expiring:pr-1:2026-01-31:d7"],
      subscriptions: {
        "admin-1": [sub("admin-1")],
        "admin-2": [sub("admin-2")],
        "super-1": [sub("super-1")],
        "coord-1": [sub("coord-1")],
      },
    });
    const send = okSender();
    const report = await deliver(expiring, { store, push: PUSH, send });

    expect(written.map((r) => r.recipient_id).sort()).toEqual(["admin-2", "super-1"]);
    expect([...store.subscriptionsFor.mock.calls[0][0]].sort()).toEqual(["admin-2", "super-1"]);
    expect(send.mock.calls.map(([s]) => s.endpoint).sort()).toEqual([
      "https://push.example/admin-2/1",
      "https://push.example/super-1/1",
    ]);
    expect(report).toMatchObject({ recipients: 4, inserted: 2, pushed: 2 });
  });

  it("skips push entirely when every row was a duplicate", async () => {
    const { store } = fakeStore({
      existing: [...OFFICE, "coord-1"].map((id) => `${id}|feasibility.expiring:pr-1:2026-01-31:d7`),
    });
    const send = okSender();
    const report = await deliver(expiring, { store, push: PUSH, send });
    expect(store.subscriptionsFor).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(report).toMatchObject({ recipients: 4, inserted: 0, pushed: 0 });
  });

  it("keeps in-app-only types off the devices", async () => {
    const { store } = fakeStore({ subscriptions: { "admin-1": [sub("admin-1")] } });
    const send = okSender();
    const report = await deliver(
      { type: "work_order.updated", actorId: "coord-1", actorName: "Rahul", workOrderId: "wo-1", clientName: "Anil" },
      { store, push: PUSH, send },
    );
    expect(report.inserted).toBe(3);
    expect(store.subscriptionsFor).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips push when it is not configured", async () => {
    const { store } = fakeStore({ subscriptions: { "coord-1": [sub("coord-1")] } });
    const send = okSender();
    const report = await deliver(approved, { store, push: null, send });
    expect(report.inserted).toBe(1);
    expect(store.subscriptionsFor).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("handles a recipient with no devices", async () => {
    const { store } = fakeStore();
    const send = okSender();
    const report = await deliver(approved, { store, push: PUSH, send });
    expect(send).not.toHaveBeenCalled();
    expect(store.removeSubscriptions).not.toHaveBeenCalled();
    expect(report).toMatchObject({ inserted: 1, pushed: 0, failedPushes: 0, prunedSubscriptions: 0 });
  });

  it("prunes subscriptions the push service reports gone, and counts failures", async () => {
    const devices = [sub("coord-1", 1), sub("coord-1", 2), sub("coord-1", 3)];
    const { store } = fakeStore({ subscriptions: { "coord-1": devices } });
    const send = vi.fn<PushSender>(async (s) => {
      if (s.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint.endsWith("/3")) throw Object.assign(new Error("busy"), { statusCode: 503 });
      return { statusCode: 201 };
    });
    const report = await deliver(approved, { store, push: PUSH, send });

    expect(store.removeSubscriptions).toHaveBeenCalledWith(["sub-coord-1-2"]);
    expect(report).toMatchObject({ pushed: 1, failedPushes: 1, prunedSubscriptions: 1 });
  });
});

describe("deliver — default wiring", () => {
  it("uses the service-role store when none is injected", async () => {
    const { store, written } = fakeStore();
    vi.mocked(serviceRoleStore).mockReturnValueOnce(store);
    await deliver(approved, { push: null });
    expect(serviceRoleStore).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
  });

  it("reads the VAPID config from the environment when push is not injected", async () => {
    const keys = webpush.generateVAPIDKeys();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", keys.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:env@bss.example");
    const { store } = fakeStore({ subscriptions: { "coord-1": [sub("coord-1")] } });
    const send = okSender();

    await deliver(approved, { store, send });
    expect(send.mock.calls[0][2].vapidDetails).toEqual({
      subject: "mailto:env@bss.example",
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    });
  });

  it("treats an explicit `push: undefined` as push disabled, whatever the environment says", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
    const { store } = fakeStore({ subscriptions: { "coord-1": [sub("coord-1")] } });
    const send = okSender();
    await deliver(approved, { store, push: undefined, send });
    expect(send).not.toHaveBeenCalled();
  });

  it("is in-app only when the environment has no VAPID keys", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const { store } = fakeStore({ subscriptions: { "coord-1": [sub("coord-1")] } });
    const send = okSender();
    const report = await deliver(approved, { store, send });
    expect(report.inserted).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
});
