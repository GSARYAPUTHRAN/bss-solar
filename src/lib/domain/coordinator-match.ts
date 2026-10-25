import { fail, ok } from "@/lib/result";
import type { UserRole } from "@/lib/types";
import type { Cell } from "./import-cells";
import { MAX_SALE_COORDINATORS } from "./coordinators";
import { WORK_ORDER_OWNER_ROLES, isOfficeRole } from "./role";
import { editDistance } from "./suggest";

/**
 * Who the importer's `coordinator` cell names.
 *
 * The cell holds what a person typed in a sheet: a first name ("sudheesh"), a
 * full name, an e-mail, several people ("Abhijith+Ravi", "Ravi & Abhijith"),
 * and sometimes a remark in brackets ("sudheesh(sheeja)"). It is resolved here,
 * in TypeScript, against the team's accounts (`account_directory()`), so every
 * problem can be reported with the rest of the row's — and so the office sees
 * who each name became before anything is written. The database re-checks ids,
 * roles and duplicates; it never guesses a name.
 *
 * The one rule behind every message: a name is only ever resolved by an exact,
 * unambiguous rule. Close spellings ("Abhijit") are offered as "did you mean"
 * and never accepted — a wrong owner would also receive that sale's money.
 *
 * Pure: no clock, no database.
 */

export interface DirectoryAccount {
  id: string;
  fullName: string;
  /** Login e-mail; null only if the account has none on record. */
  email: string | null;
  role: UserRole;
}

// --- Names ---------------------------------------------------------------------

/** Compare names, not spellings: "K. Sudheesh" and "k sudheesh" are the same. */
export function normalizePersonName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(name: string): string[] {
  return normalizePersonName(name).split(" ").filter(Boolean);
}

/** An initial ("K") has one letter; a given name has at least two. */
function letterCount(word: string): number {
  return [...word].filter((c) => /\p{L}/u.test(c)).length;
}

/** `handle_new_user` stores the e-mail as the name when none was given. */
const EMAIL_SHAPED = /^[^\s@]+@[^\s@]+$/;

/**
 * The name an account is matched by: its full name or — when that is really an
 * e-mail address — the part before the "@" ("sudheesh.k@x.in" → "sudheesh k").
 * `nameIsEmail` lets the matches panel say the account has no name yet.
 */
export function matchingName(a: DirectoryAccount): { name: string; nameIsEmail: boolean } {
  const full = a.fullName.trim();
  const nameIsEmail = EMAIL_SHAPED.test(full);
  const written = nameIsEmail ? full.slice(0, full.indexOf("@")) : full;
  return { name: normalizePersonName(written), nameIsEmail };
}

/**
 * The first word of at least two letters, lower-cased: the name a person goes
 * by. Initials before it are skipped ("K. Sudheesh" → "sudheesh").
 */
export function givenName(fullName: string): string | null {
  return wordsOf(fullName).find((w) => letterCount(w) >= 2) ?? null;
}

/**
 * The words of a normalised full name other than its given name, in order
 * ("K. Sudheesh Nair" → ["k", "nair"]).
 */
export function otherNameWords(fullName: string): string[] {
  const words = wordsOf(fullName);
  const given = givenName(fullName);
  const at = given === null ? -1 : words.indexOf(given);
  return words.filter((_, i) => i !== at);
}

/**
 * D24. A reference names an account when the given names are equal and every
 * further word of the reference starts the account's word in the same place
 * ("Ravi K" → "Ravi Kumar", "Sudheesh K" → "K. Sudheesh"; "Ravi Shankar" never
 * becomes "Ravi Kumar"). A one-word reference is the plain first-name rule.
 */
function namedBy(reference: string, accountName: string): boolean {
  const given = givenName(reference);
  if (given === null || given !== givenName(accountName)) return false;
  const others = otherNameWords(accountName);
  const asked = otherNameWords(reference);
  return asked.length <= others.length && asked.every((w, i) => others[i].startsWith(w));
}

