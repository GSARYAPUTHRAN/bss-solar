import { toCsv } from "@/lib/csv";
import {
  IMPORT_HEADERS,
  INCENTIVE_FIELDS,
  PAYMENT_FIELDS,
  incentiveColumn,
  paymentColumn,
} from "./import";
import { TEMPLATE_ROWS, type TemplateColumn } from "./import-template-rows";

/**
 * The sample CSV offered on the onboarding page: every column, and one row for
 * each case the office meets most — a loan-financed project mid-way through
 * staged payments, a commissioned project with money still due, a fresh
 * booking, a sale shared by two coordinators, a custom plan with a balance
 * written off and a refunded sale (its rows are in `import-template-rows.ts`).
 * Every row names its coordinator (a blank cell fails unless a default
 * coordinator is chosen), by name or by e-mail.
 *
 * The rows are examples, not data: left in a real file they are refused ("this
 * is one of the template's example rows — delete it"). Renamed, they must always
 * validate (import-template.test.ts).
 */

const TEMPLATE_INCENTIVE_GROUPS = 3;
const TEMPLATE_PAYMENT_GROUPS = 4;

export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  ...IMPORT_HEADERS,
  ...Array.from({ length: TEMPLATE_INCENTIVE_GROUPS }, (_, i) =>
    INCENTIVE_FIELDS.map((f) => incentiveColumn(i + 1, f)),
  ).flat(),
  ...Array.from({ length: TEMPLATE_PAYMENT_GROUPS }, (_, i) =>
    PAYMENT_FIELDS.map((f) => paymentColumn(i + 1, f)),
  ).flat(),
];

/** A ready-to-edit sample the admin can download. */
export const IMPORT_TEMPLATE = toCsv([
  TEMPLATE_COLUMNS,
  ...TEMPLATE_ROWS.map((row) => TEMPLATE_COLUMNS.map((c) => row[c] ?? "")),
]);
