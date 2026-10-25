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

/** "3 kW", "3.5 kW" — trailing zeros trimmed. */
export function formatKw(kw: number | string | null | undefined): string {
  const n = Number(kw);
  if (kw === null || kw === undefined || !Number.isFinite(n)) return "—";
  return `${Number(n.toFixed(2))} kW`;
}
