"use server";

import { requireProfile } from "@/lib/auth";
import { notificationsRepository } from "@/server/data";
import { BELL_RECENT_LIMIT } from "@/lib/domain/notification-feed";
import {
  parseNotificationIds,
  parsePushEndpoint,
  parsePushSubscription,
} from "@/lib/domain/notification-input";
import { fail, ok, type ActionResult } from "@/lib/result";
import type { AppNotification } from "@/lib/types";

/**
 * The signed-in user's own inbox and push devices. Every action re-checks the
 * session (requireProfile) and every repository call is scoped to the caller by
 * RLS / SECURITY DEFINER RPCs, so a user can never read or touch someone else's
 * notifications whatever they send here.
 *
 * These return ActionResult instead of redirecting: they are called from the
 * bell and the push toggle, which stay on whatever page the user is on. They
 * deliberately do not revalidatePath — that would re-render the user's current
 * page on every tap; the client updates its own state instead.
 */

export interface RecentNotifications {
  items: AppNotification[];
  unreadCount: number;
}

export async function getRecentNotifications(): Promise<ActionResult<RecentNotifications>> {
  await requireProfile();
  try {
    const [items, unreadCount] = await Promise.all([
      notificationsRepository.recent(BELL_RECENT_LIMIT),
      notificationsRepository.unreadCount(),
    ]);
    return ok({ items, unreadCount });
  } catch {
    return fail("Could not load notifications — try again.");
  }
}

export async function getUnreadCount(): Promise<ActionResult<number>> {
  await requireProfile();
  return ok(await notificationsRepository.unreadCount());
}

/** Mark the given notifications (or, with null, all of them) read. */
export async function markNotificationsRead(
  ids: string[] | null,
): Promise<ActionResult<{ count: number }>> {
  await requireProfile();

  const parsed = parseNotificationIds(ids);
  if (!parsed.ok) return parsed;
  if (parsed.data !== null && parsed.data.length === 0) return ok({ count: 0 });

  const { count, error } = await notificationsRepository.markRead(parsed.data);
  if (error) {
    console.error("[notifications] mark read failed:", error);
    return fail("Could not mark notifications as read. Please try again.");
  }
  return ok({ count });
}

/** Delete the caller's already-read notifications. */
export async function clearReadNotifications(): Promise<ActionResult> {
  await requireProfile();
  const { error } = await notificationsRepository.clearRead();
  if (error) {
    console.error("[notifications] clear read failed:", error);
    return fail("Could not clear read notifications. Please try again.");
  }
  return ok(undefined);
}

/**
 * Register this browser for Web Push, or re-assign it to the caller when
 * someone else used it last (shared phones in the field).
 */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}): Promise<ActionResult> {
  await requireProfile();

  const parsed = parsePushSubscription(input);
  if (!parsed.ok) return parsed;

  const { error } = await notificationsRepository.registerPush(parsed.data);
  if (error) {
    console.error("[notifications] push registration failed:", error);
    return fail("Could not turn on notifications for this device. Please try again.");
  }
  return ok(undefined);
}

/** Stop pushing to this browser (only ever removes the caller's own device). */
export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  await requireProfile();

  const parsed = parsePushEndpoint(endpoint);
  if (!parsed.ok) return parsed;

  const { error } = await notificationsRepository.unregisterPush(parsed.data);
  if (error) {
    console.error("[notifications] push removal failed:", error);
    return fail("Could not turn off notifications for this device. Please try again.");
  }
  return ok(undefined);
}
