import { cn } from "@/lib/utils";

const COLS = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
} as const;

/**
 * Responsive grid for laying out read-only `Field`s on detail pages.
 */
export function FieldGrid({
  cols = 2,
  className,
  children,
}: {
  cols?: keyof typeof COLS;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-x-6 gap-y-4", COLS[cols], className)}>
      {children}
    </div>
  );
}

/**
 * A labelled, read-only value. Falls back to an em dash when empty.
 */
export function Field({
  label,
  value,
  className,
}: {
  label: string;
  value?: React.ReactNode;
  className?: string;
}) {
  const empty =
    value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className={cn("space-y-0.5", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{empty}</dd>
    </div>
  );
}
