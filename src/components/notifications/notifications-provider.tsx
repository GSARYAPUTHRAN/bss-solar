"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useLoading } from "@/lib/loading/loading-context";
import {
  getRecentNotifications,
  getUnreadCount,
  markNotificationsRead,
} from "@/app/(app)/notifications/actions";
import {
  internalLink,
  markReadLocally,
  parseNotificationRecord,
  prependNotification,
} from "@/lib/domain/notification-feed";
import type { AppNotification } from "@/lib/types";
import { reconcilePush } from "./push-device";
import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";

/** Focus/visibility re-syncs closer together than this are skipped. */
const RESYNC_MIN_INTERVAL_MS = 15_000;

/** A server action call that never got an answer (offline, a 500, a new deploy). */

interface NotificationsContextValue {
  unreadCount: number;
  /** The bell's recent list; null until the panel is first opened. */
  recent: AppNotification[] | null;
  recentStatus: "idle" | "loading" | "error";
  /** Ids read during this session (lets server-rendered lists catch up). */
  readIds: ReadonlySet<string>;
  /** Bumps on every successful "mark all read". */
  readAllEpoch: number;
  /** VAPID public key, or null when push is not configured on the server. */
  pushPublicKey: string | null;
  refreshRecent(): Promise<void>;
  /**
   * Mark read (optimistically) and go to the notification's link. 
   * defaults to the row's own read_at; lists that know better pass it.
   */
  open(notification: AppNotification, unread?: boolean): void;
  /** Returns whether it succeeded (errors are already toasted). */
  markAllRead(): Promise<boolean>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error("useNotifications must be used inside <NotificationsProvider>");
  }
  return value;
}

// Realtime reuses a channel whose topic already exists, and React StrictMode
// re-subscribes before the previous channel has finished leaving — so every
// subscription gets its own topic.
let channelSequence = 0;

/**
 * Client-side owner of the signed-in user's inbox state: the unread count the
 * bell shows, the recent list, and the live feed. Mounted once by the (app)
 * layout so the header bell and the /notifications page share one source of
 * truth and one Realtime subscription.
 */
