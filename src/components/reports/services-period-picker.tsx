"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_TIME, type PeriodOption } from "@/lib/domain/service-report";

/** The Services report's own route. */
export const SERVICES_REPORT_PATH = "/reports/services";

/** Where a picked period lives: in the URL, so it can be shared and reloaded. */
export function servicesReportHref(value: string): string {
  return `${SERVICES_REPORT_PATH}?month=${encodeURIComponent(value)}`;
}

/**
 * Month (or "All time") picker for the Services report. Picking one navigates;
 * the new choice shows at once and a spinner runs until the page has the new
 * figures.
 */
export function ServicesPeriodPicker({
  value,
  options,
}: {
  /** The selected `?month=` value: `YYYY-MM` or "all". */
  value: string;
  /** "All time" first, then months newest first (see `periodOptions`). */
  options: PeriodOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(value);

  function pick(next: string) {
    if (next === shown) return;
    startTransition(() => {
      setShown(next);
      router.push(servicesReportHref(next), { scroll: false });
    });
  }

  const allTime = options.filter((o) => o.value === ALL_TIME);
  const months = options.filter((o) => o.value !== ALL_TIME);

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <Select value={shown} onValueChange={pick}>
        <SelectTrigger
          aria-label="Period"
          className="w-full data-[size=default]:h-10 sm:w-60"
        >
          {/* The label is given directly, so the box is filled before hydration. */}
          <SelectValue>{options.find((o) => o.value === shown)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allTime.map((o) => (
            <SelectItem key={o.value} value={o.value} className="min-h-10">
              {o.label}
            </SelectItem>
          ))}
          {allTime.length > 0 && months.length > 0 && <SelectSeparator />}
          {months.map((o) => (
            <SelectItem key={o.value} value={o.value} className="min-h-10">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-live="polite" className="flex h-4 w-4 shrink-0 items-center">
        {pending && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
        )}
      </span>
    </div>
  );
}
