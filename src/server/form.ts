/** Trimmed string, or `null` when empty. */
export function str(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

/** Trimmed string, or "" when empty (for required text fields). */
export function text(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

/** Integer, or `null` when empty/invalid. */
export function int(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** Decimal, or `null` when empty/invalid. */
export function dec(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Number with a `0` fallback (for required numeric fields). */
export function num(v: FormDataEntryValue | null): number {
  return dec(v) ?? 0;
}

/** Parse a JSON field, returning `fallback` on any error. */
export function json<T>(v: FormDataEntryValue | null, fallback: T): T {
  try {
    return JSON.parse(String(v ?? "")) as T;
  } catch {
    return fallback;
  }
}

/** Cast a form value to a known string-literal union with a default. */
export function enumValue<T extends string>(
  v: FormDataEntryValue | null,
  fallback: T,
): T {
  const s = String(v ?? "").trim();
  return (s || fallback) as T;
}
