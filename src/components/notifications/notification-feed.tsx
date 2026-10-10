"use client";

import { useState } from "react";
import type { AppNotification } from "@/lib/types";
import { NotificationItem } from "./notification-item";
import { useNotifications } from "./notifications-provider";

/**
 * The /notifications list. Rows are server-rendered for the requested page;
 * read state then follows the shared client inbox, so a tap here or "Mark all
 * read" in the bell is reflected at once without re-fetching the page.
 */
export function NotificationFeed({
  rows,
  now,
}: {
  rows: AppNotification[];
  /** Server time of the render, so relative times hydrate identically. */
  now: number;
}) {
  const { readIds, readAllEpoch, open } = useNotifications();

  // "Mark all read" covers every row loaded before it; a fresh page from the
  // server (new `rows`) already carries the real read state.
  const [baseline, setBaseline] = useState({ rows, epoch: readAllEpoch });
  if (baseline.rows !== rows) setBaseline({ rows, epoch: readAllEpoch });
  const allRead = readAllEpoch > baseline.epoch;

  return (
    <ul className="divide-y overflow-hidden rounded-lg border bg-card" aria-label="Notifications">
      {rows.map((row) => {
        const unread = row.read_at === null && !allRead && !readIds.has(row.id);
        return (
          <li key={row.id}>
            <NotificationItem
              notification={row}
              unread={unread}
              now={now}
              // Pass the state as displayed, so a row already read here is not
              // counted down a second time.
              onOpen={(n) => open(n, unread)}
            />
          </li>
        );
      })}
    </ul>
  );
}
