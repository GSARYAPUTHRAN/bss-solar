import { dec, str, text } from "@/server/form";
import { isIsoDate } from "@/lib/domain/dates";
import { PAYMENT_LIMITS } from "@/lib/domain/payment-limits";
import {
  isPaymentKind,
  paymentKind,
  type PaymentKind,
} from "@/lib/domain/payment-kinds";
import {
  isPaymentMethod,
  ledgerProblems,
  paymentSummary,
  withLedger,
  type LedgerEntry,
  type LedgerProblem,
  type PaymentSource,
} from "@/lib/domain/payment";
import { fail, ok, type ActionResult } from "@/lib/result";
import { formatCurrency, formatDate } from "@/lib/format";
import type { PaymentInput } from "@/server/data/payments.repository";

/**
 * Parsing and business rules for a payments-ledger entry, kept free of I/O so
 * the server actions stay thin and every rule is unit-tested.
 *
 * The ledger takes five kinds of entry. Money in (a contract payment, a KSEB fee
 * the customer paid) and a KSEB fee the office paid are read by
 * `parsePaymentForm` from the form's `kind`; a refund is money out and is read
 * the same way; a write-off closes a balance, has a reason, and is read by
 * `parseWriteOffForm`. `checkLedgerChange` is the one place the caps live.
 */

/** Plain rupees with at most two decimals ("25000", "25000.5", "25000.50"). */
const PLAIN_AMOUNT = /^\d+(\.\d{1,2})?$/;

/** What each kind of entry says when its amount or date is wrong. */
const WORDS = {
  received: {
    amount: "Enter the amount received, in rupees.",
    date: "Enter the date the payment was received.",
    future: "The payment date cannot be in the future.",
  },
  paid: {
    amount: "Enter the amount paid, in rupees.",
    date: "Enter the date the payment was made.",
    future: "The payment date cannot be in the future.",
  },
  refund: {
    amount: "Enter the amount refunded, in rupees.",
    date: "Enter the date the refund was paid.",
    future: "The refund date cannot be in the future.",
  },
  writeOff: {
    amount: "Enter the amount to write off, in rupees.",
    date: "Enter the date of the write-off.",
    future: "The write-off date cannot be in the future.",
  },
} as const;

type Words = (typeof WORDS)[keyof typeof WORDS];

function parseAmount(raw: string, words: Words): ActionResult<number> {
  const value = dec(raw);
  if (value === null) return fail(words.amount);
  if (value <= 0) return fail("The amount must be more than zero.");
  if (!PLAIN_AMOUNT.test(raw)) {
    return fail(
      "Enter the amount as a plain number with at most 2 decimal places, e.g. 25000.50.",
    );
  }
  if (value > PAYMENT_LIMITS.maxAmount) {
    return fail("That amount is too large — check for extra digits.");
  }
  return ok(value);
}

function capped(
  value: string | null,
  max: number,
  label: string,
): ActionResult<string | null> {
  if (value !== null && value.length > max) {
    return fail(`${label} must be ${max} characters or fewer.`);
  }
  return ok(value);
}

/** The amount and date every entry has. `today` is the IST calendar date. */
function parseWhenAndHowMuch(
  formData: FormData,
  today: string,
  words: Words,
): ActionResult<{ amount: number; paid_on: string }> {
  const amount = parseAmount(text(formData.get("amount")), words);
  if (!amount.ok) return amount;

  const paidOn = text(formData.get("paid_on"));
  if (!isIsoDate(paidOn)) return fail(words.date);
  if (paidOn > today) return fail(words.future);
  return ok({ amount: amount.data, paid_on: paidOn });
}

function wordsFor(kind: PaymentKind): Words {
  switch (kind) {
    case "refund":
      return WORDS.refund;
    case "kseb_office":
      return WORDS.paid;
    default:
      return WORDS.received;
  }
}

/**
 * Read a contract payment, KSEB fee or refund from a submitted form. The form's
 * `kind` is the one choice the office makes; it decides the purpose and, for a
 * KSEB fee, whether the office paid it — so "paid by the office" can never be
 * attached to anything else. A write-off is not read here (see
 * `parseWriteOffForm`). `today` is the IST calendar date — nothing has been
 * received or paid in the future.
 */
export function parsePaymentForm(
  formData: FormData,
  today: string,
): ActionResult<PaymentInput> {
  const rawKind = text(formData.get("kind")) || "contract";
  if (!isPaymentKind(rawKind)) return fail("Choose what the payment is for.");
  const kind = paymentKind(rawKind);

  const when = parseWhenAndHowMuch(formData, today, wordsFor(rawKind));
  if (!when.ok) return when;

  const method = text(formData.get("method"));
  if (!isPaymentMethod(method)) return fail("Choose how the payment was made.");

  const reference = capped(
    str(formData.get("reference")),
    PAYMENT_LIMITS.referenceLength,
    "Reference",
  );
  if (!reference.ok) return reference;

  const notes = capped(str(formData.get("notes")), PAYMENT_LIMITS.notesLength, "Notes");
  if (!notes.ok) return notes;

  return ok({
    ...when.data,
    method,
    purpose: kind.purpose,
    paid_by_office: kind.paidByOffice,
    reference: reference.data,
    notes: notes.data,
  });
}

