import { cn } from "@/lib/utils";
import type { Better, Growth } from "@/lib/domain/reports";
import { TONE_CLASS, growthTone } from "./report-format";

/**
 * A change as "▲ 12.5%", "▼ 3.0%", "new" or "—", coloured by whether it is good
 * news. The arrow is hidden from screen readers, which hear "up" / "down".
 */
export function GrowthText({
  growth,
  better = "up",
  className,
}: {
  growth: Growth;
  better?: Better;
  className?: string;
}) {
  const tone = TONE_CLASS[growthTone(growth, better)];
  if (growth === null) {
    return (
      <span className={cn(tone, className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">no change to compare</span>
      </span>
    );
  }
  if (growth.kind === "new") return <span className={cn(tone, className)}>new</span>;

  const { pct } = growth;
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : null;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", tone, className)}>
      {arrow && (
        <>
          <span aria-hidden>{arrow} </span>
          <span className="sr-only">{pct > 0 ? "up " : "down "}</span>
        </>
      )}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
