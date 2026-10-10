import { describe, it, expect, vi } from "vitest";

// The real server actions need a request scope; these tests inject fakes.
vi.mock("@/app/(app)/notifications/actions", () => ({
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
}));

import {
  disablePush,
  enablePush,
  forgetThisDevice,
  readPushState,
  reconcilePush,
  type PushPlatform,
  type PushServer,
} from "./push-device";
import type { PushEnvironment } from "./push-client";

const KEY = Buffer.from([4, 1, 2, 3]).toString("base64url");
const OTHER_KEY = Buffer.from([4, 9, 9, 9]).toString("base64url");

const capable: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIOS: false,
  isStandalone: false,
};

function fakeSubscription(endpoint = "https://push.example/1", key = KEY) {
  return {
    endpoint,
    options: {
      // Copy into an exact-size ArrayBuffer (Node Buffers share a pooled one).
      applicationServerKey: new Uint8Array(Buffer.from(key, "base64url")).buffer,
      userVisibleOnly: true,
    },
    toJSON: () => ({ endpoint, keys: { p256dh: "pk", auth: "au" } }),
    unsubscribe: vi.fn(async () => true),
  } as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };
}

function platform(over: Partial<PushPlatform> = {}): PushPlatform {
  return {
    environment: () => capable,
    permission: () => "granted",
    requestPermission: async () => "granted",
    getSubscription: async () => null,
    subscribe: async () => fakeSubscription(),
    userAgent: () => "UA",
    ...over,
  };
}

function server(over: Partial<PushServer> = {}) {
  return {
    save: vi.fn<PushServer["save"]>(async () => ({ ok: true as const, data: undefined })),
    remove: vi.fn<PushServer["remove"]>(async () => ({ ok: true as const, data: undefined })),
    ...over,
  };
}

describe("readPushState", () => {
  it("is unconfigured without a VAPID key", async () => {
    expect(await readPushState(null, platform())).toBe("unconfigured");
  });
  it("explains iOS install and unsupported browsers", async () => {
    expect(
      await readPushState(KEY, platform({ environment: () => ({ ...capable, isIOS: true }) })),
    ).toBe("ios-install");
    expect(
      await readPushState(
        KEY,
        platform({ environment: () => ({ ...capable, hasPushManager: false }) }),
      ),
    ).toBe("unsupported");
  });
  it("reports denied permission", async () => {
    expect(await readPushState(KEY, platform({ permission: () => "denied" }))).toBe("denied");
  });
  it("is on only with permission and a subscription", async () => {
    expect(await readPushState(KEY, platform())).toBe("off");
    expect(await readPushState(KEY, platform({ permission: () => "default" }))).toBe("off");
    expect(
      await readPushState(KEY, platform({ getSubscription: async () => fakeSubscription() })),
    ).toBe("on");
  });
});

