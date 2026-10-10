"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { bellAriaLabel, unreadBadgeText } from "@/lib/domain/notification-feed";
import type { AppNotification } from "@/lib/types";
import { NotificationItem } from "./notification-item";
import { useNotifications } from "./notifications-provider";
import { PushToggle } from "./push-toggle";

/**
 * Header bell with the unread badge, opening a compact panel ("small tab") of
 * the most recent notifications. The list is re-read on every open, so it is
 * never stale even when the live feed dropped while the phone was asleep.
 */
export function NotificationBell() {
  const { unreadCount, recent, recentStatus, refreshRecent, open, markAllRead } =
    useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  // Captured when the panel opens: relative times only need minute precision.
  const [now, setNow] = useState(0);
  const badge = unreadBadgeText(unreadCount);

  function onOpenChange(next: boolean) {
    setIsOpen(next);
    if (next) {
      setNow(Date.now());
      void refreshRecent();
    }
  }

  function onItem(notification: AppNotification) {
    setIsOpen(false);
    open(notification);
  }

  async function onMarkAll() {
    setMarkingAll(true);
    try {
      await markAllRead();
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-10"
          aria-label={bellAriaLabel(unreadCount)}
        >
          <Bell className="size-5" />
          {badge && (
            <span
              className="absolute top-1 right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-background dark:bg-red-500"
              aria-hidden
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="flex w-[min(92vw,380px)] flex-col overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button
            type="button"
            variant="ghost"
            className="h-10 px-3 text-xs"
            onClick={onMarkAll}
            disabled={unreadCount === 0 || markingAll}
          >
            {markingAll ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <CheckCheck data-icon="inline-start" />
            )}
            Mark all read
          </Button>
        </div>

        <div className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain">
          <PanelBody
            items={recent}
            status={recentStatus}
            now={now}
            onItem={onItem}
            onRetry={() => void refreshRecent()}
          />
        </div>

        <div className="space-y-2 border-t bg-muted/30 px-4 py-3">
          <PushToggle variant="compact" />
          <Button asChild variant="outline" className="h-10 w-full">
            <Link href="/notifications" onClick={() => setIsOpen(false)}>
              View all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PanelBody({
  items,
  status,
  now,
  onItem,
  onRetry,
}: {
  items: AppNotification[] | null;
  status: "idle" | "loading" | "error";
  now: number;
  onItem: (notification: AppNotification) => void;
  onRetry: () => void;
}) {
  if (items === null) {
    if (status === "error") {
      return (
        <div className="space-y-2 px-4 py-8 text-center text-sm text-muted-foreground">
          <p>Could not load notifications.</p>
          <Button type="button" variant="outline" className="h-10" onClick={onRetry}>
            Try again
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Inbox className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">You’re all caught up</p>
        <p className="text-xs text-muted-foreground">New alerts will show up here.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y" aria-label="Recent notifications">
      {items.map((n) => (
        <li key={n.id}>
          <NotificationItem
            notification={n}
            unread={n.read_at === null}
            now={now}
            onOpen={onItem}
          />
        </li>
      ))}
    </ul>
  );
}