/** Typo budget for "did you mean": a third of the word, at least 2 edits. */
function budget(word: string): number {
  return Math.max(2, Math.floor(word.length / 3));
}

// --- The directory -------------------------------------------------------------

function isOwner(a: DirectoryAccount): boolean {
  return WORK_ORDER_OWNER_ROLES.includes(a.role);
}

/** Read-only index of the team's accounts, for resolving what a sheet says. */
export class CoordinatorDirectory {
  private readonly accounts: readonly DirectoryAccount[];
  private readonly emails = new Map<string, DirectoryAccount>();
  private readonly ids = new Map<string, DirectoryAccount>();

  constructor(accounts: readonly DirectoryAccount[]) {
    // Name, then e-mail: listings and suggestions come out the same on every run.
    this.accounts = [...accounts].sort(
      (a, b) =>
        a.fullName.localeCompare(b.fullName) ||
        (a.email ?? "").localeCompare(b.email ?? "") ||
        a.id.localeCompare(b.id),
    );
    for (const a of this.accounts) {
      this.ids.set(a.id, a);
      if (a.email) this.emails.set(a.email.trim().toLowerCase(), a);
    }
  }

  byId(id: string): DirectoryAccount | null {
    return this.ids.get(id) ?? null;
  }

  /** The account with this login e-mail (any role), case-insensitive. */
  byEmail(email: string): DirectoryAccount | null {
    return this.emails.get(email.trim().toLowerCase()) ?? null;
  }

  /** Accounts of any role whose whole name is this one. */
  byFullName(name: string): DirectoryAccount[] {
    const wanted = normalizePersonName(name);
    if (!wanted) return [];
    return this.accounts.filter((a) => matchingName(a).name === wanted);
  }

  /**
   * Owner accounts (coordinator, office) the reference names by the given-name
   * rule (D24). A service engineer is never a candidate — see `engineersNamed`.
   */
  byGivenName(reference: string): DirectoryAccount[] {
    return this.accounts.filter((a) => isOwner(a) && namedBy(reference, matchingName(a).name));
  }

  /** Service engineers a reference names, by full name or the given-name rule. */
  engineersNamed(reference: string): DirectoryAccount[] {
    const wanted = normalizePersonName(reference);
    return this.accounts.filter(
      (a) =>
        a.role === "service_engineer" &&
        (matchingName(a).name === wanted || namedBy(reference, matchingName(a).name)),
    );
  }

  /**
   * Owner accounts that look like what was meant — for "did you mean" only,
   * best first. Never used to resolve: a close spelling is a question.
   */
  suggestions(reference: string, limit = 3): DirectoryAccount[] {
    const ref = reference.trim().toLowerCase();
    if (!ref) return [];
    const scored: { account: DirectoryAccount; score: number }[] = [];
    for (const account of this.accounts) {
      if (!isOwner(account)) continue;
      const score = ref.includes("@") ? emailScore(ref, account) : nameScore(ref, account);
      if (score !== null) scored.push({ account, score });
    }
    // `accounts` is name-sorted and Array#sort is stable, so ties stay in name order.
    return scored
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((s) => s.account);
  }

  /** The office account to point at ("write admin@…"): the first admin by name. */
  officeAccount(): DirectoryAccount | null {
    const office = this.accounts.filter((a) => isOfficeRole(a.role));
    return office.find((a) => a.role === "admin") ?? office[0] ?? null;
  }

  /** "Ravi Kumar (ravi@bsssolar.in)" — enough to tell two Ravis apart. */
  static label(a: DirectoryAccount): string {
    const email = a.email?.trim();
    if (!email || email.toLowerCase() === a.fullName.trim().toLowerCase()) {
      return a.fullName;
    }
    return `${a.fullName} (${email})`;
  }
}