export const WRITE_OFF_REASON_ERROR =
  "Say why the balance is being written off — the reason is kept with the entry.";

/**
 * Read a write-off: an amount, the date, and the reason — required, because a
 * balance given up needs saying why. No money moves, so there is no method (the
 * ledger keeps "other") and no reference; the reason is the entry's note.
 */
export function parseWriteOffForm(
  formData: FormData,
  today: string,
): ActionResult<PaymentInput> {
  const when = parseWhenAndHowMuch(formData, today, WORDS.writeOff);
  if (!when.ok) return when;

  const reason = capped(str(formData.get("reason")), PAYMENT_LIMITS.notesLength, "The reason");
  if (!reason.ok) return reason;
  if (reason.data === null) return fail(WRITE_OFF_REASON_ERROR);

  return ok({
    ...when.data,
    method: "other",
    purpose: "write_off",
    paid_by_office: false,
    reference: null,
    notes: reason.data,
  });
}

/** A stored ledger entry, as far as the caps need it. */
export interface StoredLedgerEntry extends LedgerEntry {
  id: string;
}

/** What a ledger change puts in, or takes out. */
export type LedgerChange =
  | { kind: "add"; entry: PaymentInput }
  | { kind: "replace"; id: string; entry: PaymentInput }
  | { kind: "remove"; id: string };

type Terms = Pick<PaymentSource, "total_cost" | "advance_amount">;

/** Stands in for the entry being added while the ledger is replayed. */
const ADDED = "(added)";

function overpaymentMessage(amount: number, available: number): string {
  const fix =
    "If the customer paid more than agreed, correct the work order's total cost first.";
  if (available > 0) {
    return `${formatCurrency(amount)} is more than the ${formatCurrency(available)} balance due on this contract. ${fix}`;
  }
  if (available === 0) {
    return `Nothing is due on this contract — the balance is ${formatCurrency(0)}. ${fix}`;
  }
  return `This contract is already overpaid by ${formatCurrency(-available)}. ${fix}`;
}

/** The entry being written went past what the ledger allows at its date. */
function writtenProblemMessage(entry: PaymentInput, problem: LedgerProblem): string {
  const amount = formatCurrency(entry.amount);
  const limit = formatCurrency(problem.limit);
  const asOf = formatDate(entry.paid_on);
  if (problem.kind === "refund_over_collected") {
    return problem.limit > 0
      ? `A refund of ${amount} is more than the ${limit} collected on this contract as of ${asOf} (advance and contract payments, less refunds already made).`
      : `Nothing has been collected on this contract as of ${asOf}, so there is nothing to refund.`;
  }
  return problem.limit > 0
    ? `A write-off of ${amount} is more than the ${limit} balance due as of ${asOf}.`
    : `Nothing is due on this contract as of ${asOf}, so there is nothing to write off.`;
}

/** Another entry a change would leave over its limit: what it is, and by how much. */
function leftOver(entry: LedgerEntry, problem: LedgerProblem) {
  const refund = problem.kind === "refund_over_collected";
  const what = refund ? "refund" : "write-off";
  const limit = formatCurrency(problem.limit);
  return {
    what,
    text:
      `the ${what} of ${formatCurrency(Number(entry.amount))} on ${formatDate(entry.paid_on)} ` +
      `larger than the ${limit} ${refund ? "collected" : "due"} by then`,
  };
}

/** The entries already over their limit, whatever the change being considered. */
function problemIds(terms: Terms, entries: readonly StoredLedgerEntry[]): Set<string> {
  return new Set(ledgerProblems(terms, entries).map((p) => entries[p.entry].id));
}

/**
 * Every rule that decides whether the ledger may change, from one place — used
 * for recording, editing and deleting an entry alike:
 *
 *   - a refund never exceeds what was collected (advance + contract payments −
 *     refunds already made) and a write-off never exceeds the balance due,
 *     judged at the entry's date, with the ledger replayed as it happened
 *     (`ledgerProblems`, the rule the import holds a sheet row to);
 *   - the contract may not be taken into overpayment, or deeper into it: the
 *     balance counts refunds and write-offs, so a refund makes room for the
 *     customer to pay again and a write-off takes it away;
 *   - KSEB fees are never capped — they are not contract money.
 *
 * "Not worse": a contract that is already overpaid (its total was lowered
 * later), or a refund that already exceeds its limit, can still have its entries
 * corrected. Only a change that adds a problem is refused — to the entry being
 * written (always checked), or to another entry (a payment lowered below a
 * refund, a payment deleted that a write-off relied on).
 *
 * Returns the contract balance after the change.
 */
