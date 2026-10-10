import { parseCsvRecords } from "@/lib/csv";
import { formatCurrency } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  ProjectStage,
} from "@/lib/types";
import { isValidCapacity } from "./capacity";
import {
  booleanCell,
  dateCell,
  emailCell,
  financingCell,
  identifierCell,
  moneyCell,
  paymentMethodCell,
  paymentPurposeCell,
  stageCell,
  textCell,
  type Cell,
} from "./import-cells";
import { ledgerTotals, paymentSummary } from "./payment";
import { closestMatch } from "./suggest";

/**
 * The onboarding import: CSV columns, header validation and row rules.
 *
 * Everything here is pure. The server action feeds the rows this module
 * accepts to the `import_projects` RPC (migration 20261010120700), whose input
 * shape `ImportRow` mirrors field for field. The database makes the checks only
 * it can (does the coordinator e-mail exist, is the consumer number already
 * there); this module makes the ones a person can fix in the sheet, and reports
 * every problem in a row at once so a sheet does not take one upload per mistake.
 */

/** Rows per upload; larger sheets are split into several files. */
export const MAX_IMPORT_ROWS = 1000;

export const REQUIRED_IMPORT_HEADERS = [
  "client_name",
  "plant_capacity",
  "total_cost",
] as const;

/** The fixed columns, in template order. Payments follow as `payment_<N>_*`. */
export const IMPORT_HEADERS = [
  ...REQUIRED_IMPORT_HEADERS,
  // work order
  "client_phone",
  "address",
  "advance_amount",
  "order_date",
  "coordinator_email",
  "financing_type",
  "loan_bank_name",
  "consumer_number",
  "kseb_section",
  "notes",
  // project
  "current_stage",
  "is_completed",
  "commissioned_on",
  "feasibility_date",
  "coordinator_incentive",
  "incentive_paid_on",
] as const;

export type ImportHeader = (typeof IMPORT_HEADERS)[number];

/** One payment is a group of these columns: `payment_<N>_<field>`, N ≥ 1. */
export const PAYMENT_FIELDS = ["amount", "date", "method", "purpose", "reference"] as const;
export type PaymentField = (typeof PAYMENT_FIELDS)[number];
export type PaymentColumn = `payment_${number}_${PaymentField}`;

export function paymentColumn(n: number, field: PaymentField): PaymentColumn {
  return `payment_${n}_${field}`;
}

const PAYMENT_COLUMN = new RegExp(`^payment_([1-9]\\d*)_(${PAYMENT_FIELDS.join("|")})$`);

/**
 * The failed-rows download appends this column. The importer ignores it, so a
 * corrected file goes straight back in without deleting anything.
 */
export const IMPORT_ERROR_COLUMN = "import_error";

/** Columns of the old two-instalment template, and where they went. */
const RENAMED_COLUMNS: Record<string, PaymentColumn> = {
  first_payment_amount: "payment_1_amount",
  first_payment_date: "payment_1_date",
  second_payment_amount: "payment_2_amount",
  second_payment_date: "payment_2_date",
};

/** How the column reference on the onboarding page groups the fixed columns. */
export const IMPORT_COLUMN_GROUPS: readonly {
  title: string;
  columns: readonly ImportHeader[];
}[] = [
  { title: "Required", columns: REQUIRED_IMPORT_HEADERS },
  {
    title: "Work order",
    columns: [
      "client_phone",
      "address",
      "advance_amount",
      "order_date",
      "coordinator_email",
      "financing_type",
      "loan_bank_name",
      "notes",
    ],
  },
  {
    title: "Project progress",
    columns: ["current_stage", "is_completed", "commissioned_on"],
  },
  {
    title: "KSEB & feasibility",
    columns: ["consumer_number", "kseb_section", "feasibility_date"],
  },
  { title: "Incentive", columns: ["coordinator_incentive", "incentive_paid_on"] },
];

// --- Header -------------------------------------------------------------------

export interface ImportLayout {
  /** The header row as uploaded (lower-cased), for the failed-rows download. */
  headers: string[];
  /** Payment group numbers present, ascending. */
  paymentSlots: number[];
}

const FIXED_COLUMNS = new Set<string>(IMPORT_HEADERS);

function quoteList(names: readonly string[]): string {
  return names.map((n) => `"${n}"`).join(", ");
}

/** "did you mean" candidates: fixed columns + the payment group the name hints at. */
function suggestColumn(name: string): string | null {
  const n = Number(/\d+/.exec(name)?.[0] ?? 1) || 1;
  return closestMatch(name, [
    ...IMPORT_HEADERS,
    ...PAYMENT_FIELDS.map((f) => paymentColumn(n, f)),
  ]);
}

