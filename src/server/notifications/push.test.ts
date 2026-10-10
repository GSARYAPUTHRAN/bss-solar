import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import type { PushConfig } from "./config";
import {
  PUSH_DEADLINE_MS,
  sendWebPush,
  type PushMessage,
  type PushSender,
  type StoredSubscription,
} from "./push";

const CONFIG: PushConfig = {
  publicKey: "public-key",
  privateKey: "private-key",
  subject: "mailto:ops@bss.example",
};

const MESSAGE: PushMessage = {
  title: "Work order approved",
  body: "Anil Kumar is now an active project.",
  url: "/projects/pr-1",
  tag: "feasibility.expiring:pr-1:p1:d7",
};

function subscription(id: string): StoredSubscription {
  return { id, endpoint: `https://push.example/${id}`, p256dh: `p256dh-${id}`, auth: `auth-${id}` };
}

/** A push-service rejection, shaped like web-push's WebPushError. */
function pushError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error("Received unexpected response code"), { statusCode });
}

/** A sender whose outcome is decided per endpoint. */
function senderBy(outcomes: Record<string, () => Promise<unknown>>) {
  return vi.fn<PushSender>(async (sub) => outcomes[sub.endpoint]());
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => consoleError.mockRestore();
});

describe("sendWebPush — accounting", () => {
  it("does nothing for no subscriptions", async () => {
    const send = vi.fn<PushSender>();
    expect(await sendWebPush([], MESSAGE, CONFIG, send)).toEqual({ sent: 0, failed: 0, expired: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts every accepted delivery", async () => {
    const send = vi.fn<PushSender>().mockResolvedValue({ statusCode: 201 });
    const subs = [subscription("a"), subscription("b"), subscription("c")];
    expect(await sendWebPush(subs, MESSAGE, CONFIG, send)).toEqual({ sent: 3, failed: 0, expired: [] });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("returns 404 and 410 endpoints as expired, to be pruned", async () => {
    const send = senderBy({
      "https://push.example/ok": async () => ({ statusCode: 201 }),
      "https://push.example/gone": async () => Promise.reject(pushError(410)),
      "https://push.example/missing": async () => Promise.reject(pushError(404)),
    });
    const report = await sendWebPush(
      [subscription("ok"), subscription("gone"), subscription("missing")],
      MESSAGE,
      CONFIG,
      send,
    );
    expect(report).toEqual({ sent: 1, failed: 0, expired: ["gone", "missing"] });
  });

  it.each([400, 401, 403, 413, 429, 500, 502, 503])(
    "counts HTTP %i as a failure, not an expiry (the device may come back)",
    async (status) => {
      const send = vi.fn<PushSender>().mockRejectedValue(pushError(status));
      expect(await sendWebPush([subscription("a")], MESSAGE, CONFIG, send)).toEqual({
        sent: 0,
        failed: 1,
        expired: [],
      });
    },
  );

  it.each([
    ["a network error", new Error("ECONNRESET")],
    ["a string", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["a non-numeric status", { statusCode: "410" }],
  ])("counts a rejection with %s as a failure and logs it", async (_label, reason) => {
    const send = vi.fn<PushSender>().mockRejectedValue(reason);
    expect(await sendWebPush([subscription("a")], MESSAGE, CONFIG, send)).toEqual({
      sent: 0,
      failed: 1,
      expired: [],
    });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("subscription a"));
  });

  // web-push's `timeout` only notices an idle socket, so an endpoint that
  // trickles bytes (or a sender that never settles) must still be cut off.
  describe("hard deadline", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      return () => vi.useRealTimers();
    });

    it("gives up on a delivery that has not settled after 10 s, as a failure", async () => {
      const send = senderBy({
        "https://push.example/slow": () => new Promise(() => {}),
        "https://push.example/ok": async () => ({ statusCode: 201 }),
      });
      const pending = sendWebPush([subscription("slow"), subscription("ok")], MESSAGE, CONFIG, send);

      await vi.advanceTimersByTimeAsync(PUSH_DEADLINE_MS - 1);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      // Never "expired": a slow push service says nothing about the device.
      await expect(pending).resolves.toEqual({ sent: 1, failed: 1, expired: [] });
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringMatching(/\(timeout\) for subscription slow$/),
      );
    });

    it("leaves no timer behind once every delivery has settled", async () => {
      const send = vi.fn<PushSender>().mockResolvedValue({ statusCode: 201 });
      await sendWebPush([subscription("a"), subscription("b")], MESSAGE, CONFIG, send);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("isolates devices: one failure does not stop the rest", async () => {
    const send = senderBy({
      "https://push.example/a": async () => Promise.reject(pushError(500)),
      "https://push.example/b": async () => ({ statusCode: 201 }),
      "https://push.example/c": async () => Promise.reject(pushError(410)),
      "https://push.example/d": async () => ({ statusCode: 201 }),
    });
    const report = await sendWebPush(
      ["a", "b", "c", "d"].map(subscription),
      MESSAGE,
      CONFIG,
      send,
    );
    expect(report).toEqual({ sent: 2, failed: 1, expired: ["c"] });
  });

  // "Never throws" does not hold for a sender that throws
  // synchronously — the throw escapes `subscriptions.map(...)` before
  // Promise.allSettled can catch it, so deliver() (and the daily cron) fail
  // after the inbox rows were written. web-push's own sendNotification
  // returns a rejected promise, so only injected senders hit this today.
  // Fix: `subscriptions.map(async (s) => send(...))`.
  it("never throws, even for a synchronously throwing sender", async () => {
    const send: PushSender = () => {
      throw new Error("sync failure");
    };
    await expect(sendWebPush([subscription("a")], MESSAGE, CONFIG, send)).resolves.toEqual({
      sent: 0,
      failed: 1,
      expired: [],
    });
  });
});

describe("sendWebPush — what is sent", () => {
  it("addresses each stored subscription with its keys", async () => {
    const send = vi.fn<PushSender>().mockResolvedValue({});
    await sendWebPush([subscription("a")], MESSAGE, CONFIG, send);
    expect(send).toHaveBeenCalledWith(
      { endpoint: "https://push.example/a", keys: { p256dh: "p256dh-a", auth: "auth-a" } },
      expect.any(String),
      expect.any(Object),
    );
  });

  it("sends one JSON payload for the service worker", async () => {
    const send = vi.fn<PushSender>().mockResolvedValue({});
    await sendWebPush([subscription("a"), subscription("b")], MESSAGE, CONFIG, send);
    const payloads = send.mock.calls.map(([, payload]) => payload);
    expect(new Set(payloads).size).toBe(1);
    expect(JSON.parse(payloads[0])).toEqual({
      title: "Work order approved",
      body: "Anil Kumar is now an active project.",
      url: "/projects/pr-1",
      tag: "feasibility.expiring:pr-1:p1:d7",
    });
  });

  it("sends an empty body for a null body and omits a missing tag", async () => {
    const send = vi.fn<PushSender>().mockResolvedValue({});
    await sendWebPush([subscription("a")], { title: "T", body: null, url: "/tickets" }, CONFIG, send);
    const sent = JSON.parse(send.mock.calls[0][1]) as Record<string, unknown>;
    expect(sent).toEqual({ title: "T", body: "", url: "/tickets" });
    expect("tag" in sent).toBe(false);
  });

  it("truncates a long body to keep the payload inside the 4 KB push limit", async () => {
    const send = vi.fn<PushSender>().mockResolvedValue({});
    await sendWebPush([subscription("a")], { ...MESSAGE, body: "x".repeat(10_000) }, CONFIG, send);
    const sent = JSON.parse(send.mock.calls[0][1]) as { body: string };
    expect(sent.body).toBe("x".repeat(240));
  });

  it("keeps a multi-byte (Malayalam) body well inside 4 KB", async () => {
    const send = vi.fn<PushSender>().mockResolvedValue({});
    await sendWebPush([subscription("a")], { ...MESSAGE, body: "മ".repeat(5_000) }, CONFIG, send);
    expect(Buffer.byteLength(send.mock.calls[0][1], "utf8")).toBeLessThan(3_000);
  });

  it("passes VAPID details per call with a day's TTL and high urgency", async () => {
    const send = vi.fn<PushSender>().mockResolvedValue({});
    await sendWebPush([subscription("a")], MESSAGE, CONFIG, send);
    expect(send.mock.calls[0][2]).toEqual({
      vapidDetails: {
        subject: "mailto:ops@bss.example",
        publicKey: "public-key",
        privateKey: "private-key",
      },
      TTL: 86_400,
      urgency: "high",
      timeout: 10_000,
    });
  });
});

describe("sendWebPush — against the real web-push library", () => {
  /** A browser-shaped subscription with real P-256 / auth key material. */
  function realSubscription(id: string): StoredSubscription {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return {
      id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    };
  }

  it("builds options and payloads web-push accepts and encrypts under 4 KB", async () => {
    const keys = webpush.generateVAPIDKeys();
    const config: PushConfig = {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:ops@bss.example",
    };
    const requests: ReturnType<typeof webpush.generateRequestDetails>[] = [];
    // Run web-push's own validation + encryption instead of the network call.
    const send: PushSender = async (sub, payload, options) => {
      requests.push(webpush.generateRequestDetails(sub, payload, options));
    };

    const report = await sendWebPush(
      [realSubscription("a")],
      { ...MESSAGE, body: "മ".repeat(5_000) },
      config,
      send,
    );

    expect(report).toEqual({ sent: 1, failed: 0, expired: [] });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers).toMatchObject({ TTL: 86_400, Urgency: "high" });
    expect(requests[0].body?.length ?? 0).toBeLessThanOrEqual(4096);
  });
});
