import {
  NOTIFICATION_TYPES,
  audienceFor,
  describe,
  resolveRecipients,
  type NotificationEvent,
} from "@/lib/domain/notifications";
import { pushConfig, type PushConfig } from "./config";
import { sendWebPush, type PushSender } from "./push";
import { serviceRoleStore, type NotificationStore } from "./store";

export interface DeliveryDeps {
  store: NotificationStore;
  /** null disables push (in-app only). */
  push: PushConfig | null;
  send?: PushSender;
}

export interface DeliveryReport {
  type: NotificationEvent["type"];
  recipients: number;
  /** Rows actually written (dedupe skips repeats of scheduled alerts). */
  inserted: number;
  pushed: number;
  failedPushes: number;
  prunedSubscriptions: number;
}

/**
 * Deliver one event: resolve who should hear about it, write their inbox rows,
 * then push to their devices. Throws on storage failure — callers that must not
 * fail (server actions) go through `notify()`, which swallows and logs.
 *
 * Push only goes to recipients whose row was newly inserted, so a re-run of the
 * daily cron never re-buzzes a phone for an alert already sent.
 */
export async function deliver(
  event: NotificationEvent,
  deps: Partial<DeliveryDeps> = {},
): Promise<DeliveryReport> {
  const store = deps.store ?? serviceRoleStore();
  const push = "push" in deps ? (deps.push ?? null) : pushConfig();

  const report: DeliveryReport = {
    type: event.type,
    recipients: 0,
    inserted: 0,
    pushed: 0,
    failedPushes: 0,
    prunedSubscriptions: 0,
  };

  const audience = audienceFor(event);
  const officeIds = audience.office ? await store.officeIds() : [];
  const recipients = resolveRecipients(audience, { officeIds, actorId: event.actorId });
  report.recipients = recipients.length;
  if (recipients.length === 0) return report;

  const message = describe(event);
  const inserted = await store.insert(
    recipients.map((recipient_id) => ({
      recipient_id,
      type: event.type,
      title: message.title,
      body: message.body,
      link: message.link,
      dedupe_key: message.dedupeKey,
    })),
  );
  report.inserted = inserted.length;

  if (!push || !NOTIFICATION_TYPES[event.type].push || inserted.length === 0) {
    return report;
  }

  const subscriptions = await store.subscriptionsFor(inserted);
  const result = await sendWebPush(
    subscriptions,
    {
      title: message.title,
      body: message.body,
      url: message.link ?? "/notifications",
      tag: message.dedupeKey ?? undefined,
    },
    push,
    deps.send,
  );
  report.pushed = result.sent;
  report.failedPushes = result.failed;
  if (result.expired.length > 0) {
    await store.removeSubscriptions(result.expired);
    report.prunedSubscriptions = result.expired.length;
  }
  return report;
}