/**
 * Check the header row before any data row: unknown, duplicated, renamed or
 * missing columns, and payment groups without both an amount and a date
 * column. Every problem is reported in one message.
 */
export function validateImportHeaders(headers: readonly string[]): ActionResult<ImportLayout> {
  const named = headers.filter(Boolean);
  const problems: string[] = [];

  const duplicates = [...new Set(named.filter((h, i) => named.indexOf(h) !== i))];
  if (duplicates.length) {
    problems.push(`These columns appear more than once: ${quoteList(duplicates)}.`);
  }

  // hasOwn, not `in`: a header such as "constructor" must not match the prototype.
  const isRenamed = (h: string) => Object.hasOwn(RENAMED_COLUMNS, h);
  const renamed = named.filter(isRenamed);
  if (renamed.length) {
    problems.push(
      `Payments now go in numbered groups — rename ${renamed
        .map((h) => `"${h}" to "${RENAMED_COLUMNS[h]}"`)
        .join(", ")}.`,
    );
  }

  const slots = new Map<number, Set<string>>();
  const unknown: string[] = [];
  for (const h of named) {
    if (FIXED_COLUMNS.has(h) || h === IMPORT_ERROR_COLUMN || isRenamed(h)) continue;
    const m = PAYMENT_COLUMN.exec(h);
    if (m) {
      const n = Number(m[1]);
      slots.set(n, (slots.get(n) ?? new Set()).add(m[2]));
    } else {
      unknown.push(h);
    }
  }
  if (unknown.length) {
    const described = unknown.map((h) => {
      const guess = suggestColumn(h);
      return guess ? `"${h}" (did you mean "${guess}"?)` : `"${h}"`;
    });
    problems.push(`Unknown columns: ${described.join(", ")}.`);
  }

  const missing = REQUIRED_IMPORT_HEADERS.filter((h) => !named.includes(h));
  if (missing.length) {
    problems.push(`Missing required columns: ${quoteList(missing)}.`);
  }

  const groups = [...slots].sort(([a], [b]) => a - b);
  for (const [n, fields] of groups) {
    const lacking = (["amount", "date"] as const).filter((f) => !fields.has(f));
    if (lacking.length) {
      problems.push(
        `Payment ${n} needs ${quoteList(lacking.map((f) => paymentColumn(n, f)))} ${
          lacking.length === 1 ? "column" : "columns"
        }.`,
      );
    }
  }

  if (problems.length) {
    return fail(`The header row needs fixing. ${problems.join(" ")}`);
  }
  return ok({ headers: [...headers], paymentSlots: groups.map(([n]) => n) });
}

// --- Rows ---------------------------------------------------------------------

/**
 * One ledger entry for `import_projects`. A `type` (not an interface) so it is
 * assignable to the RPC's JSON parameter.
 */
export type ImportPayment = {
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  purpose: PaymentPurpose;
  reference: string | null;
  notes: string | null;
};

/** A validated row, exactly the `import_projects` input row. */
export type ImportRow = {
  row_no: number;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  plant_capacity: string;
  total_cost: number;
  advance_amount: number;
  order_date: string;
  coordinator_email: string | null;
  financing_type: FinancingType;
  loan_bank_name: string | null;
  consumer_number: string | null;
  kseb_section: string | null;
  notes: string | null;
  current_stage: ProjectStage;
  is_completed: boolean;
  commissioned_on: string | null;
  feasibility_date: string | null;
  coordinator_incentive: number | null;
  incentive_paid_on: string | null;
  payments: ImportPayment[];
};

export interface ImportRowContext {
  /** IST "today" — dates after it are typos. Passed in; never read here. */
  today: string;
  /** From `validateImportHeaders`. */
  paymentSlots: readonly number[];
}

/** One data row, keyed by lower-cased header. */
type CsvRecord = Readonly<Record<string, string>>;

/** Collects every problem in a row instead of stopping at the first. */
class RowProblems {
  readonly list: string[] = [];

  add(problem: string) {
    this.list.push(problem);
  }

  /** The cell's value, or `fallback` after recording its error. */
  take<T>(cell: Cell<T>, fallback: T): T {
    if (cell.ok) return cell.data;
    this.list.push(cell.error);
    return fallback;
  }
}

function required<T>(cell: Cell<T | null>, message: string): Cell<T> {
  if (!cell.ok) return cell;
  return cell.data === null ? fail(message) : ok(cell.data);
}

