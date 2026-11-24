import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import {
  formatKw,
  type Better,
  type FigureFormat,
  type Growth,
} from "@/lib/domain/reports";

/** A report figure as shown on screen: ₹ for money, kW for capacity, a plain count otherwise. */
/** A headline card's big figure: rupees without paise, so it fits the card. */
export function formatHeadline(value: number, format: FigureFormat): string {
  return format === "money" ? formatCurrencyWhole(value) : formatFigure(value, format);
}

export function formatFigure(value: number, format: FigureFormat): string {
  if (format === "money") return formatCurrency(value);
  if (format === "kw") return formatKw(value);
  return value.toLocaleString("en-IN");
}

export type GrowthTone = "good" | "bad" | "flat";

/**
 * Whether a change is good news: up is good for sales, down is good for
 * cancellations, and some figures (incentives paid) are neither. "new", "—" and
 * a 0.0% change are flat.
 */
export function growthTone(g: Growth, better: Better): GrowthTone {
  if (g === null || better === "neutral") return "flat";
  const up = g.kind === "new" || g.pct > 0;
  const down = g.kind === "change" && g.pct < 0;
  if (!up && !down) return "flat";
  return up === (better === "up") ? "good" : "bad";
}

export const TONE_CLASS: Record<GrowthTone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  flat: "text-muted-foreground",
};
