import { PROJECT_STAGES, STAGE_LABELS } from "@/lib/constants";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  PlanType,
  ProjectCancellation,
  ProjectStage,
} from "@/lib/types";
import { CANCELLATION } from "./cancellation";
import { isIsoDate } from "./dates";
import {
  FINANCING_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PURPOSE_LABELS,
} from "./payment";
import { HANDOVER_STAGE, PLAN_TYPE } from "./plan";
import { statusLabels } from "./status";
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

/** `numeric(12,2)` — the widest amount the money columns can hold, in paise. */
const MAX_PAISE = 999_999_999_999;

/** Case/spacing-insensitive key: "Bank-Transfer" → "bank transfer". */
export function spelling(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function textCell(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return s.length ? s : null;
}

const AMOUNT_EXAMPLE = "like 195000 or 235000+23500";

/** One part of an amount, as typed: "₹ 1,000", "Rs. 500", "2500.50". */
function plainAmount(part: string): string {
  return part
    .trim()
    .replace(/^rs\.?/i, "")
    .replace(/[₹,\s]/g, "");
}

/** Whole rupees × 100 + the decimals, without a float in between. */
function toPaise(digits: string): number {
  const [whole, decimals = ""] = digits.split(".");
  // Longer than the column could ever hold: no need to be exact, only too large.
  if (whole.length > 12) return Number.POSITIVE_INFINITY;
  return Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
}

/**
 * Rupees: digits with up to 2 decimals. Thousands separators, a ₹ sign and a
 * "Rs." prefix are tolerated because that is how amounts get typed.
 *
 * A cell may also be a sum — `235000+23500`, `₹1,000 + Rs. 500` — because a
 * price is often written as base plus extras. The parts are added in paise
 * (0.1 + 0.2 is exactly 0.30) and the zero / maximum rules apply to the total.
 * Each part must itself be a plain, non-negative amount: `100+-5` is refused
 * rather than read as a discount.
 */
export function moneyCell(
  raw: string | undefined,
  column: string,
  { positive = false }: { positive?: boolean } = {},
): Cell<number | null> {
  const s = (raw ?? "").trim();
  if (!s) return ok(null);

  const parts = s.split("+").map(plainAmount);
  const isSum = parts.length > 1;
  if (isSum && parts.some((p) => p === "")) {
    return fail(`${column} "${s}" has an empty part — write it like 235000+23500`);
  }
  if (isSum && parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) {
    return fail(`${column} "${s}" — each part of a sum must be a plain amount`);
  }
  if (!isSum && !/^-?\d+(\.\d+)?$/.test(parts[0])) {
    return fail(`${column} must be an amount in rupees, ${AMOUNT_EXAMPLE} (got "${s}")`);
  }
  if (parts.some((p) => /\.\d{3,}$/.test(p))) {
    return fail(`${column} has more than 2 decimal places (got "${s}")`);
  }
  if (!isSum && parts[0].startsWith("-")) {
    return fail(`${column} cannot be negative (got "${s}")`);
  }

  const paise = parts.reduce((sum, p) => sum + toPaise(p), 0);
  if (positive && paise === 0) return fail(`${column} must be more than zero`);
  if (paise > MAX_PAISE) return fail(`${column} is too large (got "${s}")`);
  return ok(paise / 100);
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

export const PLAN_VOCABULARY = new Vocabulary<PlanType>(statusLabels(PLAN_TYPE), {
  kw: "solar",
  other: "custom",
});

/** Defaults to a solar plant when blank. */
export function planTypeCell(raw: string | undefined, column: string): Cell<PlanType> {
  const s = (raw ?? "").trim();
  if (!s) return ok("solar");
  return nullable(PLAN_VOCABULARY.get(s)) ?? fail(PLAN_VOCABULARY.unknown(column, s));
}

export const CANCELLATION_VOCABULARY = new Vocabulary<ProjectCancellation>(
  statusLabels(CANCELLATION),
  { canceled: "cancelled", cancel: "cancelled", refund: "refunded" },
);

/** What a blank-equivalent cancellation cell may say. */
const LIVE_SPELLINGS: readonly string[] = ["active", "live"];

/** `null` for a live project: blank, "active" or "live". */
export function cancellationCell(
  raw: string | undefined,
  column: string,
): Cell<ProjectCancellation | null> {
  const s = (raw ?? "").trim();
  if (!s || LIVE_SPELLINGS.includes(spelling(s))) return ok(null);
  return (
    nullable(CANCELLATION_VOCABULARY.get(s)) ??
    fail(CANCELLATION_VOCABULARY.unknown(column, s))
  );
}

export const STAGE_VOCABULARY = new Vocabulary<ProjectStage>(STAGE_LABELS);

/**
 * Ways a sheet says "this project is finished": the last stage, completed.
 * Listed on the page next to the stages. `plant_commissioning` itself is NOT
 * one of them — it names the stage, and a project can sit at it unfinished.
 */
export const COMPLETION_ALIASES = [
  "plant_complete",
  "completed",
  "complete",
  "commissioned",
  "plant commissioned",
  "handed over",
] as const;

const COMPLETION_SPELLINGS = new Set(COMPLETION_ALIASES.map(spelling));

/** A project is not "cancelled" at a stage; that is the cancellation column. */
const CANCELLED_STAGE_SPELLINGS = new Set(
  ["cancelled", "canceled", "cancel", "refunded", "refund"].map(spelling),
);

/** Resolve a stage key or its label; blank is the first stage, unknown null. */
export function normalizeStage(value: string): ProjectStage | null {
  if (!value.trim()) return PROJECT_STAGES[0].value;
  return STAGE_VOCABULARY.get(value);
}

/** What a current_stage cell says: where the project is, and whether it is done. */
export interface StageCellValue {
  /** `null` when the cell is blank — the plan decides where it starts. */
  stage: ProjectStage | null;
  /** The cell said the project is finished (a completion alias). */
  completed: boolean;
}

/** "did you mean" over the stage keys and the completion aliases. */
function unknownStage(column: string, raw: string): string {
  const written = [...Object.keys(STAGE_VOCABULARY.spellings), ...COMPLETION_ALIASES];
  const bySpelling = new Map(written.map((w) => [spelling(w), w]));
  const guess = closestMatch(spelling(raw), bySpelling.keys());
  const hint = guess ? ` — did you mean "${bySpelling.get(guess)}"?` : "";
  return `${column} "${raw.trim()}" is not recognised${hint}`;
}

export function stageCell(
  raw: string | undefined,
  column = "current_stage",
): Cell<StageCellValue> {
  const s = (raw ?? "").trim();
  if (!s) return ok({ stage: null, completed: false });
  if (COMPLETION_SPELLINGS.has(spelling(s))) {
    return ok({ stage: HANDOVER_STAGE, completed: true });
  }
  if (CANCELLED_STAGE_SPELLINGS.has(spelling(s))) {
    return fail(
      `${column} "${s}" is not a stage — put cancelled or refunded in the cancellation column and leave ${column} at the stage the project reached`,
    );
  }
  const stage = STAGE_VOCABULARY.get(s);
  return stage ? ok({ stage, completed: false }) : fail(unknownStage(column, s));
}

/** `ok(value)` for a found value, `null` to fall through to the error. */
function nullable<T>(value: T | null): Cell<T> | null {
  return value === null ? null : ok(value);
}
