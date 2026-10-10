import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Previous/next links for a server-paginated list. Plain links (no client JS),
 * so paging works on a slow phone before hydration and keeps the URL shareable.
 */
export function NotificationsPager({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-xs text-muted-foreground">
        Showing {start}–{end} of {total} · Page {current} of {pageCount}
      </p>
      <div className="flex items-center gap-2">
        <PagerLink href={current > 1 ? hrefFor(current - 1) : null} label="Previous">
          <ChevronLeft data-icon="inline-start" />
          Previous
        </PagerLink>
        <PagerLink href={current < pageCount ? hrefFor(current + 1) : null} label="Next">
          Next
          <ChevronRight data-icon="inline-end" />
        </PagerLink>
      </div>
    </nav>
  );
}

function PagerLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <Button type="button" variant="outline" className="h-10 flex-1 sm:flex-none" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" className="h-10 flex-1 sm:flex-none">
      <Link href={href} aria-label={`${label} page`}>
        {children}
      </Link>
    </Button>
  );
}
