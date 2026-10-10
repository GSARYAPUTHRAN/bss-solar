import { createClient } from "@/lib/supabase/server";
import { fetchCountedPage, rangeFor, type PageResult } from "@/lib/pagination";
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
  /** Throws on a failed read, so the UI can offer a retry instead of "all caught up". */
  async recent(limit = 20): Promise<AppNotification[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not load notifications: ${error.message}`);
    return (data as AppNotification[]) ?? [];
  },

  /**
   * One page of the inbox. A page past the end (e.g. after "Mark all read" on
   * page 2 of the unread filter) comes back empty with the real total; a failed
   * read throws.
   */
  async page(params: {
    page: number;
    pageSize: number;
    unreadOnly?: boolean;
  }): Promise<PageResult<AppNotification>> {
    const supabase = await createClient();
    const [from, to] = rangeFor(params.page, params.pageSize);
    const filtered = (head: boolean) => {
      const query = supabase
        .from("notifications")
        .select(SELECT, { count: "exact", head });
      return params.unreadOnly ? query.is("read_at", null) : query;
    };
    const { rows, total } = await fetchCountedPage(
      {
        rows: () =>
          filtered(false).order("created_at", { ascending: false }).range(from, to),
        countOnly: () => filtered(true),
      },
      "notifications",
    );
    return {
      rows: rows as AppNotification[],
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  },

  /**
   * Best-effort by design: it feeds the header badge on EVERY page, so a failed
   * read degrades to 0 (and is logged) rather than taking the app down. The
   * bell re-syncs on focus and on every realtime insert.
   */
  async unreadCount(): Promise<number> {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (error) {
      console.error(`[notifications] unread count failed: ${error.message}`);
      return 0;
    }
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
