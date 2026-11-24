"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Picks the report's month. Choosing one navigates (`?month=YYYY-MM`), so the
 * month is in the URL and a report can be bookmarked or shared.
 */
export function ReportMonthPicker({
  month,
  options,
}: {
  month: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    if (next === month) return;
    startTransition(() => {
      router.push(`${pathname}?month=${encodeURIComponent(next)}`, { scroll: false });
    });
  }

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <span id="report-month-label" className="shrink-0 text-sm font-medium">
        Month
      </span>
      <Select value={month} onValueChange={choose}>
        <SelectTrigger
          aria-labelledby="report-month-label"
          className="w-full data-[size=default]:h-10 sm:w-60 sm:data-[size=default]:h-9"
        >
          {/* The label is given directly, so the box is filled before hydration. */}
          <SelectValue>{options.find((o) => o.value === month)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && (
        <Loader2
          aria-label="Loading the report"
          className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}
