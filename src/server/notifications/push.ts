import webpush from "web-push";
import type { PushConfig } from "./config";

/** A browser subscription as stored in `push_subscriptions`. */
export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the service worker (public/sw.js) renders. */
export interface PushMessage {
  title: string;
  body: string | null;
  /** In-app path opened when the notification is tapped. */
  url: string;
  /** Collapses repeats of the same alert on the device. */
  tag?: string;
}

export type PushSender = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

export interface PushReport {
  sent: number;
  failed: number;
  /** Subscription ids the push service says are gone — delete them. */
  expired: string[];
}

/** Statuses meaning the endpoint is permanently invalid (unsubscribed/expired). */
const GONE_STATUSES = new Set([404, 410]);

/** Push payloads are capped at ~4 KB; keep well inside it. */
const MAX_BODY = 240;

function statusOf(error: unknown): number | null {
  const code = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === "number" ? code : null;
}

/**
 * Deliver one message to many devices. Never throws: per-device failures are
 * counted, and endpoints the push service reports as gone are returned so the
 * caller can prune them. VAPID details are passed per call (no global state).
 */
export async function sendWebPush(
  subscriptions: readonly StoredSubscription[],
  message: PushMessage,
  config: PushConfig,
  send: PushSender = webpush.sendNotification,
): Promise<PushReport> {
  if (subscriptions.length === 0) return { sent: 0, failed: 0, expired: [] };

  const payload = JSON.stringify({
    title: message.title,
    body: message.body ? message.body.slice(0, MAX_BODY) : "",
    url: message.url,
    tag: message.tag,
  });
  const options: webpush.RequestOptions = {
    vapidDetails: {
      subject: config.subject,
      publicKey: config.publicKey,
      privateKey: config.privateKey,
    },
    TTL: 24 * 60 * 60,
    urgency: "high",
    timeout: 10_000,
  };

  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options),
    ),
  );

  const report: PushReport = { sent: 0, failed: 0, expired: [] };
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      report.sent += 1;
      return;
    }
    const status = statusOf(result.reason);
    if (status !== null && GONE_STATUSES.has(status)) {
      report.expired.push(subscriptions[i].id);
    } else {
      report.failed += 1;
      console.error(
        `[push] delivery failed (${status ?? "network"}) for subscription ${subscriptions[i].id}`,
      );
    }
  });
  return report;
}
