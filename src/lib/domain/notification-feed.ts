import type { AppNotification } from "@/lib/types";

/**
 * Presentation rules for the notification inbox (bell panel + /notifications).
 * Pure and deterministic — `now` is always passed in — so a server-rendered
 * list and its hydrated client copy produce identical text.
 */

/** Rows shown in the bell's "small tab". */
export const BELL_RECENT_LIMIT = 15;

/** Rows per page on /notifications. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** The badge stops counting here and shows "99+". */
export const UNREAD_BADGE_CAP = 99;

const IST = "Asia/Kolkata";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function wholeCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

/** Text for the bell badge, or null when there is nothing unread. */
export function unreadBadgeText(count: number): string | null {
  const n = wholeCount(count);
  if (n === 0) return null;
  return n > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(n);
}

/** Accessible name for the bell; screen readers get the exact count. */
export function bellAriaLabel(count: number): string {
  const n = wholeCount(count);
  return n === 0 ? "Notifications" : `Notifications, ${n} unread`;
}

// Explicit IST: the server (UTC on Vercel) and a phone in India must agree on
// the calendar day, or hydration would flag a mismatch.
const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: IST,
});
const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: IST,
});

function parseInstant(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Full timestamp in IST, for tooltips. Empty for an unparseable value. */
export function absoluteTime(iso: string): string {
  const t = parseInstant(iso);
  return t === null ? "" : dateTimeFormat.format(t);
}

/**
 * "just now", "5 min ago", "3 hr ago", "2 days ago", then a plain date once a
 * week has passed. A timestamp slightly in the future (clock skew between the
 * phone and the database) reads as "just now" rather than a negative age.
 */
export function relativeTime(iso: string, now: number): string {
  const t = parseInstant(iso);
  if (t === null) return "";
  const elapsed = now - t;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} hr ago`;
  const days = Math.floor(elapsed / DAY);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  return dateFormat.format(t);
}

/**
 * An in-app path ("/projects/…"), or null. The database already rejects any
 * other link; this is the client-side belt-and-braces before router.push().
 */
export function internalLink(link: string | null | undefined): string | null {
  if (typeof link !== "string") return null;
  return link.startsWith("/") && !link.startsWith("//") && !link.startsWith("/\\")
    ? link
    : null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return isString(value) ? value : undefined;
}

/**
 * Validate a row pushed over Supabase Realtime (`payload.new`). Realtime
 * payloads are untyped JSON, so anything malformed is dropped instead of being
 * rendered.
 */
export function parseNotificationRecord(record: unknown): AppNotification | null {
  if (typeof record !== "object" || record === null) return null;
  const r = record as Record<string, unknown>;
  if (
    !isString(r.id) ||
    !isString(r.recipient_id) ||
    !isString(r.type) ||
    !isString(r.title) ||
    !isString(r.created_at)
  ) {
    return null;
  }
  const body = optionalString(r.body);
  const link = optionalString(r.link);
  const readAt = optionalString(r.read_at);
  if (body === undefined || link === undefined || readAt === undefined) return null;

  return {
    id: r.id,
    recipient_id: r.recipient_id,
    type: r.type,
    title: r.title,
    body,
    link: internalLink(link),
    read_at: readAt,
    created_at: r.created_at,
  };
}

/** Put a new notification on top, without duplicates, keeping at most `limit`. */
export function prependNotification(
  list: readonly AppNotification[],
  item: AppNotification,
  limit = BELL_RECENT_LIMIT,
): AppNotification[] {
  return [item, ...list.filter((n) => n.id !== item.id)].slice(0, limit);
}

/** Mark the given ids (or, with null, every row) read in a local copy. */
export function markReadLocally(
  list: readonly AppNotification[],
  ids: readonly string[] | null,
  readAt: string,
): AppNotification[] {
  const target = ids === null ? null : new Set(ids);
  return list.map((n) =>
    n.read_at === null && (target === null || target.has(n.id))
      ? { ...n, read_at: readAt }
      : n,
  );
}
