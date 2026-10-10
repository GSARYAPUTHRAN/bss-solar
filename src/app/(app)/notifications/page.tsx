import Link from "next/link";
import { BellRing, Inbox } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { notificationsRepository } from "@/server/data";
import { NOTIFICATIONS_PAGE_SIZE } from "@/lib/domain/notification-feed";
import { EmptyState, Page, PageHeader, Section } from "@/components/layout";
import { NotificationFeed } from "@/components/notifications/notification-feed";
import { NotificationsPager } from "@/components/notifications/notifications-pager";
import { NotificationsToolbar } from "@/components/notifications/notifications-toolbar";
import { PushToggle } from "@/components/notifications/push-toggle";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor({ page, unreadOnly }: { page: number; unreadOnly: boolean }): string {
  const params = new URLSearchParams();
  if (unreadOnly) params.set("unread", "1");
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/notifications?${qs}` : "/notifications";
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireProfile();
  const sp = await searchParams;
  const unreadOnly = first(sp.unread) === "1";
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  const result = await notificationsRepository.page({
    page,
    pageSize: NOTIFICATIONS_PAGE_SIZE,
    unreadOnly,
  });
  // Rendered once on the server and handed to the client list, so relative
  // times ("5 min ago") hydrate without a mismatch.
  const now = Date.now();

  return (
    <Page size="narrow">
      <PageHeader
        title="Notifications"
        description="Alerts about your work orders, projects, payments, service tickets and KSEB deadlines."
      >
        <NotificationsToolbar />
      </PageHeader>

      <Section
        title="Push notifications"
        description="Get alerts on this device even when the app is closed. Set this up on each phone or computer you use."
        icon={BellRing}
      >
        <PushToggle variant="card" />
      </Section>

      <div className="space-y-3">
        <FilterTabs unreadOnly={unreadOnly} />

        {result.rows.length === 0 ? (
          // An empty page after the first is a stale ?page= (e.g. after
          // clearing or marking all read); the pager below still has the real
          // total, so the way back is offered.
          <FeedEmpty unreadOnly={unreadOnly} pastTheEnd={page > 1} />
        ) : (
          <NotificationFeed rows={result.rows} now={now} />
        )}

        <NotificationsPager
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          hrefFor={(p) => hrefFor({ page: p, unreadOnly })}
        />
      </div>
    </Page>
  );
}

function FeedEmpty({
  unreadOnly,
  pastTheEnd,
}: {
  unreadOnly: boolean;
  /** A stale ?page= beyond the last page (e.g. after clearing). */
  pastTheEnd: boolean;
}) {
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className="inline-flex h-10 items-center text-sm font-medium text-primary hover:underline"
    >
      {label}
    </Link>
  );

  if (pastTheEnd) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing on this page"
        action={link(hrefFor({ page: 1, unreadOnly }), "Go to the first page")}
      />
    );
  }
  if (unreadOnly) {
    return (
      <EmptyState
        icon={Inbox}
        title="No unread notifications"
        description="You’re all caught up."
        action={link(hrefFor({ page: 1, unreadOnly: false }), "Show all notifications")}
      />
    );
  }
  return (
    <EmptyState
      icon={Inbox}
      title="No notifications yet"
      description="Alerts about your work will appear here as they happen."
    />
  );
}

function FilterTabs({ unreadOnly }: { unreadOnly: boolean }) {
  const tabs = [
    { label: "All", active: !unreadOnly, href: hrefFor({ page: 1, unreadOnly: false }) },
    { label: "Unread", active: unreadOnly, href: hrefFor({ page: 1, unreadOnly: true }) },
  ];
  return (
    <nav aria-label="Filter notifications" className="inline-flex rounded-lg border bg-muted/50 p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "inline-flex h-10 min-w-20 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors",
            tab.active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