/** One `payment_<N>_*` group; null when the group is blank on this row. */
function parsePayment(
  record: CsvRecord,
  n: number,
  today: string,
  problems: RowProblems,
): ImportPayment | null {
  const cell = (field: PaymentField) => record[paymentColumn(n, field)] ?? "";
  if (PAYMENT_FIELDS.every((f) => !cell(f).trim())) return null;

  const amountCol = paymentColumn(n, "amount");
  const dateCol = paymentColumn(n, "date");
  const amount = problems.take(
    required(
      moneyCell(cell("amount"), amountCol, { positive: true }),
      `${amountCol} is required — other payment ${n} cells are filled`,
    ),
    null,
  );
  const paid_on = problems.take(
    required(
      dateCell(cell("date"), dateCol, { notAfter: today }),
      `${dateCol} is required — other payment ${n} cells are filled`,
    ),
    null,
  );
  const method = problems.take(
    paymentMethodCell(cell("method"), paymentColumn(n, "method")),
    "other",
  );
  const purpose = problems.take(
    paymentPurposeCell(cell("purpose"), paymentColumn(n, "purpose")),
    "contract",
  );
  if (amount === null || paid_on === null) return null;
  return { amount, paid_on, method, purpose, reference: textCell(cell("reference")), notes: null };
}

/** The three required columns; nulls only alongside a recorded problem. */
function readRequired(record: CsvRecord, p: RowProblems) {
  const client_name = textCell(record.client_name);
  if (!client_name) p.add("client_name is required");
  const plant_capacity = textCell(record.plant_capacity);
  if (!plant_capacity) {
    p.add("plant_capacity is required");
  } else if (!isValidCapacity(plant_capacity)) {
    p.add(`plant_capacity "${plant_capacity}" has no capacity in it — write it like 3kW or 3000W`);
  }
  const total_cost = p.take(
    required(moneyCell(record.total_cost, "total_cost"), "total_cost is required"),
    null,
  );
  return { client_name, plant_capacity, total_cost };
}

function readWorkOrder(record: CsvRecord, today: string, p: RowProblems) {
  const loan_bank_name = textCell(record.loan_bank_name);
  const financing = p.take(financingCell(record.financing_type), null);
  if (financing === "self" && loan_bank_name) {
    p.add(
      `loan_bank_name "${loan_bank_name}" is filled but financing_type is self — set financing_type to loan or clear the bank`,
    );
  }
  return {
    client_phone: p.take(identifierCell(record.client_phone, "client_phone"), null),
    address: textCell(record.address),
    advance_amount: p.take(moneyCell(record.advance_amount, "advance_amount"), null) ?? 0,
    order_date:
      p.take(dateCell(record.order_date, "order_date", { notAfter: today }), null) ?? today,
    coordinator_email: p.take(emailCell(record.coordinator_email, "coordinator_email"), null),
    // A named lender means a loan even when the financing cell was left blank.
    financing_type: financing ?? (loan_bank_name ? "loan" : "self"),
    loan_bank_name,
    consumer_number: p.take(identifierCell(record.consumer_number, "consumer_number"), null),
    kseb_section: textCell(record.kseb_section),
    notes: textCell(record.notes),
  } satisfies Partial<ImportRow>;
}

/** Stage, commissioning and the feasibility clock, checked against each other. */
function readProgress(record: CsvRecord, today: string, orderDate: string, p: RowProblems) {
  const notFuture = { notAfter: today };
  const feasibility_date = p.take(
    dateCell(record.feasibility_date, "feasibility_date", notFuture),
    null,
  );
  const commissioned_on = p.take(
    dateCell(record.commissioned_on, "commissioned_on", notFuture),
    null,
  );
  const completed = p.take(booleanCell(record.is_completed, "is_completed"), null);
  if (completed === false && commissioned_on) {
    p.add("commissioned_on is filled but is_completed is no — clear one of them");
  }
  // A commissioning date means the plant is commissioned.
  const is_completed = completed ?? commissioned_on !== null;
  if (is_completed && feasibility_date && !commissioned_on) {
    p.add(
      "commissioned_on is required when a commissioned project has a feasibility_date — it stops the feasibility clock",
    );
  }
  if (commissioned_on && feasibility_date && commissioned_on < feasibility_date) {
    p.add(`commissioned_on ${commissioned_on} is before feasibility_date ${feasibility_date}`);
  }
  if (commissioned_on && commissioned_on < orderDate) {
    p.add(
      textCell(record.order_date)
        ? `commissioned_on ${commissioned_on} is before order_date ${orderDate}`
        : `order_date is needed — left blank it means today, which is after commissioned_on ${commissioned_on}`,
    );
  }
  const stage = p.take(stageCell(record.current_stage), "site_feasibility_survey");
  return {
    current_stage: is_completed ? "plant_commissioning" : stage,
    is_completed,
    commissioned_on,
    feasibility_date,
  } satisfies Partial<ImportRow>;
}

