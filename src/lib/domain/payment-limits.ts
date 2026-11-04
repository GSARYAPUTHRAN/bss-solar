/**
 * Bounds on a payments-ledger entry, shared by the form (input constraints) and
 * the server-side parser (the rule of record).
 */
export const PAYMENT_LIMITS = {
  /** `payments.amount` is numeric(12,2). */
  maxAmount: 9_999_999_999.99,
  referenceLength: 100,
  /** A write-off's reason is its note, so it is held to the same length. */
  notesLength: 500,
  /** The booking advance's cheque number / UTR / UPI reference, on the work order. */
  advanceReferenceLength: 100,
} as const;