/** Lower is better; null when the e-mail is not close. Only the part before "@" counts. */
function emailScore(ref: string, a: DirectoryAccount): number | null {
  if (!a.email) return null;
  const local = (email: string) => email.split("@")[0];
  const d = editDistance(local(ref), local(a.email.toLowerCase()));
  return d <= budget(local(ref)) ? d : null;
}

/** Shortest typed word worth a spelling guess: "Al" is more likely a different person than a typo. */
const MIN_GUESS_LENGTH = 3;

/** Lower is better; null when the name is not close to what was typed. */
function nameScore(ref: string, a: DirectoryAccount): number | null {
  const typed = normalizePersonName(ref);
  const typedGiven = givenName(typed) ?? typed.split(" ")[0];
  const name = matchingName(a).name;
  const given = givenName(name) ?? "";

  // Same first name, further words that do not fit: "Ravi Shankar" → Ravi Kumar.
  if (typedGiven === given) return 1;
  // Typed the start of it: "Abhi" → Abhijith Nair.
  if (typedGiven.length >= 2 && (name.startsWith(typed) || given.startsWith(typedGiven))) {
    return 2;
  }
  if (typed.length < MIN_GUESS_LENGTH) return null;
  // A slip in the spelling: "Abhijit" → Abhijith.
  const close = (a: string, b: string) =>
    b !== "" && editDistance(a, b) <= budget(a) ? editDistance(a, b) : Infinity;
  const best = Math.min(close(typed, name), close(typedGiven, given));
  return best === Infinity ? null : 3 + best;
}

// --- Reading the cell ----------------------------------------------------------

/** Brackets hold a remark about the person, not a person ("sudheesh(sheeja)"). */
const ASIDE = /\(([^()]*)\)/;

/** " and " between names; "Anand" and "Chandran" contain "and" but never split. */
const SEPARATORS = /[,;/&]|\s+and\s+/i;

/** The cell taken apart; `problem` is the reason it could not be, worded to follow the quoted cell. */
interface CellPieces {
  references: string[];
  asides: string[];
  problem: string | null;
}

function splitCell(raw: string): CellPieces {
  const asides: string[] = [];
  let rest = raw;
  for (let m = ASIDE.exec(rest); m; m = ASIDE.exec(rest)) {
    const note = m[1].trim();
    if (note) asides.push(note);
    rest = rest.replace(ASIDE, " ");
  }
  if (/[()]/.test(rest)) {
    return { references: [], asides, problem: "has an unclosed bracket" };
  }

  const pieces = rest.split(SEPARATORS).map((p) => p.trim());
  if (pieces.length > 1 && pieces.some((p) => p === "")) {
    return {
      references: [],
      asides,
      problem: "has an empty name — remove the extra separator",
    };
  }
  const references = pieces.filter(Boolean);
  return {
    references,
    asides,
    problem: references.length === 0 ? "has no name outside the brackets" : null,
  };
}

/**
 * Take the cell apart: bracketed remarks (`asides`), then the names, split on
 * `, ; / &` and "and". "+" is NOT split here — it is part of plus-addressed
 * e-mails ("ravi+bss@x.in") — see `resolveCoordinatorCell`. An unclosed bracket
 * or an empty name between two separators is a problem, never guessed around.
 */
export function splitCoordinatorCell(
  raw: string,
  column = "coordinator",
): { references: string[]; asides: string[]; problems: string[] } {
  const { references, asides, problem } = splitCell(raw);
  return {
    references,
    asides,
    problems: problem ? [`${column} "${raw.trim()}" ${problem}`] : [],
  };
}

/** One person, or one thing that is not a person, the cell named. */
export interface CoordinatorReference {
  /** What was typed for this one person ("Abhijith"; the whole piece when it failed as one). */
  written: string;
  account: DirectoryAccount | null;
  /**
   * Why `written` is not an account — the part of the sentence after the
   * quoted name ("is not a coordinator or office account — did you mean …?").
   * Null when it resolved.
   */
  problem: string | null;
}

