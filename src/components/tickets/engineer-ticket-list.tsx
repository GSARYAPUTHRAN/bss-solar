import Link from "next/link";
import Form from "next/form";
import { ChevronLeft, ChevronRight, Search, Wrench } from "lucide-react";
import { EmptyState } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ENGINEER_TICKET_SCOPES,
  type EngineerTicketScope,
} from "@/lib/domain/ticket-workflow";
import { DEFAULT_PAGE_SIZE, type PageResult } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { EngineerTicketCard } from "./engineer-ticket-card";
import type { EngineerTicketRow } from "@/lib/types";

const SCOPES = Object.keys(ENGINEER_TICKET_SCOPES) as EngineerTicketScope[];

const EMPTY_COPY: Record<EngineerTicketScope, { title: string; description: string }> = {
  active: {
    title: "You're all caught up",
    description: "No open service tickets are assigned to you right now. New ones will appear here and in your notifications.",
  },
  completed: {
    title: "No completed tickets yet",
    description: "Tickets you mark completed are listed here.",
  },
  all: {
    title: "No service tickets yet",
    description: "When the office assigns you a ticket it will appear here.",
  },
};

/** `/tickets` with the given query; empty values are dropped. */
function ticketsHref(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `/tickets?${qs}` : "/tickets";
}

/**
 * A service engineer's worklist. Fully server-rendered (links and a GET search
 * form, no client table state) so it stays light and works on a patchy mobile
 * connection: scope tabs, search, a card per job, and simple paging.
 */
export function EngineerTicketList({
  result,
  scope,
  q,
  today,
}: {
  result: PageResult<EngineerTicketRow>;
  scope: EngineerTicketScope;
  q: string;
  today: string;
}) {
  const { rows, total, page, pageSize } = result;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  // Carried across tab/page links; a default page size stays out of the URL.
  const keep = {
    show: scope,
    q,
    size: pageSize === DEFAULT_PAGE_SIZE ? undefined : pageSize,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav
          aria-label="Ticket filter"
          className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto"
        >
          {SCOPES.map((value) => {
            const active = value === scope;
            return (
              <Link
                key={value}
                href={ticketsHref({ ...keep, show: value })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 flex-1 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors sm:flex-none",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ENGINEER_TICKET_SCOPES[value].label}
              </Link>
            );
          })}
        </nav>

        <Form action="/tickets" role="search" className="flex w-full gap-2 sm:max-w-sm">
          <input type="hidden" name="show" value={scope} />
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Ticket no. or client"
              aria-label="Search your tickets"
              className="h-10 pl-9"
            />
          </div>
          <Button type="submit" variant="outline" className="h-10">
            Search
          </Button>
        </Form>
      </div>

      {rows.length === 0 ? (
        total > 0 ? (
          // Past the last page, e.g. after closing the only ticket on it.
          <EmptyState
            icon={Wrench}
            title="Nothing on this page"
            action={
              <Button asChild variant="outline" className="h-10">
                <Link href={ticketsHref(keep)}>Back to the first page</Link>
              </Button>
            }
          />
        ) : q ? (
          <EmptyState
            icon={Search}
            title="No matching tickets"
            description={`Nothing matches “${q}” here. Try another ticket number or client name.`}
            action={
              <Button asChild variant="outline" className="h-10">
                <Link href={ticketsHref({ show: scope })}>Clear search</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Wrench} {...EMPTY_COPY[scope]} />
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((ticket) => (
            <li key={ticket.id}>
              <EngineerTicketCard ticket={ticket} today={today} />
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3"
        >
          <p className="text-xs text-muted-foreground">
            {first}–{last} of {total} ticket{total === 1 ? "" : "s"}
          </p>
          {pageCount > 1 && (
            <div className="flex gap-2">
              <PageLink
                href={ticketsHref({ ...keep, page: page - 1 })}
                disabled={page <= 1}
                label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </PageLink>
              <PageLink
                href={ticketsHref({ ...keep, page: page + 1 })}
                disabled={page >= pageCount}
                label="Next page"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </PageLink>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" className="size-10" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" className="size-10">
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  );
}
