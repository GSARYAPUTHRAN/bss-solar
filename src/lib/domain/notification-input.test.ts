import { describe, it, expect } from "vitest";
import {
  MAX_IDS_PER_REQUEST,
  PUSH_INPUT_LIMITS,
  isUuid,
  parseNotificationIds,
  parsePushEndpoint,
  parsePushSubscription,
} from "./notification-input";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("isUuid", () => {
  it("accepts canonical UUIDs in either case", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(`${ID} `)).toBe(false);
    expect(isUuid(`${ID}' or 1=1`)).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("parseNotificationIds", () => {
  it("passes null through as 'everything'", () => {
    expect(parseNotificationIds(null)).toEqual({ ok: true, data: null });
  });
  it("de-duplicates and normalises case", () => {
    expect(parseNotificationIds([ID, ID.toUpperCase()])).toEqual({ ok: true, data: [ID] });
  });
  it("allows an empty list", () => {
    expect(parseNotificationIds([])).toEqual({ ok: true, data: [] });
  });
  it("rejects non-arrays, bad ids and oversized batches", () => {
    expect(parseNotificationIds(undefined).ok).toBe(false);
    expect(parseNotificationIds(ID).ok).toBe(false);
    expect(parseNotificationIds([ID, "x"]).ok).toBe(false);
    expect(
      parseNotificationIds(Array.from({ length: MAX_IDS_PER_REQUEST + 1 }, () => ID)).ok,
    ).toBe(false);
  });
});

describe("parsePushEndpoint", () => {
  it("accepts an https push service URL", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc:def";
    expect(parsePushEndpoint(` ${endpoint} `)).toEqual({ ok: true, data: endpoint });
  });
  it.each([
    "https://fcm.googleapis.com/fcm/send/dRK3:APA91b",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl",
    "https://web.push.apple.com/QGx1Zm9v",
    "https://api.push.apple.com/3/device/abc",
    "https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB",
    "https://db5p.notify.windows.com/w/?token=AwYAAAB",
    "https://push.services.mozilla.com.push.services.mozilla.com/x",
    "https://fcm.googleapis.com:443/fcm/send/abc",
  ])("accepts the real push service endpoint %s", (endpoint) => {
    expect(parsePushEndpoint(endpoint)).toEqual({ ok: true, data: endpoint });
  });
  it.each([
    ["an arbitrary host", "https://internal.example/hook"],
    ["a look-alike suffix", "https://evil.push.apple.com.example/x"],
    ["a host merely ending in the name", "https://evilfcm.googleapis.com/x"],
    ["a bare suffix", "https://notify.windows.com/x"],
    ["a sibling Google host", "https://android.googleapis.com/gcm/send/abc"],
    ["an IP literal", "https://127.0.0.1/x"],
    ["an IPv6 literal", "https://[::1]/x"],
    ["a trailing-dot host", "https://fcm.googleapis.com./x"],
  ])("rejects %s", (_label, endpoint) => {
    expect(parsePushEndpoint(endpoint)).toEqual({
      ok: false,
      error: "This browser's push service is not supported.",
    });
  });
  it.each([
    ["a non-default port", "https://fcm.googleapis.com:8443/fcm/send/abc"],
    ["credentials", "https://user:pw@fcm.googleapis.com/fcm/send/abc"],
    ["a user name", "https://internal.example@fcm.googleapis.com/fcm/send/abc"],
  ])("rejects a push service URL with %s", (_label, endpoint) => {
    expect(parsePushEndpoint(endpoint)).toEqual({ ok: false, error: "Invalid push subscription." });
  });
  it("rejects plain http, junk and oversized values", () => {
    expect(parsePushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toEqual({
      ok: false,
      error: "Push notifications need a secure (https) push service.",
    });
    expect(parsePushEndpoint("not a url").ok).toBe(false);
    expect(parsePushEndpoint("").ok).toBe(false);
    expect(parsePushEndpoint(null).ok).toBe(false);
    expect(
      parsePushEndpoint(`https://fcm.googleapis.com/${"a".repeat(PUSH_INPUT_LIMITS.endpoint)}`).ok,
    ).toBe(false);
  });
});

describe("parsePushSubscription", () => {
  const valid = {
    endpoint: "https://web.push.apple.com/QGx1",
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg==",
    userAgent: "Mozilla/5.0 (iPhone)",
  };

  it("accepts a browser subscription", () => {
    expect(parsePushSubscription(valid)).toEqual({ ok: true, data: valid });
  });
  it("caps the user agent and treats a blank one as unknown", () => {
    const long = parsePushSubscription({ ...valid, userAgent: "x".repeat(1000) });
    expect(long.ok && long.data.userAgent?.length).toBe(PUSH_INPUT_LIMITS.userAgent);
    const blank = parsePushSubscription({ ...valid, userAgent: "  " });
    expect(blank.ok && blank.data.userAgent).toBeNull();
  });
  it("rejects missing or malformed keys", () => {
    expect(parsePushSubscription({ ...valid, p256dh: "" }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid, auth: undefined }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid, auth: "has spaces" }).ok).toBe(false);
    expect(parsePushSubscription({ ...valid, p256dh: "A".repeat(PUSH_INPUT_LIMITS.key + 1) }).ok).toBe(false);
  });
  it("rejects a non-https or non-push-service endpoint and non-objects", () => {
    expect(parsePushSubscription({ ...valid, endpoint: "http://x.example" }).ok).toBe(false);
    expect(
      parsePushSubscription({ ...valid, endpoint: "https://internal.example/hook" }).ok,
    ).toBe(false);
    expect(parsePushSubscription(null).ok).toBe(false);
    expect(parsePushSubscription("sub").ok).toBe(false);
  });
});
