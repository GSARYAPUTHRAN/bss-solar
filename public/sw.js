/*
 * BSS Ops service worker — Web Push only.
 *
 * Deliberately has no fetch handler: the app is always online-first and must
 * never serve stale business data from a cache. It shows pushes sent by
 * src/server/notifications/push.ts ({ title, body, url, tag }) and opens the
 * in-app page when one is tapped. Served with no-cache headers (next.config.ts)
 * and registered with updateViaCache "none", so changes reach phones promptly.
 */

const FALLBACK_URL = "/notifications";
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-72.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Only ever navigate within this app: "/path", never "//host" or a full URL. */
function safePath(value) {
  if (typeof value !== "string") return FALLBACK_URL;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return FALLBACK_URL;
  }
  const url = new URL(value, self.location.origin);
  return url.origin === self.location.origin ? url.pathname + url.search + url.hash : FALLBACK_URL;
}

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  const title =
    typeof payload.title === "string" && payload.title ? payload.title : "BSS Solar";
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : undefined;

  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: ICON,
    badge: BADGE,
    data: { url: safePath(payload.url) },
  };
  if (tag) {
    // Same alert again (e.g. a re-sent reminder) replaces the old one but
    // still buzzes.
    options.tag = tag;
    options.renotify = true;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * `client` showing `target`, or null when it cannot be navigated there (e.g. a
 * window this worker no longer controls).
 */
async function navigated(client, target) {
  if (client.url === target) return client;
  try {
    return (await client.navigate(target)) || client;
  } catch {
    return null;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;

  // A click allows exactly one window to be focused OR opened (Chromium spends
  // the same allowance on focus() and openWindow()). So navigate first and
  // focus only once that worked; otherwise the allowance is still unspent for
  // openWindow().
  event.waitUntil(
    (async () => {
      // Only windows this worker controls can be navigated (a hard-reloaded
      // tab is uncontrolled), so those are the only ones worth reusing.
      const windows = await self.clients.matchAll({ type: "window" });
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      const client = existing && (await navigated(existing, target));
      if (client) {
        await client.focus();
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
