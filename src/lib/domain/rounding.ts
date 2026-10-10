/**
 * Round to 2 decimal places exactly as Postgres `round(numeric, 2)` does:
 * decimal half-away-from-zero.
 *
 * Doing this on binary floats needs care. `Math.round(x * 100) / 100` (even with
 * an EPSILON nudge) rounds the wrong way whenever the multiplication lands just
 * below a half — e.g. 8.325 kW (15 × 555 Wp) became 8.32 while the database
 * stored 8.33. Formatting to 6 decimals recovers the decimal the value was
 * entered as (every input here carries ≤ 4 decimals, so float error at the
 * 1e-15 scale can never reach the 6th place), and shifting by a string exponent
 * avoids a second binary multiplication.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return value;
  const scaled = Math.round(Number(`${Math.abs(value).toFixed(6)}e2`));
  if (scaled === 0) return 0; // never -0
  return Math.sign(value) * Number(`${scaled}e-2`);
}
