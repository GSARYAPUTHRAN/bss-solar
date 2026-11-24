import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import { coordinatorsLabel } from "./coordinators";
import { istDateOf } from "./dates";
import type { ImportPlan, ImportRow } from "./import";

/**
 * Sales the import would write a second time. The Feb and Oct sheets were each
 * uploaded twice in production, and nothing stopped it: a row without a KSEB
 * consumer number is new to the importer every time.
 *
 * A valid row is "already in the system" when an existing work order (not a
 * rejected one — the repository leaves those out) has the same order date and
 * the same customer, names compared loosely (`nameKeys`).
 * A row whose order_date cell was blank would be stored with today's date,
 * which says nothing about when it was sold — the same sheet uploaded again
 * next week would not match — so it is matched by the customer's name alone,
 * against every sale, and says so.
 *
 * Pure: the server action reads the existing sales and decides, with the
 * admin's choice, which rows are sent. The popup only explains — an import
 * with such rows and no choice writes nothing.
 */

/** A work order already in the system, as the duplicate check needs it. */
export interface ExistingSale {
  id: string;
  clientName: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  /** When the work order was written (an ISO timestamp; "" when unknown). */
  createdAt: string;
  coordinatorNames: string[];
  totalCost: number;
}

/**
 * The sale a row matched. `byNameOnly`: the row had no order date, so only the
 * customer's name was compared. A plain `ExistingSale` is a match on name and
 * order date.
 */
export interface DuplicateMatch extends ExistingSale {
  byNameOnly?: boolean;
}

/** What the admin chose for the rows already in the system. */
export type DuplicateChoice = "skip" | "include";

/** The posted choice; anything else — missing included — is no choice. */
export function duplicateChoiceOf(value: unknown): DuplicateChoice | null {
  return value === "skip" || value === "include" ? value : null;
}

// --- Matching ----------------------------------------------------------------

/**
 * Two spellings of one name. `sorted`: the lower-case words (letters and
 * digits, the vowel signs of Malayalam script included) in alphabetical order,
 * so "Vijayakumar R" is "R.Vijayakumar". `joined`: the same words run together
 * in written order, so "Santhi kumari" is "Santhikumari". `initials`: as
 * `sorted`, but each run of single letters written one after another is one
 * word first, so "K.C Santhi" is "Santhi KC" (and "K.S Santhi" is not).
 */