function readIncentive(record: CsvRecord, today: string, p: RowProblems) {
  const incentive = moneyCell(record.coordinator_incentive, "coordinator_incentive");
  const coordinator_incentive = p.take(incentive, null);
  const incentive_paid_on = p.take(
    dateCell(record.incentive_paid_on, "incentive_paid_on", { notAfter: today }),
    null,
  );
  // Only when the amount is genuinely blank — a malformed one is already reported.
  if (incentive_paid_on && incentive.ok && incentive.data === null) {
    p.add("incentive_paid_on needs a coordinator_incentive amount");
  }
  return { coordinator_incentive, incentive_paid_on } satisfies Partial<ImportRow>;
}

/**
 * Typo guard: more collected than the contract is worth is almost always a
 * slipped digit, and it would hide a real balance. KSEB fees are not counted.
 */
function checkCollections(
  totalCost: number,
  advance: number,
  payments: readonly ImportPayment[],
  p: RowProblems,
) {
  const { received, balanceDue } = paymentSummary({
    total_cost: totalCost,
    advance_amount: advance,
    payments_total: ledgerTotals(payments).contract,
  });
  if (balanceDue < 0) {
    p.add(
      `advance_amount plus contract payments come to ${formatCurrency(received)}, more than total_cost ${formatCurrency(totalCost)} — check for a typo`,
    );
  }
}

/**
 * Validate and normalise one CSV record. Returns the RPC row, or every problem
 * in the row joined into one message.
 */
export function parseImportRow(
  record: CsvRecord,
  rowNo: number,
  { today, paymentSlots }: ImportRowContext,
): ActionResult<ImportRow> {
  const p = new RowProblems();
  const { client_name, plant_capacity, total_cost } = readRequired(record, p);
  const workOrder = readWorkOrder(record, today, p);
  const progress = readProgress(record, today, workOrder.order_date, p);
  const incentive = readIncentive(record, today, p);
  const payments = paymentSlots.flatMap((n) => parsePayment(record, n, today, p) ?? []);
  if (total_cost !== null) {
    checkCollections(total_cost, workOrder.advance_amount, payments, p);
  }

  // The null checks only narrow types: a missing required value always
  // recorded a problem above.
  if (p.list.length || !client_name || !plant_capacity || total_cost === null) {
    return fail(p.list.join("; "));
  }
  return ok({
    row_no: rowNo,
    client_name,
    plant_capacity,
    total_cost,
    ...workOrder,
    ...progress,
    ...incentive,
    payments,
  });
}

// --- File ---------------------------------------------------------------------

export interface PlannedRow {
  /** Row number in the sheet: the header is row 1; fully blank lines are skipped. */
  rowNo: number;
  /** Client name as typed, for the results list ("" when missing). */
  client: string;
  /** The row's cells as uploaded, for the failed-rows download. */
  cells: Readonly<Record<string, string>>;
  parsed: ActionResult<ImportRow>;
}

export interface ImportPlan {
  headers: string[];
  rows: PlannedRow[];
}

/**
 * Parse and validate a whole upload. A file-level problem (empty, malformed
 * quoting, bad header, too many rows) is an error; row problems — values past
 * the last column included — are carried per row so the valid rows can still
 * be imported.
 */
export function planImport(text: string, today: string): ActionResult<ImportPlan> {
  if (!text.trim()) return fail("Paste CSV or choose a file first.");
  const csv = parseCsvRecords(text);
  if ("error" in csv) return fail(csv.error);
  const layout = validateImportHeaders(csv.headers);
  if (!layout.ok) return layout;
  if (csv.records.length === 0) return fail("No data rows found below the header.");
  if (csv.records.length > MAX_IMPORT_ROWS) {
    return fail(
      `Too many rows (${csv.records.length}). Import up to ${MAX_IMPORT_ROWS} at a time — split the file and upload each part.`,
    );
  }

  const ctx = { today, paymentSlots: layout.data.paymentSlots };
  const rows = csv.records.map(({ cells, problem }, i): PlannedRow => {
    const rowNo = i + 2;
    const parsed = parseImportRow(cells, rowNo, ctx);
    return {
      rowNo,
      client: textCell(cells.client_name) ?? "",
      cells,
      // The CSV problem goes first: a split value shifts every cell after it,
      // which usually explains the rest.
      parsed: problem ? fail(parsed.ok ? problem : `${problem}; ${parsed.error}`) : parsed,
    };
  });
  return ok({ headers: layout.data.headers, rows });
}
