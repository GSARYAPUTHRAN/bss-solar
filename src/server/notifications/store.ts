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
 * Persistence for notification fan-out. Writes go through the service role
 * because the actor is rarely the recipient (and users have no INSERT policy
 * on their own inbox — see migration 20261010120500). Server-only.
 */
export interface NotificationStore {
  /** Every admin + the SuperAdmin. */
  officeIds(): Promise<string[]>;
  /**
   * Insert rows; a row whose (recipient, dedupe_key) already exists is skipped.
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
      // ON CONFLICT (recipient_id, dedupe_key) DO NOTHING — NULL keys never
      // conflict, so one-off notifications always land.
      const { data, error } = await db
        .from("notifications")
        .upsert([...rows], {
          onConflict: "recipient_id,dedupe_key",
          ignoreDuplicates: true,
        })
        .select("recipient_id");
      if (error) throw new Error(`notification insert failed: ${error.message}`);
      return (data ?? []).map((r) => r.recipient_id);
    },

    async subscriptionsFor(userIds) {
      if (userIds.length === 0) return [];
      const { data, error } = await db
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("user_id", [...userIds]);
      if (error) throw new Error(`subscription lookup failed: ${error.message}`);
      return data ?? [];
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
