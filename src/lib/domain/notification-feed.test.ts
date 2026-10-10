import { describe, it, expect } from "vitest";
import {
  BELL_RECENT_LIMIT,
  absoluteTime,
  bellAriaLabel,
  internalLink,
  markReadLocally,
  parseNotificationRecord,
  prependNotification,
  relativeTime,
  unreadBadgeText,
} from "./notification-feed";
import type { AppNotification } from "@/lib/types";

function note(id: string, over: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    recipient_id: "u1",
    type: "work_order.submitted",
    title: `Title ${id}`,
    body: null,
    link: null,
    read_at: null,
    created_at: "2026-10-10T06:00:00.000Z",
    ...over,
  };
}

describe("unreadBadgeText", () => {
  it("hides the badge when nothing is unread", () => {
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(-3)).toBeNull();
    expect(unreadBadgeText(Number.NaN)).toBeNull();
  });
  it("shows the exact count up to 99", () => {
    expect(unreadBadgeText(1)).toBe("1");
    expect(unreadBadgeText(99)).toBe("99");
  });
  it("caps at 99+", () => {
    expect(unreadBadgeText(100)).toBe("99+");
    expect(unreadBadgeText(4321)).toBe("99+");
  });
});

describe("bellAriaLabel", () => {
  it("names the control and the exact unread count", () => {
    expect(bellAriaLabel(0)).toBe("Notifications");
    expect(bellAriaLabel(3)).toBe("Notifications, 3 unread");
    expect(bellAriaLabel(150)).toBe("Notifications, 150 unread");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-10T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reads recent and slightly-future timestamps as just now", () => {
    expect(relativeTime(ago(10_000), now)).toBe("just now");
    expect(relativeTime(ago(-30_000), now)).toBe("just now");
  });
  it("uses minutes, hours and days", () => {
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3 hr ago");
    expect(relativeTime(ago(26 * 3_600_000), now)).toBe("1 day ago");
    expect(relativeTime(ago(6 * 86_400_000), now)).toBe("6 days ago");
  });
  it("falls back to an IST calendar date after a week", () => {
    // 19:00 UTC on 1 Oct is already 2 Oct in India.
    expect(relativeTime("2026-10-01T19:00:00.000Z", now)).toBe("02 Oct 2026");
  });
  it("returns an empty string for garbage", () => {
    expect(relativeTime("not a date", now)).toBe("");
    expect(absoluteTime("not a date")).toBe("");
  });
});

describe("absoluteTime", () => {
  it("formats in IST", () => {
    expect(absoluteTime("2026-10-01T19:00:00.000Z")).toMatch(/02 Oct 2026/);
  });
});

describe("internalLink", () => {
  it("keeps in-app paths", () => {
    expect(internalLink("/projects/abc")).toBe("/projects/abc");
  });
  it("rejects anything that could leave the app", () => {
    expect(internalLink("//evil.example")).toBeNull();
    expect(internalLink("/\\evil.example")).toBeNull();
    expect(internalLink("https://evil.example")).toBeNull();
    expect(internalLink("javascript:alert(1)")).toBeNull();
    expect(internalLink(null)).toBeNull();
    expect(internalLink(undefined)).toBeNull();
  });
});

describe("parseNotificationRecord", () => {
  const valid = {
    id: "n1",
    recipient_id: "u1",
    type: "payment.recorded",
    title: "Payment received",
    body: "Anand — paid in full",
    link: "/projects/p1",
    read_at: null,
    created_at: "2026-10-10T06:00:00Z",
    dedupe_key: null,
  };

  it("accepts a well-formed realtime row and drops extra columns", () => {
    expect(parseNotificationRecord(valid)).toEqual({
      id: "n1",
      recipient_id: "u1",
      type: "payment.recorded",
      title: "Payment received",
      body: "Anand — paid in full",
      link: "/projects/p1",
      read_at: null,
      created_at: "2026-10-10T06:00:00Z",
    });
  });
  it("treats missing optional columns as null", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.body;
    delete rest.link;
    delete rest.read_at;
    expect(parseNotificationRecord(rest)).toMatchObject({
      body: null,
      link: null,
      read_at: null,
    });
  });
  it("neutralises an off-site link", () => {
    expect(parseNotificationRecord({ ...valid, link: "//evil.example" })?.link).toBeNull();
  });
  it("rejects malformed payloads", () => {
    expect(parseNotificationRecord(null)).toBeNull();
    expect(parseNotificationRecord("row")).toBeNull();
    expect(parseNotificationRecord({ ...valid, id: 7 })).toBeNull();
    expect(parseNotificationRecord({ ...valid, title: undefined })).toBeNull();
    expect(parseNotificationRecord({ ...valid, body: 42 })).toBeNull();
  });
});

describe("prependNotification", () => {
  it("puts the new row first and de-duplicates by id", () => {
    const list = [note("a"), note("b")];
    expect(prependNotification(list, note("b")).map((n) => n.id)).toEqual(["b", "a"]);
    expect(prependNotification(list, note("c")).map((n) => n.id)).toEqual(["c", "a", "b"]);
  });
  it("keeps at most the limit", () => {
    const list = Array.from({ length: BELL_RECENT_LIMIT }, (_, i) => note(`n${i}`));
    const next = prependNotification(list, note("new"));
    expect(next).toHaveLength(BELL_RECENT_LIMIT);
    expect(next[0].id).toBe("new");
    expect(next.at(-1)?.id).toBe(`n${BELL_RECENT_LIMIT - 2}`);
  });
});

describe("markReadLocally", () => {
  const readAt = "2026-10-10T07:00:00Z";
  const list = [note("a"), note("b"), note("c", { read_at: "2026-10-09T00:00:00Z" })];

  it("marks only the given ids", () => {
    const next = markReadLocally(list, ["a"], readAt);
    expect(next.map((n) => n.read_at)).toEqual([readAt, null, "2026-10-09T00:00:00Z"]);
  });
  it("marks everything unread with null, keeping earlier read times", () => {
    const next = markReadLocally(list, null, readAt);
    expect(next.map((n) => n.read_at)).toEqual([readAt, readAt, "2026-10-09T00:00:00Z"]);
  });
  it("does not mutate the input", () => {
    markReadLocally(list, null, readAt);
    expect(list[0].read_at).toBeNull();
  });
});