export function checkLedgerChange(input: {
  terms: Terms;
  ledger: readonly StoredLedgerEntry[];
  change: LedgerChange;
}): ActionResult<{ balanceAfter: number }> {
  const { terms, ledger, change } = input;
  const others =
    change.kind === "add" ? ledger : ledger.filter((entry) => entry.id !== change.id);
  const entry = change.kind === "remove" ? null : change.entry;
  const writtenId = change.kind === "replace" ? change.id : ADDED;
  const after = entry ? [...others, { ...entry, id: writtenId }] : others;

  const balance = (entries: readonly LedgerEntry[]) =>
    paymentSummary(withLedger(terms, entries)).balanceDue;
  const balanceAfter = balance(after);

  const known = problemIds(terms, ledger);
  const problems = ledgerProblems(terms, after).map((problem) => ({
    problem,
    stored: after[problem.entry],
  }));

  // The entry being written first: whatever else it does, it must itself be valid.
  const own = problems.find(({ stored }) => entry && stored.id === writtenId);
  if (entry && own) return fail(writtenProblemMessage(entry, own.problem));

  const overpaid = balanceAfter < 0 && balanceAfter < balance(ledger);
  if (overpaid && entry?.purpose === "contract") {
    return fail(overpaymentMessage(entry.amount, balance(others)));
  }

  // Then what it does to the others.
  const knockOn = problems.find(({ stored }) => !known.has(stored.id));
  if (knockOn) {
    const over = leftOver(knockOn.stored, knockOn.problem);
    return fail(`This change would leave ${over.text}. Correct that ${over.what} first.`);
  }

  if (overpaid) {
    return fail(
      `This change would leave the contract overpaid by ${formatCurrency(-balanceAfter)}. If a payment was recorded in error, correct it in the payments ledger first.`,
    );
  }
  return ok({ balanceAfter });
}

/**
 * The same caps from the work order's side: new contract terms (total cost and
 * booking advance) may not take the ledger past what it allows — the contract
 * into overpayment, a refund above what was collected, a write-off above the
 * balance. Raising the advance or lowering the total past what has been
 * collected would otherwise settle (or overpay) a contract with no payment
 * recorded. As with an entry edit, terms that do not make anything worse are
 * always allowed, so the other details of an already-overpaid order can still be
 * corrected.
 *
 * Returns the contract balance under the new terms.
 */
export function checkContractTerms(input: {
  current: Terms;
  terms: Terms;
  ledger: readonly LedgerEntry[];
}): ActionResult<{ balanceAfter: number }> {
  const { current, terms, ledger } = input;
  const before = paymentSummary(withLedger(current, ledger)).balanceDue;
  const after = paymentSummary(withLedger(terms, ledger));

  // The same entries under both terms, so an index names the same one in each.
  const known = new Set(ledgerProblems(current, ledger).map((p) => p.entry));
  const problem = ledgerProblems(terms, ledger).find((p) => !known.has(p.entry));
  if (problem) {
    const over = leftOver(ledger[problem.entry], problem);
    return fail(
      `These terms would leave ${over.text}. Correct that ${over.what} in the payments ledger first.`,
    );
  }

  if (after.balanceDue < 0 && after.balanceDue < before) {
    const fix = "If a payment was recorded in error, correct it in the payments ledger first.";
    return fail(
      `The advance and the contract payments recorded come to ${formatCurrency(after.received)}, ` +
        `more than the ${formatCurrency(after.totalCost)} total cost — this contract would be ` +
        `overpaid by ${formatCurrency(-after.balanceDue)}. ${fix}`,
    );
  }
  return ok({ balanceAfter: after.balanceDue });
}

/**
 * What the toast says once an entry is in the ledger. `balanceAfter` is the
 * contract balance after it.
 */
export function recordedMessage(entry: PaymentInput, balanceAfter: number): string {
  const amount = formatCurrency(entry.amount);
  switch (entry.purpose) {
    case "contract":
      return `Payment of ${amount} recorded.`;
    case "kseb_fees":
      return entry.paid_by_office
        ? `KSEB fee of ${amount} recorded as paid by the office.`
        : `KSEB fee of ${amount} recorded.`;
    case "refund":
      return `Refund of ${amount} recorded.`;
    case "write_off":
      return balanceAfter > 0
        ? `${amount} written off — ${formatCurrency(balanceAfter)} still due.`
        : `${amount} written off — the balance is settled.`;
  }
}
