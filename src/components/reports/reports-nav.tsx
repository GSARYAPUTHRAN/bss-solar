"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** The Reports sub-pages, in tab order. */
export const REPORT_TABS = [
  { href: "/reports", label: "Monthly report" },
  { href: "/reports/services", label: "Services" },
] as const;

/**
 * Which tab a path belongs to. The monthly report owns `/reports` exactly;
 * every other tab owns its path and anything below it.
 */
export function activeReportTab(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/reports") return "/reports";
  const tab = REPORT_TABS.find(
    (t) => t.href !== "/reports" && (path === t.href || path.startsWith(`${t.href}/`)),
  );
  return tab?.href ?? null;
}

/**
 * Tab-styled links between the Reports pages. They are real links (each tab is
 * its own route with its own period in the URL), so this is a `nav` with
 * `aria-current`, not an ARIA tablist.
 */
export function ReportsNav() {
  const active = activeReportTab(usePathname());

  return (
    <nav aria-label="Reports" className="max-w-full overflow-x-auto">
      <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        {REPORT_TABS.map((tab) => {
          const current = tab.href === active;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current
                  ? "bg-background text-foreground shadow-sm dark:bg-input/30"
                  : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