/** The sentence a row reports for a reference that did not resolve. */
export function describeReferenceProblem(column: string, r: CoordinatorReference): string {
  return `${column} "${r.written}" ${r.problem ?? ""}`.trim();
}

const resolved = (written: string, account: DirectoryAccount): CoordinatorReference => ({
  written,
  account,
  problem: null,
});
const refused = (written: string, problem: string): CoordinatorReference => ({
  written,
  account: null,
  problem,
});

function engineerProblem(engineers: readonly DirectoryAccount[]): string {
  const list = engineers.map((e) => e.fullName).join(", ");
  return engineers.length === 1
    ? `is ${list}, a service engineer — a sale belongs to coordinator or office accounts`
    : `matches service engineers (${list}) — a sale belongs to coordinator or office accounts`;
}

function listAccounts(accounts: readonly DirectoryAccount[]): string {
  return accounts.map(CoordinatorDirectory.label).join(", ");
}

/** An e-mail on its own: the account, or why not. */
function resolveEmail(email: string, dir: CoordinatorDirectory): CoordinatorReference {
  const account = dir.byEmail(email);
  if (account) {
    return isOwner(account)
      ? resolved(email, account)
      : refused(email, engineerProblem([account]));
  }
  const near = dir.suggestions(email);
  return refused(
    email,
    near.length
      ? `is not an account — did you mean ${near.map((a) => a.email).join(" or ")}?`
      : "is not an account — check the e-mail, or add the account on the Team page first",
  );
}

