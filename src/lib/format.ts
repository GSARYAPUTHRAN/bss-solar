/**
 * Today's date as YYYY-MM-DD in the given IANA time zone (defaults to India).
 * Avoids the toISOString() off-by-one where an early-morning IST timestamp
 * resolves to the previous UTC day. en-CA formats as ISO (YYYY-MM-DD).
 */
export function todayISO(timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

export function formatCurrency(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Whole rupees (₹1,25,000), for summary figures that must stay short — e.g.
 * three totals across a 360px phone. Amounts in a ledger stay exact.
 */
export function formatCurrencyWhole(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

/**
 * Dates and times are shown in India time regardless of where the code runs.
 * The server (Vercel) runs in UTC, so without an explicit zone an instant after
 * 18:30 UTC rendered as the previous day on the server and as the right day in
 * the browser — wrong in print and a hydration mismatch in client components.
 * A date-only value ("2026-10-10") parses as UTC midnight, which is 05:30 IST on
 * the same day, so plain dates are unaffected.
 */
const DISPLAY_TIME_ZONE = "Asia/Kolkata";

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(d);
}
