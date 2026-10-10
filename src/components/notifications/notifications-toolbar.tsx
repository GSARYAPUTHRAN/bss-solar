"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { CheckCheck, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearReadNotifications } from "@/app/(app)/notifications/actions";
import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";
import { useNotifications } from "./notifications-provider";

/** Bulk actions for /notifications. */
export function NotificationsToolbar() {
  const router = useRouter();
  const { unreadCount, markAllRead } = useNotifications();
  const [markingAll, setMarkingAll] = useState(false);
  const [clearing, startClearing] = useTransition();

  async function onMarkAll() {
    setMarkingAll(true);
    try {
      if (await markAllRead()) {
        toast.success("All notifications marked as read.");
        // The rows already show as read; refresh so an "Unread" view empties.
        router.refresh();
      }
    } finally {
      setMarkingAll(false);
    }
  }

  function onClearRead() {
    startClearing(async () => {
      try {
        const result = await clearReadNotifications();
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Read notifications cleared.");
        router.refresh();
      } catch (error) {
        // A failed request would otherwise reach the error page; a redirect
        // (session expired) still goes to the router.
        unstable_rethrow(error);
        toast.error(SERVER_UNREACHABLE_MESSAGE);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-10"
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
      <Button
        type="button"
        variant="outline"
        className="h-10"
        onClick={onClearRead}
        disabled={clearing}
      >
        {clearing ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <Trash2 data-icon="inline-start" />
        )}
        Clear read
      </Button>
    </>
  );
}
