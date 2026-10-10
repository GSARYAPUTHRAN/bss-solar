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

/** "3 kW", "3.5 kW" — trailing zeros trimmed. */
export function formatKw(kw: number | string | null | undefined): string {
  const n = Number(kw);
  if (kw === null || kw === undefined || !Number.isFinite(n)) return "—";
  return `${Number(n.toFixed(2))} kW`;
}
