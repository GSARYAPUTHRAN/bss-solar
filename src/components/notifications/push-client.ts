/**
 * Browser-side Web Push plumbing: feature detection, the service worker
 * (public/sw.js) and this device's PushSubscription. Framework-free so the
 * decisions (what is supported, how keys are encoded) are unit-testable; the
 * React state lives in push-toggle.tsx / notifications-provider.tsx.
 */

export const SERVICE_WORKER_URL = "/sw.js";

/** Never let a hung service worker or push service block the UI for longer. */
export const PUSH_TIMEOUT_MS = 8_000;

export type PushSupport = "supported" | "unsupported" | "ios-needs-install";

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIOS: boolean;
  /** Launched from the home screen (installed PWA). */
  isStandalone: boolean;
}

/**
 * iOS/iPadOS only allows Web Push for a site added to the Home Screen (16.4+),
 * so in a Safari tab the honest answer is "install first", not "unsupported".
 */
export function detectPushSupport(env: PushEnvironment): PushSupport {
  if (env.isIOS && !env.isStandalone) return "ios-needs-install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) {
    return "unsupported";
  }
  return "supported";
}

/** iPhone/iPod/iPad, including iPadOS which reports itself as a Mac. */
export function isIOSDevice(nav: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

/** Snapshot of the current browser. Call only on the client. */
export function currentPushEnvironment(): PushEnvironment {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return {
    hasServiceWorker: "serviceWorker" in nav,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    isIOS: isIOSDevice(nav),
    isStandalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      nav.standalone === true,
  };
}

/** VAPID public key (base64url) → the bytes PushManager.subscribe() expects. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Does an existing subscription belong to this VAPID key? (Keys can rotate.) */
export function sameApplicationServerKey(
  existing: ArrayBuffer | null | undefined,
  publicKey: string,
): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  const b = urlBase64ToUint8Array(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export interface PushSubscriptionPayload {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/** Serialise a PushSubscription for savePushSubscription(). Null if incomplete. */
export function subscriptionPayload(
  subscription: Pick<PushSubscription, "toJSON">,
  userAgent: string | null,
): PushSubscriptionPayload | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth, userAgent };
}

/** Reject after `ms` so a stuck browser API cannot hang a click handler. */
export function withTimeout<T>(promise: Promise<T>, ms = PUSH_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Register (or refresh) the push service worker. `updateViaCache: "none"`
 * makes the browser always revalidate sw.js, so fixes reach phones promptly.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
    updateViaCache: "none",
  });
  // pushManager.subscribe() needs an *active* worker, not just a registration.
  return withTimeout(navigator.serviceWorker.ready);
}

/** This device's current subscription, without registering anything new. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  // iOS Safari outside an installed web app has a worker but no PushManager.
  return (await registration?.pushManager?.getSubscription()) ?? null;
}

/**
 * Subscribe this device with the given VAPID key, replacing a subscription made
 * under an older key (the push service would reject our pushes to it).
 */
export async function subscribeDevice(publicKey: string): Promise<PushSubscription> {
  const registration = await registerServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    if (sameApplicationServerKey(existing.options.applicationServerKey, publicKey)) {
      return existing;
    }
    await existing.unsubscribe();
  }
  return withTimeout(
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }),
  );
}