describe("enablePush", () => {
  it("subscribes and records the device", async () => {
    const srv = server();
    expect(await enablePush(KEY, platform(), srv)).toEqual({ state: "on" });
    expect(srv.save).toHaveBeenCalledWith({
      endpoint: "https://push.example/1",
      p256dh: "pk",
      auth: "au",
      userAgent: "UA",
    });
  });
  it("stops at a denied or dismissed permission prompt", async () => {
    const srv = server();
    expect(
      await enablePush(KEY, platform({ requestPermission: async () => "denied" }), srv),
    ).toEqual({ state: "denied" });
    const dismissed = await enablePush(
      KEY,
      platform({ requestPermission: async () => "default" }),
      srv,
    );
    expect(dismissed.state).toBe("off");
    expect(dismissed.error).toMatch(/not allowed/i);
    expect(srv.save).not.toHaveBeenCalled();
  });
  it("reports a browser subscribe failure in plain language", async () => {
    const outcome = await enablePush(
      KEY,
      platform({
        subscribe: async () => {
          throw new Error("AbortError");
        },
      }),
      server(),
    );
    expect(outcome.state).toBe("off");
    expect(outcome.error).toMatch(/could not set up/i);
  });
  it("undoes the browser subscription when the server refuses it", async () => {
    const sub = fakeSubscription();
    const outcome = await enablePush(
      KEY,
      platform({ subscribe: async () => sub }),
      server({ save: async () => ({ ok: false, error: "Nope" }) }),
    );
    expect(outcome).toEqual({ state: "off", error: "Nope" });
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});

describe("disablePush", () => {
  it("removes the server record, then the browser subscription", async () => {
    const sub = fakeSubscription();
    const srv = server();
    expect(await disablePush(platform({ getSubscription: async () => sub }), srv)).toEqual({
      state: "off",
    });
    expect(srv.remove).toHaveBeenCalledWith("https://push.example/1");
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
  it("stays on when the server cannot forget the device", async () => {
    const sub = fakeSubscription();
    const outcome = await disablePush(
      platform({ getSubscription: async () => sub }),
      server({ remove: async () => ({ ok: false, error: "Try again" }) }),
    );
    expect(outcome).toEqual({ state: "on", error: "Try again" });
    expect(sub.unsubscribe).not.toHaveBeenCalled();
  });
  it("is a no-op without a subscription", async () => {
    const srv = server();
    expect(await disablePush(platform(), srv)).toEqual({ state: "off" });
    expect(srv.remove).not.toHaveBeenCalled();
  });
});

describe("reconcilePush", () => {
  it("re-assigns an existing subscription to the signed-in user", async () => {
    const srv = server();
    await reconcilePush(KEY, platform({ getSubscription: async () => fakeSubscription() }), srv);
    expect(srv.save).toHaveBeenCalledTimes(1);
    expect(srv.remove).not.toHaveBeenCalled();
  });
  it("drops the subscription when permission was revoked", async () => {
    const sub = fakeSubscription();
    const srv = server();
    await reconcilePush(
      KEY,
      platform({ getSubscription: async () => sub, permission: () => "denied" }),
      srv,
    );
    expect(srv.remove).toHaveBeenCalledWith(sub.endpoint);
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(srv.save).not.toHaveBeenCalled();
  });
  it("re-subscribes under a rotated VAPID key", async () => {
    const stale = fakeSubscription("https://push.example/old", OTHER_KEY);
    const fresh = fakeSubscription("https://push.example/new");
    const srv = server();
    await reconcilePush(
      KEY,
      platform({ getSubscription: async () => stale, subscribe: async () => fresh }),
      srv,
    );
    expect(srv.remove).toHaveBeenCalledWith("https://push.example/old");
    expect(srv.save).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://push.example/new" }),
    );
  });
  it("does nothing on an unsupported browser and never throws", async () => {
    const srv = server();
    await reconcilePush(
      KEY,
      platform({ environment: () => ({ ...capable, hasServiceWorker: false }) }),
      srv,
    );
    await expect(
      reconcilePush(
        KEY,
        platform({
          getSubscription: async () => {
            throw new Error("boom");
          },
        }),
        srv,
      ),
    ).resolves.toBeUndefined();
    expect(srv.save).not.toHaveBeenCalled();
  });
});

describe("forgetThisDevice", () => {
  it("removes the server record and unsubscribes", async () => {
    const sub = fakeSubscription();
    const srv = server();
    await forgetThisDevice(platform({ getSubscription: async () => sub }), srv);
    expect(srv.remove).toHaveBeenCalledWith(sub.endpoint);
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
  it("gives up quietly when cleanup hangs, so sign-out still happens", async () => {
    const srv = server({ remove: () => new Promise(() => {}) });
    await expect(
      forgetThisDevice(platform({ getSubscription: async () => fakeSubscription() }), srv, 20),
    ).resolves.toBeUndefined();
  });
  it("swallows errors", async () => {
    await expect(
      forgetThisDevice(
        platform({
          getSubscription: async () => {
            throw new Error("no worker");
          },
        }),
        server(),
      ),
    ).resolves.toBeUndefined();
  });
});