export interface NameKeys {
  sorted: string;
  joined: string;
  initials: string;
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const INITIAL = /^\p{L}$/u;

/** `["k", "c", "santhi"]` → `["kc", "santhi"]`: consecutive initials as one word. */
function initialsJoined(words: readonly string[]): string[] {
  const out: string[] = [];
  let run = "";
  for (const word of words) {
    if (INITIAL.test(word)) {
      run += word;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(word);
  }
  if (run) out.push(run);
  return out;
}

export function nameKeys(name: string): NameKeys {
  const words = name.normalize("NFKC").toLowerCase().match(WORD) ?? [];
  return {
    sorted: [...words].sort().join(" "),
    joined: words.join(""),
    initials: initialsJoined(words).sort().join(" "),
  };
}

/**
 * The keys two names are compared by, tagged by kind: one customer when any
 * is shared. A name with no letters or digits has none, and matches nothing.
 */
function keyList(keys: NameKeys): string[] {
  if (keys.joined === "") return [];
  return [`s:${keys.sorted}`, `j:${keys.joined}`, `i:${keys.initials}`];
}

export function sameCustomer(a: string, b: string): boolean {
  const theirs = new Set(keyList(nameKeys(b)));
  return keyList(nameKeys(a)).some((key) => theirs.has(key));
}

/**
 * The items that name one customer (`sameCustomer`), in groups of two or more,
 * each in the order given and the groups in the order of their first item. A
 * group is linked item to item: "A B" is "B A" and "B A" is "BA", so all three
 * are one group.
 */
export function sameCustomerGroups<T>(items: readonly T[], nameOf: (item: T) => string): T[][] {
  // Union-find over the items, joined through the first item to have each key.
  const parent = items.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const firstWith = new Map<string, number>();
  items.forEach((item, i) => {
    for (const key of keyList(nameKeys(nameOf(item)))) {
      const first = firstWith.get(key);
      if (first === undefined) firstWith.set(key, i);
      else parent[root(i)] = root(first);
    }
  });
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), item]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

/** An instant's time for ordering; an unknown one sorts last. */
function timeOf(instant: string): number {
  const t = Date.parse(instant);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Oldest first, then by id: a row matching several sales names the same one every time. */
function byAge(a: ExistingSale, b: ExistingSale): number {
  const ta = timeOf(a.createdAt);
  const tb = timeOf(b.createdAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The valid rows whose order_date cell was blank: the importer stores today
 * for them, which is no evidence of when the sale was made. (`order_date` has
 * no other column name, so the cell is always under its own.)
 */
export function undatedRows(plan: ImportPlan): Set<number> {
  return new Set(plan.rows.flatMap((r) => (r.parsed.ok && !r.cells.order_date ? [r.rowNo] : [])));
}

const NO_ROWS: ReadonlySet<number> = new Set();

/**
 * The valid rows that match a sale already in the system, by `row_no`, with
 * the sale each matches (the oldest when several do): the same customer on the
 * same order date — or, for an `undated` row, the same customer on any date
 * (`byNameOnly`). Rows matching each other within the file are not this
 * check's business — the plan warns about those.
 */
export function findDuplicates(
  rows: readonly ImportRow[],
  existing: readonly ExistingSale[],
  undated: ReadonlySet<number> = NO_ROWS,
): Map<number, DuplicateMatch> {
  // Each key's oldest sale, on its order date and on any date.
  const onDate = new Map<string, ExistingSale>();
  const anyDate = new Map<string, ExistingSale>();
  for (const sale of [...existing].sort(byAge)) {
    for (const key of keyList(nameKeys(sale.clientName))) {
      if (!onDate.has(`${sale.orderDate}|${key}`)) onDate.set(`${sale.orderDate}|${key}`, sale);
      if (!anyDate.has(key)) anyDate.set(key, sale);
    }
  }

  const found = new Map<number, DuplicateMatch>();
  for (const row of rows) {
    const byNameOnly = undated.has(row.row_no);
    const [match] = keyList(nameKeys(row.client_name))
      .flatMap((key) => (byNameOnly ? anyDate.get(key) : onDate.get(`${row.order_date}|${key}`)) ?? [])
      .sort(byAge);
    if (!match) continue;
    found.set(row.row_no, byNameOnly ? { ...match, byNameOnly } : match);
  }
  return found;
}

// --- Skipping ------------------------------------------------------------------

/** How `import_projects` compares consumer numbers: all whitespace removed, case kept. */
const consumerKey = (consumerNumber: string) => consumerNumber.replace(/\s+/g, "");

/**
 * Rows to hold back with the ones skipped as already in the system. With
 * consumer-number skipping on, of several rows sharing a number only the first
 * goes in (`import_projects`), and Check file says the rest are skipped. When
 * that first row is skipped as already in the system it is never sent, and the
 * next row with its number would go in in its place — so every later row
 * sharing it is held back too. By `row_no`, with the skipped row it repeats.
 */
export function repeatsOfSkipped(
  rows: readonly ImportRow[],
  skipped: ReadonlyMap<number, unknown>,
): Map<number, ImportRow> {
  const firstWith = new Map<string, ImportRow>();
  const held = new Map<number, ImportRow>();
  for (const row of rows) {
    if (row.consumer_number === null) continue;
    const key = consumerKey(row.consumer_number);
    const first = firstWith.get(key);
    if (!first) firstWith.set(key, row);
    else if (skipped.has(first.row_no) && !skipped.has(row.row_no)) held.set(row.row_no, first);
  }
  return held;
}

/** The result message of a row held back with the skipped row it repeats. */
export function repeatOfSkippedMessage(row: ImportRow, first: ImportRow): string {
  return `Consumer number ${row.consumer_number} repeats row ${first.row_no}, which is already in the system — skipped with it`;
}

// --- The notice ----------------------------------------------------------------

/**
 * What the warning dialog says. `check`: Check file found such rows (OK only).
 * `confirm`: Import projects stopped before writing anything, for a choice.
 */
export interface DuplicateNotice {
  kind: "check" | "confirm";
  /** Valid rows that match a sale already in the system (N). */
  count: number;
  /** Of those, the rows with no order date, matched by the customer's name alone. */
  byNameOnly: number;
  /** Valid rows in the file (M) — what "Import all anyway" sends. */
  valid: number;
  /** IST dates the matched sales were added, distinct, oldest first. */
  addedOn: string[];
  /** The matching rows' customer names as the sheet wrote them, in sheet order. */
  names: string[];
}

/** IST calendar date an instant fell on, or null when it is not one. */
function istDay(instant: string): string | null {
  return Number.isNaN(Date.parse(instant)) ? null : istDateOf(instant);
}

/** The notice for a plan's matches; null when there are none. */
export function duplicateNotice(
  plan: ImportPlan,
  matches: ReadonlyMap<number, DuplicateMatch>,
  kind: DuplicateNotice["kind"],
): DuplicateNotice | null {
  const valid = plan.rows.flatMap((r) => (r.parsed.ok ? [r.parsed.data] : []));
  const duplicated = valid.filter((r) => matches.has(r.row_no));
  if (duplicated.length === 0) return null;

  const days = new Set<string>();
  for (const row of duplicated) {
    const day = istDay(matches.get(row.row_no)?.createdAt ?? "");
    if (day) days.add(day);
  }
  return {
    kind,
    count: duplicated.length,
    byNameOnly: duplicated.filter((r) => matches.get(r.row_no)?.byNameOnly).length,
    valid: valid.length,
    addedOn: [...days].sort(),
    names: duplicated.map((r) => r.client_name),
  };
}

// --- Words ----------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-11-08` → "8 Nov 2026" (no ICU involved, so it reads the same everywhere). */
export function dayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1] ?? month} ${year}`;
}

/** `a`, `a and b`, `a, b and c`. */
function joinAnd(items: readonly string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function rupees(n: number): string {
  return Number.isInteger(n) ? formatCurrencyWhole(n) : formatCurrency(n);
}

/**
 * The sale a row matched, so the office can tell whether it really is the same
 * one. Matched by name alone, its order date is news, so it is given too.
 */
function describeSale(sale: DuplicateMatch): string {
  const day = istDay(sale.createdAt);
  const ordered = sale.byNameOnly ? `, ordered ${dayLabel(sale.orderDate)}` : "";
  const who = sale.coordinatorNames.length > 0 ? `${coordinatorsLabel(sale.coordinatorNames)}, ` : "";
  return `${sale.clientName}${ordered}${day ? `, added on ${dayLabel(day)}` : ""} (${who}${rupees(sale.totalCost)})`;
}

/** Why a row with no order date was matched on less than a dated one. */
const NO_ORDER_DATE = "no order date in the sheet to compare";

/** A matching row's result message, in a check and when it was skipped. */
export function duplicateMessage(sale: DuplicateMatch): string {
  return sale.byNameOnly
    ? `Already in the system — a sale with this name (${NO_ORDER_DATE}): ${describeSale(sale)}`
    : `Already in the system — ${describeSale(sale)}`;
}

/** Under a matching row that was imported anyway: the duplicate is on record. */
export function importedAgainWarning(sale: DuplicateMatch): string {
  return sale.byNameOnly
    ? `Imported again as chosen — a sale with this name was already in the system (${NO_ORDER_DATE}): ${describeSale(sale)}`
    : `Imported again as chosen — this sale was already in the system: ${describeSale(sale)}`;
}

/** Customer names named before the rest are counted. */
export const DUPLICATE_NAMES_SHOWN = 10;

/** "Anand Kumar, Meera Nair and 3 more". */
export function duplicateNames(notice: Pick<DuplicateNotice, "names">): string {
  const { names } = notice;
  if (names.length <= DUPLICATE_NAMES_SHOWN) return joinAnd(names);
  return `${names.slice(0, DUPLICATE_NAMES_SHOWN).join(", ")} and ${names.length - DUPLICATE_NAMES_SHOWN} more`;
}

/** Every valid row is already in: the sheet itself was uploaded before. */
export function wholeSheetDuplicated(notice: Pick<DuplicateNotice, "count" | "valid">): boolean {
  return notice.count === notice.valid;
}

export function duplicateTitle(notice: Pick<DuplicateNotice, "count" | "valid">): string {
  return wholeSheetDuplicated(notice)
    ? "This sheet was already uploaded"
    : "Some of these sales are already in the system";
}

/** When the matched sales went in: a few days by name, more as a span. */
function addedOnSentence(addedOn: readonly string[], one: boolean): string {
  if (addedOn.length === 0) return "";
  const subject = one ? "It was added" : "They were added";
  if (addedOn.length > 3) {
    return ` ${subject} between ${dayLabel(addedOn[0])} and ${dayLabel(addedOn[addedOn.length - 1])}.`;
  }
  return ` ${subject} on ${joinAnd(addedOn.map(dayLabel))}.`;
}

/** What the rows were matched on: a row with no order date had only its name. */
function matchedOn({ count, byNameOnly }: Pick<DuplicateNotice, "count" | "byNameOnly">): string {
  if (byNameOnly === 0) return "same customer and order date";
  if (byNameOnly === count) return `same customer name; ${NO_ORDER_DATE}`;
  return `same customer and order date; ${byNameOnly} with no order date in the sheet ${byNameOnly === 1 ? "matches" : "match"} by name alone`;
}

/** "N of M rows match sales already in the system (…). They were added on 8 Nov 2026." */
export function duplicateSummary(notice: DuplicateNotice): string {
  const { count, valid, addedOn } = notice;
  const rows = `${count} of ${valid} ${valid === 1 ? "row" : "rows"}`;
  const match =
    count === 1
      ? "matches a sale already in the system"
      : "match sales already in the system";
  return `${rows} ${match} (${matchedOn(notice)}).${addedOnSentence(addedOn, count === 1)}`;
}

/** Check file's last word: what Import will do with them. */
export const DUPLICATE_CHECK_NOTE =
  "If you import, these rows are skipped unless you choose to import them again.";

/** The confirm dialog when every row is already in. */
export const NOTHING_NEW_TO_IMPORT = "Nothing new to import.";

/** The confirm dialog when some rows are new. */
export const NOTHING_IMPORTED_YET = "Nothing has been imported yet.";

/** Ticked before "Import all anyway" can be pressed. */
export const DUPLICATE_ACKNOWLEDGEMENT = "I understand this creates duplicate sales";

/** The safe choice; null when nothing would be left to import. */
export function skipLabel(notice: Pick<DuplicateNotice, "count" | "valid">): string | null {
  const rest = notice.valid - notice.count;
  if (rest <= 0) return null;
  return `Skip the ${notice.count} already in the system and import the other ${rest}`;
}

/** The destructive choice. */
export function importAllLabel(notice: Pick<DuplicateNotice, "valid">): string {
  return notice.valid === 1 ? "Import it anyway" : `Import all ${notice.valid} anyway`;
}
