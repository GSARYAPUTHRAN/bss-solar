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

/** `D/M/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY` or `D/M/YY` — one separator, used twice. */
const DAY_FIRST_DATE = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})$/;
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** What a date typed into a sheet turned out to be. */
export type DateTextResult =
  | {
      ok: true;
      iso: string;
      /** Read as day / month / year (anything but plain ISO). */
      dayFirst: boolean;
    }
  | {
      ok: false;
      /**
       * `unreadable`: not shaped like a date at all. `not_real`: shaped like one,
       * but no such day (31/04/2025, 2025-02-30).
       */
      problem: "unreadable" | "not_real";
      /**
       * A day-first date that is not real but would be with day and month
       * swapped (02/13/2025 → 2025-02-13), for "did you mean" only — it is
       * never accepted.
       */
      swapped: string | null;
    };

/** 00–69 → 2000–2069, 70–99 → 1970–1999. */
function fullYear(twoDigits: number): number {
  return twoDigits < 70 ? 2000 + twoDigits : 1900 + twoDigits;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function isoOf(year: number, month: number, day: number): string | null {
  const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Read a date as people write it in a sheet. Dates are DAY FIRST, always — never
 * US order, so 04/02/2025 is 4 February. Accepted: `YYYY-MM-DD`, `D/M/YYYY`,
 * `DD-MM-YYYY`, `DD.MM.YYYY` and `D/M/YY` (a two-digit year of 00–69 is 20xx,
 * 70–99 is 19xx), with surrounding spaces ignored. One separator only: a mix
 * like 13/02-2025 is not a date.
 */
export function parseDateText(text: string): DateTextResult {
  const s = text.trim();
  if (ISO_SHAPE.test(s)) {
    return isIsoDate(s)
      ? { ok: true, iso: s, dayFirst: false }
      : { ok: false, problem: "not_real", swapped: null };
  }
  const m = DAY_FIRST_DATE.exec(s);
  if (!m) return { ok: false, problem: "unreadable", swapped: null };

  const [day, month] = [Number(m[1]), Number(m[3])];
  const year = m[4].length === 2 ? fullYear(Number(m[4])) : Number(m[4]);
  const iso = isoOf(year, month, day);
  if (iso) return { ok: true, iso, dayFirst: true };
  return { ok: false, problem: "not_real", swapped: isoOf(year, day, month) };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** The calendar month of an ISO date, as `YYYY-MM`. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** `2025-02` → "February 2025". */
export function monthName(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
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
