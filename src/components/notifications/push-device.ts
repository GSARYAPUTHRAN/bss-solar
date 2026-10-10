import {
  removePushSubscription,
  savePushSubscription,
} from "@/app/(app)/notifications/actions";
import type { ActionResult } from "@/lib/result";
import {
  currentPushEnvironment,
  currentSubscription,
  detectPushSupport,
  sameApplicationServerKey,
  subscribeDevice,
  subscriptionPayload,
  withTimeout,
  type PushEnvironment,
  type PushSubscriptionPayload,
} from "./push-client";

/**
 * This device's push lifecycle — read state, turn on, turn off, reconcile on
 * app start, forget on sign-out. The browser and the server are injected so
 * every branch is unit-tested without a real service worker.
 */

export type PushState =
  | "unconfigured"
  | "unsupported"
  | "ios-install"
  | "denied"
  | "off"
  | "on";

/** What the browser offers (narrowed to what this module uses). */
export interface PushPlatform {
  environment(): PushEnvironment;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  getSubscription(): Promise<PushSubscription | null>;
  subscribe(publicKey: string): Promise<PushSubscription>;
  userAgent(): string | null;
}

/** Where subscriptions are recorded (the notification server actions). */
export interface PushServer {
  save(payload: PushSubscriptionPayload): Promise<ActionResult>;
  remove(endpoint: string): Promise<ActionResult>;
}

export const browserPlatform: PushPlatform = {
  environment: currentPushEnvironment,
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  getSubscription: currentSubscription,
  subscribe: subscribeDevice,
  userAgent: () => navigator.userAgent || null,
};

export const actionServer: PushServer = {
  save: savePushSubscription,
  remove: removePushSubscription,
};

export interface PushOutcome {
  state: PushState;
  /** Plain-language reason to show the user, when something went wrong. */
  error?: string;
}

const SETUP_FAILED =
  "This browser could not set up notifications. Check your connection and try again.";

async function quietlyUnsubscribe(subscription: PushSubscription): Promise<void> {
  await subscription.unsubscribe().catch(() => false);
}

/** Current state of this device, for the toggle. */
export async function readPushState(
  publicKey: string | null,
  platform: PushPlatform = browserPlatform,
): Promise<PushState> {
  if (!publicKey) return "unconfigured";
  const support = detectPushSupport(platform.environment());
  if (support === "unsupported") return "unsupported";
  if (support === "ios-needs-install") return "ios-install";

  const permission = platform.permission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";
  return (await platform.getSubscription()) ? "on" : "off";
}

/**
 * Turn push on. Call straight from the tap handler: Safari only shows the
 * permission prompt when it is requested directly from a user gesture, so it
 * must be the first thing awaited.
 */
export async function enablePush(
  publicKey: string,
  platform: PushPlatform = browserPlatform,
  server: PushServer = actionServer,
): Promise<PushOutcome> {
  const permission = await platform.requestPermission();
  if (permission === "denied") return { state: "denied" };
  if (permission !== "granted") {
    return { state: "off", error: "Notifications were not allowed on this device." };
  }

  let subscription: PushSubscription;
  try {
    subscription = await platform.subscribe(publicKey);
  } catch {
    return { state: "off", error: SETUP_FAILED };
  }

  const payload = subscriptionPayload(subscription, platform.userAgent());
  if (!payload) {
    await quietlyUnsubscribe(subscription);
    return { state: "off", error: SETUP_FAILED };
  }

  const saved = await server.save(payload);
  if (!saved.ok) {
    // Never leave a browser subscription the server does not know about: the
    // toggle would read "on" while nothing is ever delivered.
    await quietlyUnsubscribe(subscription);
    return { state: "off", error: saved.error };
  }
  return { state: "on" };
}

/** Turn push off for this device. The server row goes first, then the browser's. */
export async function disablePush(
  platform: PushPlatform = browserPlatform,
  server: PushServer = actionServer,
): Promise<PushOutcome> {
  const subscription = await platform.getSubscription();
  if (!subscription) return { state: "off" };

  const removed = await server.remove(subscription.endpoint);
  if (!removed.ok) return { state: "on", error: removed.error };
  await quietlyUnsubscribe(subscription);
  return { state: "off" };
}

/**
 * Run once when the app starts. Keeps the server's record of this device true:
 *   - re-assigns the subscription to whoever is signed in now (and refreshes
 *     last_seen_at);
 *   - re-subscribes silently when the VAPID key has rotated;
 *   - drops the subscription when the user revoked permission in the browser.
 * Never throws — this is housekeeping, not something to bother the user with.
 */
export async function reconcilePush(
  publicKey: string,
  platform: PushPlatform = browserPlatform,
  server: PushServer = actionServer,
): Promise<void> {
  try {
    if (detectPushSupport(platform.environment()) !== "supported") return;
    const subscription = await platform.getSubscription();
    if (!subscription) return;

    if (platform.permission() !== "granted") {
      await server.remove(subscription.endpoint);
      await quietlyUnsubscribe(subscription);
      return;
    }

    let current = subscription;
    if (!sameApplicationServerKey(subscription.options.applicationServerKey, publicKey)) {
      await server.remove(subscription.endpoint);
      current = await platform.subscribe(publicKey);
    }
    const payload = subscriptionPayload(current, platform.userAgent());
    if (payload) await server.save(payload);
  } catch (error) {
    console.warn("[push] could not reconcile this device:", error);
  }
}

/** How long sign-out waits for push cleanup before going ahead regardless. */
export const FORGET_TIMEOUT_MS = 3_000;

/**
 * Best-effort, time-boxed: stop this device receiving the signed-in user's
 * pushes before they sign out, so the next person on a shared phone does not
 * see them. Must run while the session is still valid (the server removal is
 * scoped to the caller). Never throws and never blocks sign-out for long.
 */
export async function forgetThisDevice(
  platform: PushPlatform = browserPlatform,
  server: PushServer = actionServer,
  timeoutMs = FORGET_TIMEOUT_MS,
): Promise<void> {
  try {
    await withTimeout(
      (async () => {
        const subscription = await platform.getSubscription();
        if (!subscription) return;
        await server.remove(subscription.endpoint);
        await quietlyUnsubscribe(subscription);
      })(),
      timeoutMs,
    );
  } catch {
    // Offline or a stuck service worker: signing out matters more.
  }
}
