import { createClient } from "@/lib/supabase/server";
import { rangeFor, type PageResult } from "@/lib/pagination";
import type { AppNotification } from "@/lib/types";

const SELECT = "id, recipient_id, type, title, body, link, read_at, created_at";

/** A browser push subscription, as the client serialises it. */
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * The signed-in user's own inbox. RLS limits every read to `recipient_id =
 * auth.uid()`; writes go through SECURITY DEFINER RPCs that only ever touch the
 * caller's rows (migration 20261010120500). Creating notifications is not here —
 * that is server fan-out, see src/server/notifications.
 */
export const notificationsRepository = {
  async recent(limit = 20): Promise<AppNotification[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("notifications")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as AppNotification[]) ?? [];
  },

  async page(params: {
    page: number;
    pageSize: number;
    unreadOnly?: boolean;
  }): Promise<PageResult<AppNotification>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);
    let query = supabase
      .from("notifications")
      .select(SELECT, { count: "exact" })
      .order("created_at", { ascending: false });
    if (params.unreadOnly) query = query.is("read_at", null);
    const { data, count } = await query.range(from, to);
    return {
      rows: (data as AppNotification[]) ?? [],
      total: count ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  async unreadCount(): Promise<number> {
    const supabase = await createClient();
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    return count ?? 0;
  },

  /** Mark the given ids (or, with null, everything) read. Returns rows changed. */
  async markRead(
    ids: readonly string[] | null,
  ): Promise<{ count: number; error: string | null }> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mark_notifications_read", {
      p_ids: ids === null ? undefined : [...ids],
    });
    return { count: Number(data ?? 0), error: error?.message ?? null };
  },

  /** Delete the caller's already-read notifications. */
  async clearRead(): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("notifications")
      .delete()
      .not("read_at", "is", null);
    return { error: error?.message ?? null };
  },

  async registerPush(sub: PushSubscriptionInput): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("register_push_subscription", {
      p_endpoint: sub.endpoint,
      p_p256dh: sub.p256dh,
      p_auth: sub.auth,
      p_user_agent: sub.userAgent ?? undefined,
    });
    return { error: error?.message ?? null };
  },

  async unregisterPush(endpoint: string): Promise<{ error: string | null }> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("unregister_push_subscription", {
      p_endpoint: endpoint,
    });
    return { error: error?.message ?? null };
  },
};