/** A name on its own (no "@"): the account, or why not. D24, then suggestions. */
function resolveName(written: string, dir: CoordinatorDirectory): CoordinatorReference {
  const exact = dir.byFullName(written).filter(isOwner);
  if (exact.length === 1) return resolved(written, exact[0]);
  if (exact.length > 1) {
    return refused(
      written,
      `matches ${exact.length} accounts with that name: ${exact
        .map((a) => a.email ?? a.fullName)
        .join(", ")} — write the e-mail`,
    );
  }

  const named = dir.byGivenName(written);
  if (named.length === 1) return resolved(written, named[0]);
  if (named.length > 1) {
    return refused(
      written,
      `matches more than one account: ${listAccounts(named)} — write the full name or the e-mail`,
    );
  }

  const engineers = dir.engineersNamed(written);
  if (engineers.length > 0) return refused(written, engineerProblem(engineers));

  if (normalizePersonName(written) === "office") {
    const email = dir.officeAccount()?.email;
    return refused(
      written,
      `is not an account — write the e-mail of the office account that owns this sale${
        email ? ` (e.g. ${email})` : ""
      }, or leave the cell blank to use the default coordinator`,
    );
  }

  const near = dir.suggestions(written);
  return refused(
    written,
    near.length
      ? `is not a coordinator or office account — did you mean ${near
          .map(CoordinatorDirectory.label)
          .join(" or ")}?`
      : "is not a coordinator or office account — check the spelling, or add the account on the Team page first",
  );
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

/**
 * One piece of the cell (a name, an e-mail, or "+"-joined ones) → its people.
 *
 * A piece with "@" is tried whole as one e-mail first, so plus-addressing
 * ("ravi+bss@x.in") works; only when no account has it is it read as people
 * joined by "+" ("ravi@x.in+abhijith@x.in", "Ravi+abhijith@x.in"). If any of
 * those fails the original piece is reported once, with each failing part's own
 * reason — the person sees exactly what to change.
 */
function resolvePiece(piece: string, dir: CoordinatorDirectory): CoordinatorReference[] {
  const hasEmail = piece.includes("@");
  if (hasEmail) {
    const whole = dir.byEmail(piece);
    if (whole) return [resolveEmail(piece, dir)];
  }

  const parts = piece.split("+").map((p) => p.trim());
  if (parts.length === 1) {
    return [hasEmail ? resolveEmail(piece, dir) : resolveName(piece, dir)];
  }
  if (parts.some((p) => p === "")) {
    return [refused(piece, `has an empty name — remove the extra "+"`)];
  }

  const each = parts.map((p) => (p.includes("@") ? resolveEmail(p, dir) : resolveName(p, dir)));
  if (!hasEmail || each.every((r) => r.account)) return each;

  const failing = each.filter((r) => !r.account);
  return [
    refused(
      piece,
      `— no account has the e-mail ${piece}, and as ${countWord(parts.length)} people: ${failing
        .map((r) => `"${r.written}" ${r.problem}`)
        .join("; ")}`,
    ),
  ];
}

/** What a cell turned into: the people, in the order written. */
export interface CoordinatorCellValue {
  ids: string[];
  /** The accounts' full names, for results ("Abhijith Nair"). */
  names: string[];
  /** Bracketed remarks, to be kept in the sale's notes. */
  asides: string[];
}

export interface CoordinatorCellAnalysis {
  /** The cell is blank: the importer's default coordinator applies (if any). */
  blank: boolean;
  /** Everything the cell named, resolved or not, for the matches panel. */
  references: CoordinatorReference[];
  /** The people; null when blank or when any problem was found. */
  value: CoordinatorCellValue | null;
  /** Every problem, worded for the row ("coordinator "Abhijit" is not …"). */
  problems: string[];
}

/** Resolve a `coordinator` cell. `column` is the header the sheet used. */
export function analyzeCoordinatorCell(
  raw: string | undefined,
  dir: CoordinatorDirectory,
  column: string,
): CoordinatorCellAnalysis {
  const text = (raw ?? "").trim();
  if (!text) return { blank: true, references: [], value: null, problems: [] };

  const split = splitCell(text);
  // A cell that cannot be read is listed as one thing the sheet wrote.
  const references: CoordinatorReference[] = split.problem
    ? [refused(text, split.problem)]
    : split.references.flatMap((piece) => resolvePiece(piece, dir));
  const problems: string[] = [];
  for (const r of references) {
    if (r.problem) problems.push(describeReferenceProblem(column, r));
  }

  const accounts = references.flatMap((r) => (r.account ? [r.account] : []));
  const seen = new Set<string>();
  const twice = new Set<DirectoryAccount>();
  for (const a of accounts) {
    if (seen.has(a.id)) twice.add(a);
    seen.add(a.id);
  }
  for (const a of twice) problems.push(`${column} names ${a.fullName} twice`);
  if (accounts.length > MAX_SALE_COORDINATORS) {
    problems.push(
      `${column} lists ${accounts.length} people — a sale can have at most ${MAX_SALE_COORDINATORS}`,
    );
  }

  return {
    blank: false,
    references,
    problems,
    value:
      problems.length === 0
        ? {
            ids: accounts.map((a) => a.id),
            names: accounts.map((a) => a.fullName),
            asides: split.asides,
          }
        : null,
  };
}

/**
 * The people a cell names, or every problem with it. `null` data means blank —
 * the caller applies the default coordinator.
 */
export function resolveCoordinatorCell(
  raw: string | undefined,
  dir: CoordinatorDirectory,
  column: string,
): Cell<CoordinatorCellValue | null> {
  const analysis = analyzeCoordinatorCell(raw, dir, column);
  if (analysis.blank) return ok(null);
  return analysis.value ? ok(analysis.value) : fail(analysis.problems.join("; "));
}

/**
 * One distinct thing the sheet wrote in a coordinator cell, who it became and
 * on which rows — a line of the "Coordinator matches" panel. `written: ""` is
 * the blank cell (the default coordinator, or nobody).
 */
export interface CoordinatorMatch {
  written: string;
  account: DirectoryAccount | null;
  /** The reason it is not an account, as in `CoordinatorReference.problem`. */
  problem: string | null;
  rows: number[];
}
