import { fail, ok, type ActionResult } from "@/lib/result";

/**
 * Validation for what a browser may send to the notification server actions.
 * Server actions are public HTTP endpoints, so their arguments are untrusted
 * whatever the TypeScript signature says.
 */

/** Upper bound on ids in one "mark read" call (the bell shows 15). */
export const MAX_IDS_PER_REQUEST = 100;

/** Generous caps — real values are far shorter (endpoints ~200 chars). */
export const PUSH_INPUT_LIMITS = {
  endpoint: 2048,
  key: 512,
  userAgent: 300,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Web Push keys are base64url (RFC 8291); some browsers keep the padding.
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * `null` means "every unread notification". Otherwise a list (possibly empty) of
 * unique UUIDs, capped at MAX_IDS_PER_REQUEST.
 */
export function parseNotificationIds(input: unknown): ActionResult<string[] | null> {
  if (input === null) return ok(null);
  if (!Array.isArray(input)) return fail("Invalid notification selection.");
  if (input.length > MAX_IDS_PER_REQUEST) {
    return fail("Too many notifications in one request.");
  }
  if (!input.every(isUuid)) return fail("Invalid notification id.");
  return ok([...new Set(input.map((id) => id.toLowerCase()))]);
}

/**
 * The browser push services: Google FCM (Chrome, Edge on Android), Mozilla
 * autopush, Apple and Windows (WNS). The server POSTs to every stored endpoint,
 * so any other host would let a user aim it wherever they like.
 * register_push_subscription() mirrors this list in SQL — change both together.
 */
export const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
] as const;
export const PUSH_SERVICE_HOST_SUFFIXES = [
  ".push.apple.com",
  ".notify.windows.com",
  ".push.services.mozilla.com",
] as const;

function isPushServiceHost(hostname: string): boolean {
  return (
    (PUSH_SERVICE_HOSTS as readonly string[]).includes(hostname) ||
    PUSH_SERVICE_HOST_SUFFIXES.some(
      (suffix) => hostname.length > suffix.length && hostname.endsWith(suffix),
    )
  );
}

/**
 * A push endpoint must be an https URL of sane length on a known push service,
 * on the default port and without credentials.
 */
export function parsePushEndpoint(input: unknown): ActionResult<string> {
  if (typeof input !== "string") return fail("Invalid push subscription.");
  const endpoint = input.trim();
  if (endpoint.length === 0 || endpoint.length > PUSH_INPUT_LIMITS.endpoint) {
    return fail("Invalid push subscription.");
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return fail("Invalid push subscription.");
  }
  if (url.protocol !== "https:") {
    return fail("Push notifications need a secure (https) push service.");
  }
  // URL normalises an explicit :443 away, so any port left is a different one.
  if (url.port !== "" || url.username !== "" || url.password !== "") {
    return fail("Invalid push subscription.");
  }
  if (!isPushServiceHost(url.hostname)) {
    return fail("This browser's push service is not supported.");
  }
  return ok(endpoint);
}

function parseKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const key = input.trim();
  return key.length > 0 && key.length <= PUSH_INPUT_LIMITS.key && BASE64URL.test(key)
    ? key
    : null;
}

export interface PushSubscriptionFields {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/** Validate a browser PushSubscription as serialised by the client. */
export function parsePushSubscription(
  input: unknown,
): ActionResult<PushSubscriptionFields> {
  if (typeof input !== "object" || input === null) {
    return fail("Invalid push subscription.");
  }
  const raw = input as Record<string, unknown>;

  const endpoint = parsePushEndpoint(raw.endpoint);
  if (!endpoint.ok) return endpoint;

  const p256dh = parseKey(raw.p256dh);
  const auth = parseKey(raw.auth);
  if (!p256dh || !auth) return fail("Invalid push subscription keys.");

  const userAgent =
    typeof raw.userAgent === "string" && raw.userAgent.trim().length > 0
      ? raw.userAgent.trim().slice(0, PUSH_INPUT_LIMITS.userAgent)
      : null;

  return ok({ endpoint: endpoint.data, p256dh, auth, userAgent });
}
