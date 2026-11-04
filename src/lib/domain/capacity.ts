/**
 * Plant capacity is captured as a free-text label ("3kW", "5 kWp", "3000 W")
 * because that is how field staff write it. KSEB registration is priced per
 * kW, so the number behind the label matters.
 *
 * `parseCapacityKw` mirrors the SQL function `parse_capacity_kw()` that backs
 * the generated column `work_orders.plant_capacity_kw` — the integration suite
 * pins the two together. Rules:
 *   - the FIRST number in the label is the capacity;
 *   - a `W` / `Wp` unit means watts (÷ 1000);
 *   - `kW`, `kWp`, `k` or no unit means kilowatts;
 *   - thousands separators are ignored;
 *   - rounded to 2 decimals; null when the label holds no number.
 */
import { round2 } from "./rounding";

const CAPACITY_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*(kwp|kw|k|wp|w)?/;

export function parseCapacityKw(label: string | null | undefined): number | null {
  if (label === null || label === undefined) return null;
  const match = CAPACITY_PATTERN.exec(label.toLowerCase().replaceAll(",", ""));
  if (!match) return null;

  let kw = Number(match[1]);
  if (match[2] === "w" || match[2] === "wp") kw /= 1000;
  return round2(kw);
}

/** True when the label yields a usable, positive capacity. */
export function isValidCapacity(label: string | null | undefined): boolean {
  const kw = parseCapacityKw(label);
  return kw !== null && kw > 0;
}

/** What the capacity field says when a solar label is not a kW capacity. */
export const CAPACITY_PROBLEM =
  "Write the capacity like 3kW — or choose Custom plan if this sale is not a kW solar plant.";

/**
 * Why a SOLAR plan's label is not accepted as a capacity, or null when it is.
 *
 * `parseCapacityKw` takes the first number as kilowatts even without a unit, so
 * "1 panel" silently became a 1 kW plant (and a ₹1,180 KSEB registration). A
 * label must therefore put a unit on its first number — "3kW", "5 kWp",
 * "3000W", "3kW+inverter" — or be a bare number ("3", "3.5"). Same reading as
 * `parseCapacityKw`: case-insensitive, thousands separators ignored, and the
 * result must still be a positive capacity.
 *
 * Applies to new and changed labels only: a label equal to `previous` (the
 * one already stored) passes, so an old row saved before this rule can still
 * be edited without retyping its capacity.
 */
export function capacityProblem(
  label: string,
  opts: { previous?: string | null } = {},
): string | null {
  const text = label.trim();
  if (opts.previous != null && text === opts.previous.trim()) return null;

  const match = CAPACITY_PATTERN.exec(text.toLowerCase().replaceAll(",", ""));
  if (!match || !isValidCapacity(text)) return CAPACITY_PROBLEM;
  const bareNumber = text.toLowerCase().replaceAll(",", "") === match[1];
  return match[2] || bareNumber ? null : CAPACITY_PROBLEM;
}

/** One term of a capacity sum: a number with its unit — "3kW", "500 Wp". */
const CAPACITY_TERM = /^([0-9]+(?:\.[0-9]+)?)\s*(kwp|kw|k|wp|w)$/;

/**
 * A label that adds capacities up — "3kW+2kW" — read as their total: `5kW`.
 * Every `+`-separated term must itself be a quantity with a unit (kW, kWp, k, W
 * or Wp), so "3kW+inverter" and "3+2" are NOT sums: they keep the reading
 * `parseCapacityKw` gives them (the first number). Null for anything else, and
 * for a total that is not above zero.
 */
export function capacitySum(
  label: string | null | undefined,
): { kw: number; label: string } | null {
  if (label === null || label === undefined) return null;
  const terms = label.toLowerCase().replaceAll(",", "").split("+");
  if (terms.length < 2) return null;

  let kw = 0;
  for (const term of terms) {
    const match = CAPACITY_TERM.exec(term.trim());
    if (!match) return null;
    const unit = match[2];
    kw += unit === "w" || unit === "wp" ? Number(match[1]) / 1000 : Number(match[1]);
  }
  const total = round2(kw);
  return total > 0 ? { kw: total, label: `${total}kW` } : null;
}

/** "3 kW", "3.5 kW" — trailing zeros trimmed. */
export function formatKw(kw: number | string | null | undefined): string {
  const n = Number(kw);
  if (kw === null || kw === undefined || !Number.isFinite(n)) return "—";
  return `${Number(n.toFixed(2))} kW`;
}
