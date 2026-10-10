/**
 * Calendar-date arithmetic on ISO `YYYY-MM-DD` strings.
 *
 * Business dates (order, feasibility, payment) are calendar days in India, not
 * instants, so they are handled as whole days in UTC space — never through a
 * local `Date`, whose time zone would shift them by a day around midnight.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Strict YYYY-MM-DD that is also a real calendar date (no 2026-02-30). */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value) return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
  );
}

function toEpochDay(iso: string): number {
  if (!isIsoDate(iso)) throw new RangeError(`Not an ISO date: "${iso}"`);
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

function fromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/**
 * The IST calendar date of an instant (e.g. a `timestamptz` from Postgres).
 * Mirrors `(ts at time zone 'Asia/Kolkata')::date`.
 */
export function istDateOf(instant: string | Date): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}