export function NotificationsProvider({
  userId,
  initialUnread,
  pushPublicKey,
  children,
}: {
  userId: string;
  initialUnread: number;
  pushPublicKey: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const { trackStart } = useLoading();
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [recent, setRecent] = useState<AppNotification[] | null>(null);
  const [recentStatus, setRecentStatus] =
    useState<NotificationsContextValue["recentStatus"]>("idle");
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [readAllEpoch, setReadAllEpoch] = useState(0);
  // Mirrors readIds synchronously, so a double tap cannot decrement twice.
  const readIdsRef = useRef(new Set<string>());
  const lastSyncRef = useRef(0);
  // Bumped by every local change to the count (a live insert, a read). A server
  // count requested before one of them is stale when it lands, so it is dropped
  // rather than undoing the change.
  const changeRef = useRef(0);

  // The layout re-renders with a fresh server count after router.refresh() or
  // a server action that revalidates it; adopt it when it changes.
  const [seenInitial, setSeenInitial] = useState(initialUnread);
  if (initialUnread !== seenInitial) {
    setSeenInitial(initialUnread);
    setUnreadCount(initialUnread);
  }

  // A server action call rejects when its request never completes (offline, a
  // 500, a new deploy). These calls run from effects and event handlers where
  // nothing else would catch that, so each one does; unstable_rethrow passes a
  // redirect (session expired) on to the router.

  const resync = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastSyncRef.current < RESYNC_MIN_INTERVAL_MS) return;
    lastSyncRef.current = now;
    const started = changeRef.current;
    try {
      const result = await getUnreadCount();
      if (result.ok && changeRef.current === started) setUnreadCount(result.data);
    } catch (error) {
      unstable_rethrow(error);
      // Only a refresh of the badge: the next focus or live event tries again.
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    setRecentStatus("loading");
    const started = changeRef.current;
    let result: Awaited<ReturnType<typeof getRecentNotifications>>;
    try {
      result = await getRecentNotifications();
    } catch (error) {
      unstable_rethrow(error);
      setRecentStatus("error");
      return;
    }
    if (!result.ok) {
      setRecentStatus("error");
      return;
    }
    lastSyncRef.current = Date.now();
    setRecent(result.data.items);
    if (changeRef.current === started) setUnreadCount(result.data.unreadCount);
    setRecentStatus("idle");
  }, []);

  const markRead = useCallback(
    (notification: AppNotification, unread = notification.read_at === null) => {
      const { id } = notification;
      if (!unread || readIdsRef.current.has(id)) return;
      readIdsRef.current.add(id);
      changeRef.current += 1;
      setReadIds(new Set(readIdsRef.current));
      setUnreadCount((count) => Math.max(0, count - 1));
      setRecent((list) => list && markReadLocally(list, [id], new Date().toISOString()));

      // Low stakes: if it did not stick, just show the server's truth again.
      void markNotificationsRead([id])
        .then((result) => {
          if (!result.ok) void resync(true);
        })
        .catch((error: unknown) => {
          unstable_rethrow(error);
          void resync(true);
        });
    },
    [resync],
  );

  const open = useCallback(
    (notification: AppNotification, unread?: boolean) => {
      markRead(notification, unread);
      const link = internalLink(notification.link);
      if (!link) return;
      // Already there (e.g. a new payment on the open project): re-fetch it
      // instead of a same-URL push, which would leave the loader spinning.
      if (link === window.location.pathname + window.location.search) {
        router.refresh();
        return;
      }
      trackStart();
      router.push(link);
    },
    [markRead, router, trackStart],
  );

  const markAllRead = useCallback(async () => {
    const started = changeRef.current;
    let result: Awaited<ReturnType<typeof markNotificationsRead>>;
    try {
      result = await markNotificationsRead(null);
    } catch (error) {
      unstable_rethrow(error);
      toast.error(SERVER_UNREACHABLE_MESSAGE);
      return false;
    }
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    // Something arrived while the server was marking: it may still be unread,
    // so ask for the real count instead of assuming zero.
    const raced = changeRef.current !== started;
    changeRef.current += 1;
    if (raced) void resync(true);
    else setUnreadCount(0);
    setRecent((list) => list && markReadLocally(list, null, new Date().toISOString()));
    setReadAllEpoch((epoch) => epoch + 1);
    return true;
  }, [resync]);

  const onInsert = useEffectEvent((notification: AppNotification) => {
    changeRef.current += 1;
    setUnreadCount((count) => count + 1);
    setRecent((list) => list && prependNotification(list, notification));
    if (document.visibilityState !== "visible") return;
    toast(notification.title, {
      description: notification.body ?? undefined,
      action: internalLink(notification.link)
        ? { label: "View", onClick: () => open(notification) }
        : undefined,
    });
  });

  const onSubscribed = useEffectEvent(() => {
    // Anything inserted while the socket was down (phones drop it in the
    // background) never arrives as an event — re-read the count instead.
    void resync(true);
  });

  useEffect(() => {
    const supabase = createClient();
    channelSequence += 1;
    const channel = supabase
      .channel(`notifications:${userId}:${channelSequence}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const notification = parseNotificationRecord(payload.new);
          if (notification && notification.recipient_id === userId) onInsert(notification);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") onSubscribed();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === "visible") void resync();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [resync]);

  useEffect(() => {
    if (pushPublicKey) void reconcilePush(pushPublicKey);
  }, [pushPublicKey]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unreadCount,
      recent,
      recentStatus,
      readIds,
      readAllEpoch,
      pushPublicKey,
      refreshRecent,
      open,
      markAllRead,
    }),
    [
      unreadCount,
      recent,
      recentStatus,
      readIds,
      readAllEpoch,
      pushPublicKey,
      refreshRecent,
      open,
      markAllRead,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}
