import { CalendarClock } from "lucide-react";
import { scheduleState } from "@/lib/domain/ticket-workflow";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TicketStatus } from "@/lib/types";

const TONE = {
  overdue: "text-red-700 dark:text-red-300",
  today: "text-amber-700 dark:text-amber-300",
  upcoming: "text-muted-foreground",
} as const;

/**
 * The visit date, flagged when an active ticket is due today or overdue.
 * `today` comes from the server (IST) so server and client render alike.
 */
export function ScheduleHint({
  status,
  scheduledDate,
  today,
  className,
}: {
  status: TicketStatus;
  scheduledDate: string | null;
  today: string;
  className?: string;
}) {
  if (!scheduledDate) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        Not scheduled
      </span>
    );
  }

  const schedule = scheduleState(status, scheduledDate, today);
  const note =
    schedule?.state === "overdue"
      ? ` · ${schedule.days} day${schedule.days === 1 ? "" : "s"} overdue`
      : schedule?.state === "today"
        ? " · today"
        : "";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        TONE[schedule?.state ?? "upcoming"],
        schedule && schedule.state !== "upcoming" && "font-medium",
        className,
      )}
    >
      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
      {formatDate(scheduledDate)}
      {note}
    </span>
  );
}
