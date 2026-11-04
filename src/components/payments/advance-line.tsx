import { advanceSummary, type AdvanceDetails } from "@/lib/domain/advance";
import { cn } from "@/lib/utils";

/**
 * The booking advance on one line — "Advance ₹50,000.00 · UPI · 04 Feb 2025 ·
 * UTR 1" — above the ledger it opens (the advance is stage 0, a work-order
 * field rather than a ledger row). What was not recorded is left out; nothing is
 * shown at all when there was no advance and nothing is said about one.
 */
export function AdvanceLine({
  amount,
  details,
  className,
}: {
  amount: number;
  details?: Partial<AdvanceDetails>;
  className?: string;
}) {
  const line = advanceSummary(amount, details ?? {});
  if (!line) return null;
  return <p className={cn("break-words text-sm text-muted-foreground", className)}>{line}</p>;
}
