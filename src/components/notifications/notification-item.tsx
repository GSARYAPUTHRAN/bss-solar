"use client";

import { absoluteTime, relativeTime } from "@/lib/domain/notification-feed";
import type { AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";
import { categoryMeta } from "./categories";

/**
 * One inbox row, shared by the bell panel and /notifications. The whole row is
 * a single ≥56px button (thumb-friendly); unread rows are bold with a dot.
 * `now` is passed in so server and client render the same relative time.
 */
export function NotificationItem({
  notification,
  unread,
  now,
  onOpen,
  className,
}: {
  notification: AppNotification;
  unread: boolean;
  now: number;
  onOpen: (notification: AppNotification) => void;
  className?: string;
}) {
  const meta = categoryMeta(notification.type);
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn(
        "flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        unread && "bg-primary/[0.04]",
        className,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
          meta.toneClass,
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">{unread ? "Unread: " : ""}{meta.label}. </span>
        <span
          className={cn(
            "block text-sm leading-snug break-words",
            unread ? "font-semibold text-foreground" : "font-medium text-foreground/80",
          )}
        >
          {notification.title}
        </span>
        {notification.body && (
          <span className="mt-0.5 line-clamp-2 block text-xs break-words text-muted-foreground">
            {notification.body}
          </span>
        )}
        <time
          dateTime={notification.created_at}
          title={absoluteTime(notification.created_at)}
          className="mt-1 block text-[11px] text-muted-foreground"
        >
          {relativeTime(notification.created_at, now)}
        </time>
      </span>
      {unread && (
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
      )}
    </button>
  );
}
