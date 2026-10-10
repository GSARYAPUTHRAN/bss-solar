import { createAdminClient } from "@/lib/supabase/admin";
import { OFFICE_ROLES } from "@/lib/domain/role";
import type { StoredSubscription } from "./push";

/** A notification row about to be written. */
export interface NewNotification {
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  dedupe_key: string | null;
}

/**
 * register_push_subscription keeps each user's 10 most recently seen devices
 * (migration 20261010120500), and PostgREST returns at most 1000 rows per
 * request (`max_rows`, supabase/config.toml). Looking up at most 100 users per
 * request therefore always returns every device: one user's devices can never
 * crowd another recipient's out of a truncated response.
 */
const MAX_DEVICES_PER_USER = 10;
const MAX_ROWS_PER_REQUEST = 1000;
const USERS_PER_LOOKUP = MAX_ROWS_PER_REQUEST / MAX_DEVICES_PER_USER;

/**
 * Persistence for notification fan-out. Writes go through the service role
 * because the actor is rarely the recipient (and users have no INSERT policy
 * on their own inbox — see migration 20261010120500). Server-only.
 */
export interface NotificationStore {
  /** Every admin + the SuperAdmin. */
  officeIds(): Promise<string[]>;
  /**
   * Insert rows; a row whose (recipient, dedupe_key) was ever sent before is
   * skipped, even if the user has since deleted it from their inbox.
   * Returns the recipient ids actually inserted (the ones to push to).
   */
  insert(rows: readonly NewNotification[]): Promise<string[]>;
  subscriptionsFor(userIds: readonly string[]): Promise<StoredSubscription[]>;
  removeSubscriptions(ids: readonly string[]): Promise<void>;
}

export function serviceRoleStore(): NotificationStore {
  const db = createAdminClient();

  return {
    async officeIds() {
      const { data, error } = await db
        .from("profiles")
        .select("id")
        .in("role", OFFICE_ROLES);
      if (error) throw new Error(`office lookup failed: ${error.message}`);
      return (data ?? []).map((r) => r.id);
    },

    async insert(rows) {
      if (rows.length === 0) return [];
      // Claims each dedupe_key in notification_dedupe and writes only the rows
      // it claimed, in one statement; NULL keys never conflict, so one-off
      // notifications always land.
      const { data, error } = await db.rpc("insert_notifications", {
        p_rows: rows.map((r) => ({
          recipient_id: r.recipient_id,
          type: r.type,
          title: r.title,
          body: r.body,
          link: r.link,
          dedupe_key: r.dedupe_key,
        })),
      });
      if (error) throw new Error(`notification insert failed: ${error.message}`);
      return (data ?? []).map((r) => r.recipient_id);
    },

    async subscriptionsFor(userIds) {
      const subscriptions: StoredSubscription[] = [];
      for (let i = 0; i < userIds.length; i += USERS_PER_LOOKUP) {
        const users = userIds.slice(i, i + USERS_PER_LOOKUP);
        const { data, error } = await db
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .in("user_id", users)
          .order("user_id")
          .order("last_seen_at", { ascending: false })
          .order("id")
          .limit(users.length * MAX_DEVICES_PER_USER);
        if (error) throw new Error(`subscription lookup failed: ${error.message}`);
        subscriptions.push(...(data ?? []));
      }
      return subscriptions;
    },

    async removeSubscriptions(ids) {
      if (ids.length === 0) return;
      const { error } = await db
        .from("push_subscriptions")
        .delete()
        .in("id", [...ids]);
      if (error) throw new Error(`subscription cleanup failed: ${error.message}`);
    },
  };
}
