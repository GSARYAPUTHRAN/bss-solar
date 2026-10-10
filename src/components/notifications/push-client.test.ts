import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectPushSupport,
  isIOSDevice,
  sameApplicationServerKey,
  subscriptionPayload,
  urlBase64ToUint8Array,
  withTimeout,
  type PushEnvironment,
} from "./push-client";

const capable: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIOS: false,
  isStandalone: false,
};

describe("detectPushSupport", () => {
  it("supports a capable desktop/Android browser", () => {
    expect(detectPushSupport(capable)).toBe("supported");
  });
  it("asks iOS Safari users to add the app to the Home Screen first", () => {
    expect(detectPushSupport({ ...capable, isIOS: true, hasPushManager: false })).toBe(
      "ios-needs-install",
    );
  });
  it("supports an installed iOS web app", () => {
    expect(detectPushSupport({ ...capable, isIOS: true, isStandalone: true })).toBe(
      "supported",
    );
  });
  it("reports browsers without the APIs as unsupported", () => {
    expect(detectPushSupport({ ...capable, hasServiceWorker: false })).toBe("unsupported");
    expect(detectPushSupport({ ...capable, hasPushManager: false })).toBe("unsupported");
    expect(detectPushSupport({ ...capable, hasNotification: false })).toBe("unsupported");
  });
});

describe("isIOSDevice", () => {
  it("detects iPhone and iPadOS-as-Mac", () => {
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" })).toBe(true);
    expect(
      isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }),
    ).toBe(true);
  });
  it("does not flag a desktop Mac or Android", () => {
    expect(
      isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }),
    ).toBe(false);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14)" })).toBe(false);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url without padding", () => {
    // "+/8=" in base64 is bytes [0xfb, 0xff]; base64url spells it "-_8".
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([0xfb, 0xff]);
  });
  it("round-trips a 65-byte VAPID public key", () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37) % 256);
    const b64url = Buffer.from(bytes).toString("base64url");
    expect(Array.from(urlBase64ToUint8Array(b64url))).toEqual(Array.from(bytes));
  });
});

describe("sameApplicationServerKey", () => {
  const key = Buffer.from([1, 2, 3, 4]).toString("base64url");

  it("matches identical key bytes", () => {
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 3, 4]).buffer, key)).toBe(true);
  });
  it("detects a rotated key or a missing one", () => {
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 3, 5]).buffer, key)).toBe(false);
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(false);
    expect(sameApplicationServerKey(null, key)).toBe(false);
  });
});

describe("subscriptionPayload", () => {
  const sub = (json: PushSubscriptionJSON) => ({ toJSON: () => json });

  it("flattens the browser's JSON shape", () => {
    expect(
      subscriptionPayload(
        sub({ endpoint: "https://push.example/1", keys: { p256dh: "pk", auth: "au" } }),
        "UA",
      ),
    ).toEqual({ endpoint: "https://push.example/1", p256dh: "pk", auth: "au", userAgent: "UA" });
  });
  it("returns null for an incomplete subscription", () => {
    expect(subscriptionPayload(sub({ endpoint: "https://push.example/1" }), null)).toBeNull();
    expect(subscriptionPayload(sub({ keys: { p256dh: "pk", auth: "au" } }), null)).toBeNull();
  });
});

describe("withTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves with the promise's value", async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
  it("passes through rejections", async () => {
    await expect(withTimeout(Promise.reject(new Error("nope")), 50)).rejects.toThrow("nope");
  });
  it("rejects when the promise hangs", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 1_000);
    vi.advanceTimersByTime(1_000);
    await expect(pending).rejects.toThrow("Timed out");
  });
});
