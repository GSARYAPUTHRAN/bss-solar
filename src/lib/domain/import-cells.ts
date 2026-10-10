import { PROJECT_STAGES, STAGE_LABELS } from "@/lib/constants";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  ProjectStage,
} from "@/lib/types";
import { isIsoDate } from "./dates";
import {
  FINANCING_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PURPOSE_LABELS,
} from "./payment";
import { closestMatch } from "./suggest";

/**
 * Parsers for single CSV cells of the onboarding import. Each returns
 * `{ ok: true, data }` or `{ ok: false, error }` with a message that names the
 * column and says how to fix it — the admin sees it next to the row.
 *
 * Blank optional cells are `null`, never a silent 0: a 0 would misstate a
 * balance. Spellings are forgiving (case, spaces, `-`/`_`, human labels) since
 * the sheet is typed by people; values are strict.
 */
export type Cell<T> = ActionResult<T>;

/** `numeric(12,2)` — the widest amount the money columns can hold. */
const MAX_AMOUNT = 9_999_999_999.99;

/** Case/spacing-insensitive key: "Bank-Transfer" → "bank transfer". */
export function spelling(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function textCell(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return s.length ? s : null;
}

/**
 * Rupees: digits with up to 2 decimals. Thousands separators, a ₹ sign and a
 * "Rs." prefix are tolerated because that is how amounts get typed.
 */
export function moneyCell(
  raw: string | undefined,
  column: string,
  { positive = false }: { positive?: boolean } = {},
): Cell<number | null> {
  const s = (raw ?? "").trim();
  if (!s) return ok(null);
  const digits = s.replace(/^rs\.?/i, "").replace(/[₹,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(digits)) {
    return fail(`${column} must be an amount in rupees, like 195000 (got "${s}")`);
  }
  if (/\.\d{3,}$/.test(digits)) {
    return fail(`${column} has more than 2 decimal places (got "${s}")`);
  }
  const n = Number(digits);
  if (n < 0) return fail(`${column} cannot be negative (got "${s}")`);
  if (positive && n === 0) return fail(`${column} must be more than zero`);
  if (n > MAX_AMOUNT) return fail(`${column} is too large (got "${s}")`);
  return ok(n);
}

/** "15/03/2026" or "15-3-2026" → "2026-03-15", for the hint only. */
function isoFromDayFirst(s: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Strict `YYYY-MM-DD` calendar date. A day-first date is NOT converted (03/04
 * is ambiguous) but the message offers the ISO form to copy. `notAfter` is the
 * caller's "today" — pure code never reads the clock.
 */
export function dateCell(
  raw: string | undefined,
  column: string,
  { notAfter }: { notAfter?: string } = {},
): Cell<string | null> {
  const s = (raw ?? "").trim();
  if (!s) return ok(null);
  if (!isIsoDate(s)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return fail(`${column} ${s} is not a real calendar date`);
    }
    const hint = isoFromDayFirst(s);
    return fail(
      `${column} must be written YYYY-MM-DD (got "${s}"${hint ? ` — did you mean ${hint}?` : ""})`,
    );
  }
  if (notAfter && s > notAfter) {
    return fail(`${column} ${s} is in the future`);
  }
  return ok(s);
}

const YES = new Set(["true", "yes", "y", "1"]);
const NO = new Set(["false", "no", "n", "0"]);

/** yes/no; `null` when blank so callers can tell "not said" from "no". */
export function booleanCell(
  raw: string | undefined,
  column: string,
): Cell<boolean | null> {
  const s = spelling(raw ?? "");
  if (!s) return ok(null);
  if (YES.has(s)) return ok(true);
  if (NO.has(s)) return ok(false);
  return fail(`${column} must be yes or no (got "${(raw ?? "").trim()}")`);
}

/** E-mail shaped (the database decides whether the account exists). */
export function emailCell(
  raw: string | undefined,
  column: string,
): Cell<string | null> {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return ok(null);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return fail(`${column} "${s}" is not an e-mail address`);
  }
  return ok(s);
}

/**
 * A long number kept as text (consumer number, phone). Excel silently rewrites
 * a 13-digit consumer number as 1.15679E+12 — the digits are gone, so refuse
 * it rather than import a wrong number.
 */
export function identifierCell(
  raw: string | undefined,
  column: string,
): Cell<string | null> {
  const s = textCell(raw);
  if (s && /^\d+(\.\d+)?e\+?\d+$/i.test(s)) {
    return fail(
      `${column} "${s}" was turned into scientific notation by Excel — format the column as Text and export again`,
    );
  }
  return ok(s);
}

// --- Enumerations -------------------------------------------------------------

/**
 * One enumeration's accepted spellings: the canonical key, its label, and
 * everyday aliases. `spellings` feeds the column reference on the page, so the
 * documentation cannot drift from what the parser accepts.
 */
class Vocabulary<K extends string> {
  private readonly bySpelling = new Map<string, K>();
  readonly spellings: Record<K, string[]>;

  constructor(labels: Record<K, string>, aliases: Record<string, K> = {}) {
    const keys = Object.keys(labels) as K[];
    this.spellings = Object.fromEntries(keys.map((k) => [k, [] as string[]])) as Record<
      K,
      string[]
    >;
    for (const key of keys) {
      this.add(key, key);
      this.add(labels[key], key);
    }
    for (const [alias, key] of Object.entries(aliases)) this.add(alias, key);
  }

  private add(written: string, key: K) {
    const s = spelling(written);
    if (!this.bySpelling.has(s)) this.bySpelling.set(s, key);
    // Document "Bank transfer" next to "bank_transfer", but not "Cash" next to "cash".
    const listed = this.spellings[key];
    if (!listed.some((w) => w.toLowerCase() === written.toLowerCase())) listed.push(written);
  }

  get(raw: string): K | null {
    return this.bySpelling.get(spelling(raw)) ?? null;
  }

  /** "x is not recognised — did you mean "y"?" over the canonical keys. */
  unknown(column: string, raw: string): string {
    const keys = Object.keys(this.spellings);
    const byKeySpelling = new Map(keys.map((k) => [spelling(k), k]));
    const guess = closestMatch(spelling(raw), byKeySpelling.keys());
    const hint = guess ? ` — did you mean "${byKeySpelling.get(guess)}"?` : "";
    return `${column} "${raw.trim()}" is not recognised${hint}`;
  }
}

export const FINANCING_VOCABULARY = new Vocabulary<FinancingType>(FINANCING_LABELS, {
  yes: "loan",
  true: "loan",
  no: "self",
  false: "self",
});

/** `null` when blank — the row decides the default from the loan bank. */
export function financingCell(raw: string | undefined): Cell<FinancingType | null> {
  const s = (raw ?? "").trim();
  if (!s) return ok(null);
  return (
    nullable(FINANCING_VOCABULARY.get(s)) ??
    fail(`financing_type "${s}" is not recognised — use loan or self`)
  );
}

export const PAYMENT_METHOD_VOCABULARY = new Vocabulary<PaymentMethod>(
  PAYMENT_METHOD_LABELS,
  {
    NEFT: "bank_transfer",
    RTGS: "bank_transfer",
    IMPS: "bank_transfer",
    GPay: "upi",
    PhonePe: "upi",
    loan: "loan_disbursement",
  },
);

/** Defaults to "other" when blank. */
export function paymentMethodCell(
  raw: string | undefined,
  column: string,
): Cell<PaymentMethod> {
  const s = (raw ?? "").trim();
  if (!s) return ok("other");
  return (
    nullable(PAYMENT_METHOD_VOCABULARY.get(s)) ??
    fail(PAYMENT_METHOD_VOCABULARY.unknown(column, s))
  );
}

export const PAYMENT_PURPOSE_VOCABULARY = new Vocabulary<PaymentPurpose>(
  PAYMENT_PURPOSE_LABELS,
  { KSEB: "kseb_fees", "KSEB fee": "kseb_fees" },
);

/** Defaults to "contract" when blank. */
export function paymentPurposeCell(
  raw: string | undefined,
  column: string,
): Cell<PaymentPurpose> {
  const s = (raw ?? "").trim();
  if (!s) return ok("contract");
  return (
    nullable(PAYMENT_PURPOSE_VOCABULARY.get(s)) ??
    fail(PAYMENT_PURPOSE_VOCABULARY.unknown(column, s))
  );
}

export const STAGE_VOCABULARY = new Vocabulary<ProjectStage>(STAGE_LABELS);

/** Resolve a stage key or its label; blank is the first stage, unknown null. */
export function normalizeStage(value: string): ProjectStage | null {
  if (!value.trim()) return PROJECT_STAGES[0].value;
  return STAGE_VOCABULARY.get(value);
}

export function stageCell(raw: string | undefined): Cell<ProjectStage> {
  const s = raw ?? "";
  return nullable(normalizeStage(s)) ?? fail(STAGE_VOCABULARY.unknown("current_stage", s));
}

/** `ok(value)` for a found value, `null` to fall through to the error. */
function nullable<T>(value: T | null): Cell<T> | null {
  return value === null ? null : ok(value);
}
