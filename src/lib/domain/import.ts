import { parseCsvRecords } from "@/lib/csv";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  PlanType,
  ProjectCancellation,
  ProjectStage,
} from "@/lib/types";
import { capacityProblem, capacitySum, formatKw } from "./capacity";
import { CANCELLATION_REMARKS_MAX } from "./cancellation";
import {
  analyzeCoordinatorCell,
  type CoordinatorDirectory,
  type CoordinatorMatch,
  type CoordinatorReference,
  type DirectoryAccount,
} from "./coordinator-match";
import { monthKey, monthName } from "./dates";
import {
  advanceMethodCell,
  booleanCell,
  cancellationCell,
  dateCellRead,
  financingCell,
  identifierCell,
  moneyCell,
  moneyPartsCell,
  paymentMethodCell,
  paymentPurposeCell,
  planTypeCell,
  stageCell,
  textCell,
  type Cell,
  type DateRead,
} from "./import-cells";
import { TEMPLATE_ROWS } from "./import-template-rows";
import { ledgerProblems, ledgerTotals, paymentSummary, withLedger } from "./payment";
import { PAYMENT_LIMITS } from "./payment-limits";
import { HANDOVER_STAGE, PLAN_LABEL_MAX } from "./plan";
import { WORK_ORDER_OWNER_ROLES } from "./role";
import { round2 } from "./rounding";
import { closestMatch } from "./suggest";

/**
 * The onboarding import: CSV columns, header validation and row rules.
 *
 * Everything here is pure. The server action feeds the rows this module
 * accepts to the `import_projects` RPC (migration 20261104120200), whose input
 * shape `ImportRow` mirrors field for field. The database makes the checks only
 * it can (is the consumer number already there, does an id still belong to a
 * coordinator); this module makes the ones a person can fix in the sheet — who
 * the coordinators are included, resolved against the team's accounts — and
 * reports every problem in a row at once so a sheet does not take one upload
 * per mistake.
 *
 * The import never invents data: a coordinator is never guessed from a close
 * spelling, a date the sheet leaves out stays unknown, and a blank coordinator
 * cell is a problem unless the office chose a default for it. Dates are read
 * day first, never month first.
 */

/** Rows per upload; larger sheets are split into several files. */
export const MAX_IMPORT_ROWS = 1000;

export const REQUIRED_IMPORT_HEADERS = [
  "client_name",
  "plant_capacity",
  "total_cost",
] as const;

/**
 * The fixed columns, in template order. The incentive instalments follow as
 * `incentive_<N>_*` and the ledger entries as `payment_<N>_*`.
 */
export const IMPORT_HEADERS = [
  ...REQUIRED_IMPORT_HEADERS,
  // work order
  "client_phone",
  "address",
  "advance_amount",
  "advance_method",
  "advance_date",
  "advance_reference",
  "order_date",
  "coordinator",
  "plan_type",
  "financing_type",
  "loan_bank_name",
  "consumer_number",
  "kseb_section",
  "notes",
  // project
  "current_stage",
  "is_completed",
  "commissioned_on",
  "cancellation",
  "cancelled_on",
  "cancellation_remarks",
  "feasibility_date",
  "coordinator_incentive",
  "incentive_paid_on",
] as const;

export type ImportHeader = (typeof IMPORT_HEADERS)[number];

/**
 * Other names a column goes by: the sheets and templates from before the
 * column held names, e-mails and several people. Accepted silently; a file
 * with an alias and its canonical column is refused (they are one column).
 */
export const IMPORT_HEADER_ALIASES: Readonly<Record<string, ImportHeader>> = {
  coordinator_email: "coordinator",
  coordinators: "coordinator",
  plan: "plan_type",
};

/** One payment is a group of these columns: `payment_<N>_<field>`, N ≥ 1. */
export const PAYMENT_FIELDS = [
  "amount",
  "date",
  "method",
  "purpose",
  "reference",
  "paid_by_office",
] as const;
export type PaymentField = (typeof PAYMENT_FIELDS)[number];
export type PaymentColumn = `payment_${number}_${PaymentField}`;

export function paymentColumn(n: number, field: PaymentField): PaymentColumn {
  return `payment_${n}_${field}`;
}

const PAYMENT_COLUMN = new RegExp(`^payment_([1-9]\\d*)_(${PAYMENT_FIELDS.join("|")})$`);

/**
 * One incentive instalment is a group of these columns:
 * `incentive_<N>_<field>`, N ≥ 1. A group with a date is PAID; one without is a
 * still-unpaid part of that coordinator's agreed incentive.
 */
export const INCENTIVE_FIELDS = ["coordinator", "amount", "date"] as const;
export type IncentiveField = (typeof INCENTIVE_FIELDS)[number];
export type IncentiveColumn = `incentive_${number}_${IncentiveField}`;

export function incentiveColumn(n: number, field: IncentiveField): IncentiveColumn {
  return `incentive_${n}_${field}`;
}

const INCENTIVE_COLUMN = new RegExp(`^incentive_([1-9]\\d*)_(${INCENTIVE_FIELDS.join("|")})$`);

/**
 * The failed-rows download appends this column. The importer ignores it, so a
 * corrected file goes straight back in without deleting anything.
 */
export const IMPORT_ERROR_COLUMN = "import_error";

/**
 * What a cancelled or refunded row's `plant_capacity` is stored as when the
 * sheet has none: old cancellations often lack the figures, and "Not recorded"
 * is true where a made-up capacity would not be.
 */
export const NOT_RECORDED_LABEL = "Not recorded";

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
      "advance_method",
      "advance_date",
      "advance_reference",
      "order_date",
      "coordinator",
      "plan_type",
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
    title: "Cancelled / refunded",
    columns: ["cancellation", "cancelled_on", "cancellation_remarks"],
  },
  {
    title: "KSEB & feasibility",
    columns: ["consumer_number", "kseb_section", "feasibility_date"],
  },
  {
    title: "Incentive — one coordinator",
    columns: ["coordinator_incentive", "incentive_paid_on"],
  },
];

// --- Header -------------------------------------------------------------------

export interface ImportLayout {
  /** The header row as uploaded (lower-cased), for the failed-rows download. */
  headers: string[];
  /** Payment group numbers present, ascending. */
  paymentSlots: number[];
  /** Incentive group numbers present, ascending. */
  incentiveSlots: number[];
  /** Each fixed column of the file, by the name it was uploaded under, and the column it is. */
  canonical: Record<string, ImportHeader>;
}

const FIXED_COLUMNS = new Set<string>(IMPORT_HEADERS);

function quoteList(names: readonly string[]): string {
  return names.map((n) => `"${n}"`).join(", ");
}

/** `"a" and "b"`, `"a", "b" and "c"`. */
function quoteAnd(names: readonly string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  return quoted.length < 2
    ? quoted.join("")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/** "did you mean" candidates: fixed columns + the payment and incentive groups the name hints at. */
function suggestColumn(name: string): string | null {
  const n = Number(/\d+/.exec(name)?.[0] ?? 1) || 1;
  return closestMatch(name, [
    ...IMPORT_HEADERS,
    ...PAYMENT_FIELDS.map((f) => paymentColumn(n, f)),
    ...INCENTIVE_FIELDS.map((f) => incentiveColumn(n, f)),
  ]);
}

/**
 * Check the header row before any data row: unknown, duplicated, renamed or
 * missing columns, one column under two names, payment groups without both an
 * amount and a date column, and incentive groups without an amount column.
 * Every problem is reported in one message.
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

  const canonical: Record<string, ImportHeader> = {};
  const slots = new Map<number, Set<string>>();
  const incentiveSlots = new Map<number, Set<string>>();
  const unknown: string[] = [];
  for (const h of named) {
    if (FIXED_COLUMNS.has(h)) {
      canonical[h] = h as ImportHeader;
    } else if (Object.hasOwn(IMPORT_HEADER_ALIASES, h)) {
      canonical[h] = IMPORT_HEADER_ALIASES[h];
    } else if (h === IMPORT_ERROR_COLUMN || isRenamed(h)) {
      continue;
    } else {
      const m = PAYMENT_COLUMN.exec(h);
      const i = INCENTIVE_COLUMN.exec(h);
      if (m) {
        const n = Number(m[1]);
        slots.set(n, (slots.get(n) ?? new Set()).add(m[2]));
      } else if (i) {
        const n = Number(i[1]);
        incentiveSlots.set(n, (incentiveSlots.get(n) ?? new Set()).add(i[2]));
      } else {
        unknown.push(h);
      }
    }
  }

  // The same column under two names (an alias and its canonical, or two aliases).
  const byColumn = new Map<ImportHeader, string[]>();
  for (const [uploaded, column] of Object.entries(canonical)) {
    byColumn.set(column, [...(byColumn.get(column) ?? []), uploaded]);
  }
  for (const [column, uploaded] of byColumn) {
    if (uploaded.length > 1) {
      // The canonical name last: "coordinator_email" and "coordinator".
      const ordered = [...uploaded.filter((u) => u !== column), ...uploaded.filter((u) => u === column)];
      problems.push(`${quoteAnd(ordered)} are the same column — keep one.`);
    }
  }

  if (unknown.length) {
    const described = unknown.map((h) => {
      const guess = suggestColumn(h);
      return guess ? `"${h}" (did you mean "${guess}"?)` : `"${h}"`;
    });
    problems.push(`Unknown columns: ${described.join(", ")}.`);
  }

  const present = new Set(Object.values(canonical));
  const missing = REQUIRED_IMPORT_HEADERS.filter((h) => !present.has(h));
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

  const incentiveGroups = [...incentiveSlots].sort(([a], [b]) => a - b);
  for (const [n, fields] of incentiveGroups) {
    if (!fields.has("amount")) {
      problems.push(`Incentive ${n} needs an "${incentiveColumn(n, "amount")}" column.`);
    }
  }

  if (problems.length) {
    return fail(`The header row needs fixing. ${problems.join(" ")}`);
  }
  return ok({
    headers: [...headers],
    paymentSlots: groups.map(([n]) => n),
    incentiveSlots: incentiveGroups.map(([n]) => n),
    canonical,
  });
}

/** The name the sheet used for each fixed column that has one, for messages. */
function uploadedNames(layout: ImportLayout): Partial<Record<ImportHeader, string>> {
  const names: Partial<Record<ImportHeader, string>> = {};
  for (const [uploaded, column] of Object.entries(layout.canonical)) names[column] = uploaded;
  return names;
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
  /** `kseb_fees` only: the office paid KSEB, not the customer. */
  paid_by_office: boolean;
  reference: string | null;
  /** A write-off's reason (the database requires one); null for every other entry. */
  notes: string | null;
};

/** One dated instalment paid against an incentive (`coordinator_incentive_payments`). */
export type ImportIncentivePayment = {
  amount: number;
  paid_on: string;
  note: string | null;
};

/**
 * One coordinator's incentive on a sale (`import_projects` →
 * `coordinator_incentives`): the AGREED total, and the instalments already paid
 * against it. The paid instalments never add up to more than `amount`; the rest
 * is still to pay.
 */
export type ImportIncentive = {
  coordinator_id: string;
  amount: number;
  payments: ImportIncentivePayment[];
};

/** A validated row, exactly the `import_projects` input row. */
export type ImportRow = {
  row_no: number;
  client_name: string;
  client_phone: string | null;
  address: string | null;
  plan_type: PlanType;
  /** The plan label: a kW capacity, or what a custom plan sold. */
  plant_capacity: string;
  total_cost: number;
  advance_amount: number;
  /** How the advance was paid; null when the sheet does not say. */
  advance_method: PaymentMethod | null;
  /** When the advance was received; null when the sheet does not say. */
  advance_paid_on: string | null;
  advance_reference: string | null;
  order_date: string;
  /** 1 to 5 accounts, in the order written; the first is the first coordinator. */
  coordinator_ids: string[];
  financing_type: FinancingType;
  loan_bank_name: string | null;
  consumer_number: string | null;
  kseb_section: string | null;
  notes: string | null;
  /** Always one of the plan's milestones (`stagesFor(plan_type)`). */
  current_stage: ProjectStage;
  is_completed: boolean;
  commissioned_on: string | null;
  feasibility_date: string | null;
  /** One entry per coordinator who has an incentive; a shared sale's pay is never split by guess. */
  incentives: ImportIncentive[];
  cancellation: ProjectCancellation | null;
  cancelled_on: string | null;
  cancellation_remarks: string | null;
  payments: ImportPayment[];
};

export interface ImportRowContext {
  /** IST "today" — dates after it are typos. Passed in; never read here. */
  today: string;
  /** From `validateImportHeaders`. */
  paymentSlots: readonly number[];
  /** From `validateImportHeaders`: the `incentive_<N>_*` groups the file has. */
  incentiveSlots: readonly number[];
  /** The team's accounts, for the coordinator cell. */
  directory: CoordinatorDirectory;
  /** Who a blank coordinator cell means; null when the office chose none. */
  defaultCoordinator: DirectoryAccount | null;
  /** The name the sheet used for an aliased column ("coordinator_email"), for messages. */
  columnNames?: Readonly<Partial<Record<ImportHeader, string>>>;
}

/** One data row, keyed by canonical column name (and `payment_<N>_*`). */
type CsvRecord = Readonly<Record<string, string>>;

/** Collects every problem in a row instead of stopping at the first. */
class RowProblems {
  readonly list: string[] = [];
  /** The date cells read day / month / year (anything but ISO), in the order met. */
  readonly dayFirst: DateRead[] = [];

  add(problem: string) {
    this.list.push(problem);
  }

  /** The cell's value, or `fallback` after recording its error. */
  take<T>(cell: Cell<T>, fallback: T): T {
    if (cell.ok) return cell.data;
    this.list.push(cell.error);
    return fallback;
  }

  /** A date cell as its ISO date; notes a day-first reading for the file's summary. */
  dateCell(
    raw: string | undefined,
    column: string,
    options: { notAfter?: string } = {},
  ): Cell<string | null> {
    const read = dateCellRead(raw, column, options);
    if (!read.ok) return read;
    if (read.data?.dayFirst) this.dayFirst.push(read.data);
    return ok(read.data?.iso ?? null);
  }
}

function required<T>(cell: Cell<T | null>, message: string): Cell<T> {
  if (!cell.ok) return cell;
  return cell.data === null ? fail(message) : ok(cell.data);
}

/**
 * One `payment_<N>_*` group; null when the group is blank on this row.
 * `rowNotes` is the row's `notes` cell: a write-off with no reference of its
 * own takes it as its reason.
 */
function parsePayment(
  record: CsvRecord,
  n: number,
  today: string,
  rowNotes: string | null,
  p: RowProblems,
): ImportPayment | null {
  const cell = (field: PaymentField) => record[paymentColumn(n, field)] ?? "";
  if (PAYMENT_FIELDS.every((f) => !cell(f).trim())) return null;

  const amountCol = paymentColumn(n, "amount");
  const dateCol = paymentColumn(n, "date");
  const amount = p.take(
    required(
      moneyCell(cell("amount"), amountCol, { positive: true }),
      `${amountCol} is required — other payment ${n} cells are filled`,
    ),
    null,
  );
  const paid_on = p.take(
    required(
      p.dateCell(cell("date"), dateCol, { notAfter: today }),
      `${dateCol} is required — other payment ${n} cells are filled`,
    ),
    null,
  );
  const method = p.take(paymentMethodCell(cell("method"), paymentColumn(n, "method")), "other");
  const purposeCell = paymentPurposeCell(cell("purpose"), paymentColumn(n, "purpose"));
  const purpose = p.take(purposeCell, "contract");

  const officeCol = paymentColumn(n, "paid_by_office");
  const paidByOffice = p.take(booleanCell(cell("paid_by_office"), officeCol), null);
  // An unreadable purpose is already reported; do not also say it is not KSEB.
  if (paidByOffice === true && purposeCell.ok && purpose !== "kseb_fees") {
    p.add(`${officeCol} is only for a payment_${n}_purpose of kseb_fees — the office pays KSEB, not the contract`);
  }

  let reference = textCell(cell("reference"));
  let notes: string | null = null;
  if (purpose === "write_off") {
    // The reason is mandatory, and it is kept as the entry's note.
    const refCol = paymentColumn(n, "reference");
    const reason = reference ?? rowNotes;
    if (reason === null) {
      p.add(
        `${refCol} is required for a write_off — say why the balance is being written off (or fill the row's notes)`,
      );
    } else if (reason.length > PAYMENT_LIMITS.notesLength) {
      p.add(
        `${refCol} is too long for a write-off reason (${reason.length} characters; the most is ${PAYMENT_LIMITS.notesLength})`,
      );
    }
    notes = reason;
    reference = null;
  }
  if (amount === null || paid_on === null) return null;
  return { amount, paid_on, method, purpose, paid_by_office: paidByOffice === true, reference, notes };
}

type ColumnName = (header: ImportHeader) => string;

/** What kind of sale the row is, read first: the other columns' rules depend on it. */
function readKind(record: CsvRecord, p: RowProblems, name: ColumnName) {
  const plan = planTypeCell(record.plan_type, name("plan_type"));
  const cancellation = cancellationCell(record.cancellation, name("cancellation"));
  return {
    plan: p.take(plan, "solar"),
    /** False when the cell was unreadable — rules that depend on it hold their tongue. */
    planKnown: plan.ok,
    cancellation: p.take(cancellation, null),
    cancellationKnown: cancellation.ok,
  };
}

type Kind = ReturnType<typeof readKind>;

/** Why a plan label is no good, in the sheet's words. */
function labelProblem(plan: PlanType, label: string, name: ColumnName): string | null {
  if (plan === "solar") {
    return capacityProblem(label)
      ? `plant_capacity "${label}" is not a kW capacity — write it like 3kW, or set ${name("plan_type")} to custom for a sale that is not a solar plant`
      : null;
  }
  return label.length > PLAN_LABEL_MAX
    ? `plant_capacity is too long for a custom plan (${label.length} characters; the most is ${PLAN_LABEL_MAX})`
    : null;
}

/** The three required columns; nulls only alongside a recorded problem. */
function readRequired(
  record: CsvRecord,
  kind: Kind,
  p: RowProblems,
  name: ColumnName,
  warnings: string[],
) {
  const cancelled = kind.cancellation !== null;
  const client_name = textCell(record.client_name);
  if (!client_name) p.add("client_name is required");

  let plant_capacity = textCell(record.plant_capacity);
  if (!plant_capacity) {
    if (cancelled) plant_capacity = NOT_RECORDED_LABEL;
    else p.add("plant_capacity is required");
  } else if (kind.planKnown) {
    const problem = labelProblem(kind.plan, plant_capacity, name);
    if (problem) {
      p.add(problem);
    } else if (kind.plan === "solar") {
      // "3kW+2kW" is a 5 kW plant: store the total, and say how it was read.
      const sum = capacitySum(plant_capacity);
      if (sum) {
        warnings.push(`plant_capacity "${plant_capacity}" read as ${formatKw(sum.kw)}`);
        plant_capacity = sum.label;
      }
    }
  }

  const cost = moneyCell(record.total_cost, "total_cost");
  // A cancelled row may have lost its price; it is 0, and the typo guard on
  // collections has nothing to compare with.
  const costUnknown = cancelled && cost.ok && cost.data === null;
  const total_cost = costUnknown
    ? 0
    : p.take(required(cost, "total_cost is required"), null);
  return { client_name, plant_capacity, total_cost, costUnknown };
}

function readWorkOrder(
  record: CsvRecord,
  ctx: ImportRowContext,
  kind: Kind,
  p: RowProblems,
  warnings: string[],
) {
  const { today } = ctx;
  const loan_bank_name = textCell(record.loan_bank_name);
  const financing = p.take(financingCell(record.financing_type), null);
  if (financing === "self" && loan_bank_name) {
    p.add(
      `loan_bank_name "${loan_bank_name}" is filled but financing_type is self — set financing_type to loan or clear the bank`,
    );
  }

  const written = p.dateCell(record.order_date, "order_date", { notAfter: today });
  const orderDateBlank = written.ok && written.data === null;
  const parsedDate = p.take(written, null);
  if (orderDateBlank) {
    if (kind.cancellation !== null) {
      p.add(
        "order_date is required for a cancelled or refunded row — the import never invents dates",
      );
    } else {
      warnings.push(`order_date is blank — today (${today}) will be used`);
    }
  }

  const advance = moneyCell(record.advance_amount, "advance_amount");
  const advance_amount = p.take(advance, null) ?? 0;
  const advance_method = p.take(advanceMethodCell(record.advance_method, "advance_method"), null);
  const advance_paid_on = p.take(
    p.dateCell(record.advance_date, "advance_date", { notAfter: today }),
    null,
  );
  const advance_reference = textCell(record.advance_reference);
  if (advance_reference && advance_reference.length > PAYMENT_LIMITS.advanceReferenceLength) {
    p.add(
      `advance_reference is too long (${advance_reference.length} characters; the most is ${PAYMENT_LIMITS.advanceReferenceLength})`,
    );
  }
  // How and when an advance was paid means nothing without the advance. A
  // malformed amount is already reported; do not also call it blank.
  const described = [
    advance_method && "advance_method",
    advance_paid_on && "advance_date",
    advance_reference && "advance_reference",
  ].filter((column): column is string => Boolean(column));
  if (advance.ok && advance_amount === 0 && described.length > 0) {
    p.add(
      `${described.join(", ")} ${described.length === 1 ? "is" : "are"} filled but advance_amount is blank or zero — enter the advance, or clear ${described.length === 1 ? "it" : "them"}`,
    );
  }

  return {
    client_phone: p.take(identifierCell(record.client_phone, "client_phone"), null),
    address: textCell(record.address),
    advance_amount,
    advance_method,
    advance_paid_on,
    advance_reference,
    order_date: parsedDate ?? today,
    /** The row said when it was ordered (a blank one is today, or refused). */
    orderDateGiven: parsedDate !== null,
    orderDateBlank,
    // A named lender means a loan even when the financing cell was left blank.
    financing_type: financing ?? (loan_bank_name ? "loan" : "self"),
    loan_bank_name,
    consumer_number: p.take(identifierCell(record.consumer_number, "consumer_number"), null),
    kseb_section: textCell(record.kseb_section),
  };
}

/** Who owns the sale, from the coordinator cell (or the default). */
function readCoordinators(
  record: CsvRecord,
  ctx: ImportRowContext,
  p: RowProblems,
  name: ColumnName,
) {
  const column = name("coordinator");
  const analysis = analyzeCoordinatorCell(record.coordinator, ctx.directory, column);

  if (analysis.blank) {
    const fallback = ctx.defaultCoordinator;
    if (!fallback) {
      p.add(
        `${column} is blank and no default coordinator was chosen — name the coordinator, or choose a default coordinator above`,
      );
    }
    return {
      ids: fallback ? [fallback.id] : [],
      names: fallback ? [fallback.fullName] : [],
      defaulted: fallback !== null,
      blank: true,
      asides: [] as string[],
      references: [] as CoordinatorReference[],
    };
  }

  for (const problem of analysis.problems) p.add(problem);
  return {
    ids: analysis.value?.ids ?? [],
    names: analysis.value?.names ?? [],
    defaulted: false,
    blank: false,
    asides: analysis.value?.asides ?? [],
    references: analysis.references,
  };
}

type Team = ReturnType<typeof readCoordinators>;

/** Stage, commissioning and the feasibility clock, checked against each other. */
function readProgress(
  record: CsvRecord,
  ctx: ImportRowContext,
  kind: Kind,
  order: { order_date: string; orderDateGiven: boolean; orderDateBlank: boolean },
  p: RowProblems,
  name: ColumnName,
) {
  const notFuture = { notAfter: ctx.today };
  const feasibility_date = p.take(
    p.dateCell(record.feasibility_date, "feasibility_date", notFuture),
    null,
  );
  const commissioned_on = p.take(
    p.dateCell(record.commissioned_on, "commissioned_on", notFuture),
    null,
  );
  const completed = p.take(booleanCell(record.is_completed, "is_completed"), null);
  const stage = p.take(stageCell(record.current_stage, name("current_stage")), {
    stage: null,
    completed: false,
  });

  if (completed === false && commissioned_on) {
    p.add("commissioned_on is filled but is_completed is no — clear one of them");
  }
  if (completed === false && stage.completed) {
    p.add(
      `${name("current_stage")} "${textCell(record.current_stage)}" means commissioned, but is_completed is no — clear one of them`,
    );
  }
  // A commissioning date, or a "plant_complete", means the plant is commissioned.
  const is_completed = completed ?? (commissioned_on !== null || stage.completed);
  if (is_completed && feasibility_date && !commissioned_on) {
    p.add(
      "commissioned_on is required when a commissioned project has a feasibility_date — it stops the feasibility clock",
    );
  }
  if (commissioned_on && feasibility_date && commissioned_on < feasibility_date) {
    p.add(`commissioned_on ${commissioned_on} is before feasibility_date ${feasibility_date}`);
  }
  if (commissioned_on && commissioned_on < order.order_date) {
    // A refused blank order date is already reported; today would only confuse.
    if (order.orderDateGiven) {
      p.add(`commissioned_on ${commissioned_on} is before order_date ${order.order_date}`);
    } else if (order.orderDateBlank && kind.cancellation === null) {
      p.add(
        `order_date is needed — left blank it means today, which is after commissioned_on ${commissioned_on}`,
      );
    }
  }

  // A custom plan has one step; a solar plant starts at the first KSEB stage.
  const custom = kind.planKnown && kind.plan === "custom";
  if (custom) {
    if (feasibility_date) {
      p.add(
        `feasibility_date is filled but ${name("plan_type")} is custom — a custom plan has no KSEB feasibility`,
      );
    }
    if (stage.stage !== null && stage.stage !== HANDOVER_STAGE) {
      p.add(
        `a custom plan has no KSEB stages — leave ${name("current_stage")} blank or write completed`,
      );
    }
  }
  const current_stage: ProjectStage = is_completed || custom
    ? HANDOVER_STAGE
    : (stage.stage ?? "site_feasibility_survey");

  return { current_stage, is_completed, commissioned_on, feasibility_date };
}

function readCancellation(
  record: CsvRecord,
  ctx: ImportRowContext,
  kind: Kind,
  order: { order_date: string; orderDateGiven: boolean },
  feasibilityDate: string | null,
  p: RowProblems,
  name: ColumnName,
) {
  const cancelled_on = p.take(
    p.dateCell(record.cancelled_on, name("cancelled_on"), { notAfter: ctx.today }),
    null,
  );
  const remarks = textCell(record.cancellation_remarks);
  const column = name("cancellation");

  if (remarks && remarks.length > CANCELLATION_REMARKS_MAX) {
    p.add(
      `cancellation_remarks is too long (${remarks.length} characters; the most is ${CANCELLATION_REMARKS_MAX})`,
    );
  }
  if (kind.cancellation === null) {
    // An unreadable cancellation cell is already reported; do not also call it blank.
    if (kind.cancellationKnown) {
      if (cancelled_on) {
        p.add(`${name("cancelled_on")} is filled but ${column} is blank`);
      }
      if (remarks) {
        p.add(
          `${name("cancellation_remarks")} is filled but ${column} is blank — set ${column} or move the text to notes`,
        );
      }
    }
    return { cancelled_on: null, cancellation_remarks: null };
  }

  if (cancelled_on && order.orderDateGiven && cancelled_on < order.order_date) {
    p.add(`${name("cancelled_on")} ${cancelled_on} is before order_date ${order.order_date}`);
  }
  if (feasibilityDate && !cancelled_on) {
    p.add(
      `${name("cancelled_on")} is required for a cancelled project with a feasibility_date — it stops the feasibility clock`,
    );
  }
  return { cancelled_on, cancellation_remarks: remarks };
}

/**
 * What a row's incentive columns came to: each coordinator's agreed total with
 * the instalments already paid, and everyone the `incentive_<N>_coordinator`
 * cells named (for the matches panel).
 */
interface IncentiveReading {
  incentives: ImportIncentive[];
  references: CoordinatorReference[];
}

const NO_INCENTIVES: IncentiveReading = { incentives: [], references: [] };

const INCENTIVE_GROUPS_HINT =
  "the incentive_N_coordinator, incentive_N_amount and incentive_N_date columns";

/** One instalment of an incentive: one `incentive_<N>_*` group, or one part of the shorthand. */
interface IncentivePart {
  coordinatorId: string;
  amount: number;
  /** Null: not paid yet — still part of the agreed total. */
  paid_on: string | null;
}

/** Add each coordinator's parts up: the agreed total, and the instalments already paid. */
function gatherIncentives(parts: readonly IncentivePart[]): ImportIncentive[] {
  const byCoordinator = new Map<string, ImportIncentive>();
  for (const part of parts) {
    const incentive = byCoordinator.get(part.coordinatorId) ?? {
      coordinator_id: part.coordinatorId,
      amount: 0,
      payments: [],
    };
    incentive.amount = round2(incentive.amount + part.amount);
    if (part.paid_on !== null) {
      incentive.payments.push({ amount: part.amount, paid_on: part.paid_on, note: null });
    }
    byCoordinator.set(part.coordinatorId, incentive);
  }
  return [...byCoordinator.values()];
}

/**
 * Whose an `incentive_<N>` group is: the coordinator it names — resolved like
 * the coordinator column, and one of the sale's own — or, when the cell is
 * blank, the sale's only coordinator. A shared sale never guesses.
 */
function incentiveOwner(
  n: number,
  raw: string,
  ctx: ImportRowContext,
  team: Team,
  p: RowProblems,
  references: CoordinatorReference[],
): string | null {
  const column = incentiveColumn(n, "coordinator");
  const written = raw.trim();

  if (written === "") {
    if (team.ids.length > 1) {
      p.add(
        `${column} is required on a shared sale (${team.names.join(", ")}) — name who this incentive is for`,
      );
      return null;
    }
    if (team.defaulted) {
      p.add(`${column} needs the coordinator cell filled — name the coordinator this incentive belongs to`);
      return null;
    }
    // One named coordinator; none when the coordinator cell itself was refused.
    return team.ids[0] ?? null;
  }

  const analysis = analyzeCoordinatorCell(written, ctx.directory, column);
  references.push(...analysis.references);
  for (const problem of analysis.problems) p.add(problem);
  if (!analysis.value) return null;
  if (analysis.value.ids.length !== 1) {
    p.add(
      `${column} "${written}" names ${analysis.value.ids.length} people — an incentive belongs to one coordinator; give each their own incentive_N group`,
    );
    return null;
  }
  const [id] = analysis.value.ids;
  if (team.ids.length > 0 && !team.ids.includes(id)) {
    p.add(
      `${column} "${written}" is not a coordinator on this sale (${team.names.join(", ")}) — name one of them`,
    );
    return null;
  }
  return id;
}

/**
 * The explicit incentive columns: each `incentive_<N>_*` group is one
 * instalment. A group with a date is PAID; one without is a still-unpaid part
 * of that coordinator's agreed incentive, so the agreed total is the sum of all
 * of a coordinator's groups.
 */
function readIncentiveGroups(
  record: CsvRecord,
  ctx: ImportRowContext,
  team: Team,
  p: RowProblems,
): IncentiveReading {
  const parts: IncentivePart[] = [];
  const references: CoordinatorReference[] = [];
  for (const n of ctx.incentiveSlots) {
    const cell = (field: IncentiveField) => record[incentiveColumn(n, field)] ?? "";
    if (INCENTIVE_FIELDS.every((f) => !cell(f).trim())) continue;

    const amountColumn = incentiveColumn(n, "amount");
    const amount = p.take(
      required(
        moneyCell(cell("amount"), amountColumn, { positive: true }),
        `${amountColumn} is required — other incentive ${n} cells are filled`,
      ),
      null,
    );
    const paid_on = p.take(
      p.dateCell(cell("date"), incentiveColumn(n, "date"), { notAfter: ctx.today }),
      null,
    );
    const coordinatorId = incentiveOwner(n, cell("coordinator"), ctx, team, p, references);
    if (amount !== null && coordinatorId !== null) {
      parts.push({ coordinatorId, amount, paid_on });
    }
  }
  return { incentives: gatherIncentives(parts), references };
}

/** The `incentive_paid_on` cell as its `+`-separated dates. */
function shorthandDates(
  raw: string | undefined,
  column: string,
  today: string,
  p: RowProblems,
): { blank: boolean; ok: boolean; dates: string[] } {
  const written = (raw ?? "").trim();
  if (written === "") return { blank: true, ok: true, dates: [] };

  const dates: string[] = [];
  let valid = true;
  for (const piece of written.split("+").map((d) => d.trim())) {
    if (piece === "") {
      p.add(`${column} "${written}" has an empty date — write one date per amount, joined by +`);
      valid = false;
      continue;
    }
    const date = p.take(p.dateCell(piece, column, { notAfter: today }), null);
    if (date === null) valid = false;
    else dates.push(date);
  }
  return { blank: false, ok: valid, dates };
}

/**
 * The single-coordinator shorthand: `coordinator_incentive` (an amount, or a sum
 * — `12000+5000` is two instalments) with `incentive_paid_on` (one date for one
 * amount, or exactly one date per amount). An amount with no date is an unpaid
 * incentive. It belongs to a row's only coordinator, so a shared sale's pay is
 * never split by guess (it takes the `incentive_N_*` columns), and a row that
 * fell back to the default coordinator does not say whose it is.
 */
function readIncentiveShorthand(
  record: CsvRecord,
  ctx: ImportRowContext,
  team: Team,
  p: RowProblems,
  name: ColumnName,
): ImportIncentive[] {
  const amountColumn = name("coordinator_incentive");
  const paidColumn = name("incentive_paid_on");
  const amounts = moneyPartsCell(record.coordinator_incentive, amountColumn);
  const parts = p.take(amounts, null);
  const paid = shorthandDates(record.incentive_paid_on, paidColumn, ctx.today, p);

  const shared = team.ids.length > 1;
  if (shared || team.defaulted) {
    const refusal = shared
      ? `cannot be split automatically for a shared sale (${team.names.join(", ")}) — use ${INCENTIVE_GROUPS_HINT} to say who gets what`
      : `needs the ${name("coordinator")} cell filled — name the coordinator this incentive belongs to`;
    if (parts !== null) p.add(`${amountColumn} ${refusal}`);
    if (!paid.blank && paid.ok) p.add(`${paidColumn} ${refusal}`);
    return [];
  }

  if (parts === null) {
    // Only when the amount is genuinely blank — a malformed one is already reported.
    if (!paid.blank && amounts.ok) p.add(`${paidColumn} needs a ${amountColumn} amount`);
    return [];
  }
  if (team.ids.length !== 1) return [];

  const dated = !paid.blank && paid.ok;
  if (dated && paid.dates.length !== parts.length) {
    p.add(
      `${paidColumn} has ${paid.dates.length} ${paid.dates.length === 1 ? "date" : "dates"} for ${parts.length} ${parts.length === 1 ? "amount" : "amounts"} in ${amountColumn} — one date per amount, joined by + in the same order (or leave it blank for an incentive not yet paid)`,
    );
    return [];
  }
  if (dated && parts.some((amount) => amount === 0)) {
    p.add(
      `${paidColumn} dates a payment of zero — every part of ${amountColumn} that has a date must be more than zero`,
    );
    return [];
  }
  return gatherIncentives(
    parts.map((amount, i) => ({
      coordinatorId: team.ids[0],
      amount,
      paid_on: dated ? paid.dates[i] : null,
    })),
  );
}

/**
 * A row's incentives, from the `incentive_<N>_*` groups or the single-coordinator
 * shorthand — never both in one row.
 */
function readIncentives(
  record: CsvRecord,
  ctx: ImportRowContext,
  team: Team,
  p: RowProblems,
  name: ColumnName,
): IncentiveReading {
  const filled = (column: string) => (record[column] ?? "").trim() !== "";
  const shorthand = (["coordinator_incentive", "incentive_paid_on"] as const)
    .filter(filled)
    .map(name);
  const groups = ctx.incentiveSlots.filter((n) =>
    INCENTIVE_FIELDS.some((f) => filled(incentiveColumn(n, f))),
  );

  if (shorthand.length > 0 && groups.length > 0) {
    p.add(
      `${shorthand.join(" and ")} and ${groups.map((n) => `incentive_${n}_*`).join(", ")} are both filled — use either the shorthand or the incentive_N_* columns, not both`,
    );
    return NO_INCENTIVES;
  }
  if (groups.length > 0) return readIncentiveGroups(record, ctx, team, p);
  if (shorthand.length > 0) {
    return { incentives: readIncentiveShorthand(record, ctx, team, p, name), references: [] };
  }
  return NO_INCENTIVES;
}

/**
 * Typo guard on the ledger. The refunds and write-offs are replayed in the
 * order they happened (by date): a refund cannot exceed what BSS held then, a
 * write-off cannot exceed the balance then due. Then the end state: advance plus
 * contract payments, less refunds, plus write-offs, may not exceed the contract —
 * more than that is almost always a slipped digit, and it would hide a real
 * balance. (A customer may overpay and be refunded the excess, so the contract
 * itself is judged on the end state.) KSEB fees are not counted.
 */
function checkLedger(
  cost: { total: number; unknown: boolean },
  advance: number,
  payments: readonly ImportPayment[],
  slots: readonly number[],
  p: RowProblems,
) {
  const terms = { total_cost: cost.total, advance_amount: advance };

  const problems = ledgerProblems(terms, payments);
  for (const problem of problems) {
    const entry = payments[problem.entry];
    const column = paymentColumn(slots[problem.entry], "amount");
    if (problem.kind === "refund_over_collected") {
      p.add(
        `${column} ${formatCurrency(entry.amount)} is more than the ${formatCurrency(problem.limit)} BSS held on ${entry.paid_on} (advance plus contract payments, less earlier refunds) — a refund cannot exceed what was collected`,
      );
    } else if (!cost.unknown) {
      p.add(
        `${column} ${formatCurrency(entry.amount)} is more than the ${formatCurrency(problem.limit)} still due on ${entry.paid_on} — a write-off cannot exceed the balance`,
      );
    }
  }
  if (cost.unknown) {
    // The price is stored as 0: there is no balance to write anything off.
    payments.forEach((entry, i) => {
      if (entry.purpose === "write_off") {
        p.add(`${paymentColumn(slots[i], "purpose")} write_off needs a total_cost — the balance is not known`);
      }
    });
    return;
  }

  // An entry already refused above is not counted again in the end state.
  const refused = new Set(problems.map((problem) => problem.entry));
  const { received, writtenOff, refunded, balanceDue } = paymentSummary(
    withLedger(
      terms,
      payments.filter((_, i) => !refused.has(i)),
    ),
  );
  if (balanceDue < 0) {
    const adjusted = refunded > 0 || writtenOff > 0 ? " (less refunds, plus write-offs)" : "";
    p.add(
      `advance_amount plus contract payments${adjusted} come to ${formatCurrency(round2(received + writtenOff))}, more than total_cost ${formatCurrency(cost.total)} — check for a typo. If money was returned, record it as a refund (payment_N_purpose = refund); if a few rupees are simply not coming, record a write-off (payment_N_purpose = write_off, with the reason in payment_N_reference or notes)`,
    );
  }
}

/** Before this a year is a typo (`1025`, `0225`), not a sale. */
const EARLIEST_PLAUSIBLE_DATE = "2015-01-01";

/** At most this many dates are named in one note; the rest are counted. */
const DATES_NAMED = 3;

function namedDates(items: readonly string[]): string {
  const shown = items.slice(0, DATES_NAMED);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join("; ")} and ${rest} more` : shown.join("; ");
}

/**
 * What the ledger and the dates of one row make worth a second look. All of it
 * is legal and the row still imports: it is here because a sheet typed by hand
 * goes wrong in these ways, and nothing else would say so.
 *   - a sale marked refunded whose ledger still holds the customer's money;
 *   - a date a year-typo away from sensible;
 *   - an advance, payment or incentive dated before the order it belongs to;
 *   - contract payments whose dates run backwards (a day and month swapped).
 */
function ledgerWarnings(row: {
  cancellation: ProjectCancellation | null;
  /** As the sheet wrote it; null when blank (today stands in, and is no evidence). */
  orderDate: string | null;
  advance: number;
  advancePaidOn: string | null;
  payments: readonly ImportPayment[];
  slots: readonly number[];
  incentives: readonly ImportIncentive[];
  commissionedOn: string | null;
}): string[] {
  const notes: string[] = [];

  if (row.cancellation === "refunded") {
    const { contract, refunded } = ledgerTotals(row.payments);
    const held = round2(row.advance + contract - refunded);
    if (held > 0) {
      notes.push(
        `marked refunded, but ${rupees(held)} (advance plus payments, less refunds) is still held in the ledger — if it was handed back, add a refund line (payment_N_purpose = refund, with its date); if BSS kept it, ignore this`,
      );
    }
  }

  const afterOrder: { what: string; date: string }[] = [];
  if (row.advancePaidOn) afterOrder.push({ what: "advance_date", date: row.advancePaidOn });
  row.payments.forEach((entry, i) => {
    afterOrder.push({ what: paymentColumn(row.slots[i], "date"), date: entry.paid_on });
  });
  for (const incentive of row.incentives) {
    for (const instalment of incentive.payments) {
      afterOrder.push({ what: "an incentive payment", date: instalment.paid_on });
    }
  }

  const dated = [
    ...afterOrder,
    ...(row.orderDate ? [{ what: "order_date", date: row.orderDate }] : []),
    ...(row.commissionedOn ? [{ what: "commissioned_on", date: row.commissionedOn }] : []),
  ];
  const early = dated.filter(({ date }) => date < EARLIEST_PLAUSIBLE_DATE);
  if (early.length > 0) {
    notes.push(
      `${namedDates(early.map(({ what, date }) => `${what} ${formatDate(date)}`))} — before 2015, which is most likely a mistyped year`,
    );
  }

  if (row.orderDate) {
    const order = row.orderDate;
    const before = afterOrder.filter(({ date }) => date < order && date >= EARLIEST_PLAUSIBLE_DATE);
    if (before.length > 0) {
      notes.push(
        `${namedDates(before.map(({ what, date }) => `${what} ${formatDate(date)}`))} — before order_date ${formatDate(order)}; check the day and month`,
      );
    }
  }

  const contract = row.payments.flatMap((entry, i) =>
    entry.purpose === "contract" ? [{ column: paymentColumn(row.slots[i], "date"), date: entry.paid_on }] : [],
  );
  for (let i = 1; i < contract.length; i += 1) {
    if (contract[i].date < contract[i - 1].date) {
      notes.push(
        `${contract[i].column} ${formatDate(contract[i].date)} is earlier than ${contract[i - 1].column} ${formatDate(contract[i - 1].date)} — payments run backwards; check the day and month`,
      );
      break;
    }
  }
  return notes;
}

/** Remarks written in the coordinator cell's brackets stay with the sale. */
function withCoordinatorAside(notes: string | null, raw: string, asides: readonly string[]) {
  if (asides.length === 0) return notes;
  const line = `Coordinator as written in the import sheet: ${raw.trim()}`;
  return notes ? `${notes}\n${line}` : line;
}

/** Look-alike key for a name typed twice: case, spacing and punctuation ignored. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The key the RPC compares consumer numbers by: all whitespace removed, case kept. */
const consumerKey = (consumerNumber: string) => consumerNumber.replace(/\s+/g, "");

/**
 * A sample row of the downloadable template, reduced to what tells it from a
 * real customer. The samples ARE the template's rows (`import-template-rows`),
 * so the two cannot drift apart: a sheet built from the template and not
 * cleaned up is caught however old the copy.
 */
interface TemplateSample {
  client: string;
  consumer: string | null;
  cost: number | null;
  date: string | null;
}

const TEMPLATE_SAMPLES: readonly TemplateSample[] = TEMPLATE_ROWS.map((row) => {
  const cost = moneyCell(row.total_cost, "total_cost");
  const date = dateCellRead(row.order_date, "order_date");
  return {
    client: nameKey(row.client_name ?? ""),
    consumer: row.consumer_number ? consumerKey(row.consumer_number) : null,
    cost: cost.ok ? cost.data : null,
    date: date.ok ? (date.data?.iso ?? null) : null,
  };
});

/** Why a row that is still one of the template's examples is refused. */
export const TEMPLATE_EXAMPLE_PROBLEM = "this is one of the template's example rows — delete it";

/**
 * A template example left in a real file: the sample's client name together
 * with its consumer number, or with its total cost and order date — each equal
 * to the sample's, a blank order date included when the sample has none. A date
 * that could not be read matches nothing; it is reported on its own.
 */
function isTemplateExample(row: {
  client_name: string | null;
  consumer_number: string | null;
  total_cost: number | null;
  order_date: string | null;
}): boolean {
  if (!row.client_name) return false;
  const client = nameKey(row.client_name);
  return TEMPLATE_SAMPLES.some((sample) => {
    if (sample.client !== client) return false;
    if (
      sample.consumer !== null &&
      row.consumer_number !== null &&
      consumerKey(row.consumer_number) === sample.consumer
    ) {
      return true;
    }
    return row.total_cost === sample.cost && row.order_date === sample.date;
  });
}

/** One row, read: the RPC row or its problems, and what the file-level checks need. */
export interface RowReading {
  parsed: ActionResult<ImportRow>;
  /** The coordinators' names, in order (empty when the cell could not be read). */
  coordinators: string[];
  /** The coordinator cell was blank and the default coordinator stands in. */
  defaulted: boolean;
  /** The coordinator cell was blank (defaulted or not). */
  blankCoordinator: boolean;
  /** Everything the coordinator and incentive-coordinator cells named, for the matches panel. */
  references: CoordinatorReference[];
  /** Things worth a look that do not stop the row (only on a valid row). */
  warnings: string[];
  /**
   * The order date the sheet wrote; null when it is blank, unreadable or the row
   * is a template example. Feeds the file's month-spread check.
   */
  orderDate: string | null;
  /** Every date cell of the row that was read day / month / year, as typed. */
  dayFirst: DateRead[];
}

/** A template example row: nothing else about it is worth reporting. */
function templateExampleReading(): RowReading {
  return {
    parsed: fail(TEMPLATE_EXAMPLE_PROBLEM),
    coordinators: [],
    defaulted: false,
    blankCoordinator: false,
    references: [],
    warnings: [],
    orderDate: null,
    dayFirst: [],
  };
}

/**
 * Validate and normalise one CSV record (keyed by canonical column names).
 * Every problem in the row is joined into one message.
 */
export function readImportRow(record: CsvRecord, rowNo: number, ctx: ImportRowContext): RowReading {
  const p = new RowProblems();
  const warnings: string[] = [];
  const name: ColumnName = (header) => ctx.columnNames?.[header] ?? header;

  const kind = readKind(record, p, name);
  const core = readRequired(record, kind, p, name, warnings);
  const workOrder = readWorkOrder(record, ctx, kind, p, warnings);
  const orderDate = workOrder.orderDateGiven ? workOrder.order_date : null;
  // A template example left in the file is deleted, not fixed: report only that.
  if (
    isTemplateExample({
      client_name: core.client_name,
      consumer_number: workOrder.consumer_number,
      total_cost: core.total_cost,
      order_date: orderDate,
    })
  ) {
    return templateExampleReading();
  }

  const team = readCoordinators(record, ctx, p, name);
  const progress = readProgress(record, ctx, kind, workOrder, p, name);
  const cancellation = readCancellation(record, ctx, kind, workOrder, progress.feasibility_date, p, name);
  const incentives = readIncentives(record, ctx, team, p, name);
  const slots: number[] = [];
  const payments: ImportPayment[] = [];
  for (const n of ctx.paymentSlots) {
    const payment = parsePayment(record, n, ctx.today, textCell(record.notes), p);
    if (payment) {
      slots.push(n);
      payments.push(payment);
    }
  }
  if (core.total_cost !== null) {
    checkLedger(
      { total: core.total_cost, unknown: core.costUnknown },
      workOrder.advance_amount,
      payments,
      slots,
      p,
    );
  }
  if (core.costUnknown && workOrder.advance_amount > 0) {
    // The unknown total is stored as 0, so the advance would be more than the
    // total — a state the work order's own edit form refuses to save.
    p.add("total_cost is blank but advance_amount is filled — enter the total, or clear the advance");
  }
  warnings.push(
    ...ledgerWarnings({
      cancellation: kind.cancellation,
      orderDate,
      advance: workOrder.advance_amount,
      advancePaidOn: workOrder.advance_paid_on,
      payments,
      slots,
      incentives: incentives.incentives,
      commissionedOn: progress.commissioned_on,
    }),
  );

  const reading = {
    coordinators: team.names,
    defaulted: team.defaulted,
    blankCoordinator: team.blank,
    references: [...team.references, ...incentives.references],
    orderDate,
    dayFirst: p.dayFirst,
  };
  // The null checks only narrow types: a missing required value always
  // recorded a problem above.
  const { client_name, plant_capacity, total_cost } = core;
  if (p.list.length || !client_name || !plant_capacity || total_cost === null) {
    return { ...reading, parsed: fail(p.list.join("; ")), warnings: [] };
  }
  return {
    ...reading,
    warnings,
    parsed: ok({
      row_no: rowNo,
      client_name,
      client_phone: workOrder.client_phone,
      address: workOrder.address,
      plan_type: kind.plan,
      plant_capacity,
      total_cost,
      advance_amount: workOrder.advance_amount,
      advance_method: workOrder.advance_method,
      advance_paid_on: workOrder.advance_paid_on,
      advance_reference: workOrder.advance_reference,
      order_date: workOrder.order_date,
      coordinator_ids: team.ids,
      financing_type: workOrder.financing_type,
      loan_bank_name: workOrder.loan_bank_name,
      consumer_number: workOrder.consumer_number,
      kseb_section: workOrder.kseb_section,
      notes: withCoordinatorAside(textCell(record.notes), record.coordinator ?? "", team.asides),
      ...progress,
      incentives: incentives.incentives,
      cancellation: kind.cancellation,
      ...cancellation,
      payments,
    }),
  };
}

/** `readImportRow`, reduced to the row or its problems. */
export function parseImportRow(
  record: CsvRecord,
  rowNo: number,
  ctx: ImportRowContext,
): ActionResult<ImportRow> {
  return readImportRow(record, rowNo, ctx).parsed;
}

// --- File ---------------------------------------------------------------------

export interface PlannedRow {
  /**
   * The line of the sheet the row starts on, the first line being 1: blank
   * lines and the lines of a multi-line cell count, so it matches the CSV box.
   */
  rowNo: number;
  /** Client name as typed, for the results list ("" when missing). */
  client: string;
  /** The row's cells as uploaded, for the failed-rows download. */
  cells: Readonly<Record<string, string>>;
  parsed: ActionResult<ImportRow>;
  /** The coordinators' names, in order ("" entries never occur; empty when unreadable). */
  coordinators: string[];
  /** The blank coordinator cell fell back to the default coordinator. */
  defaulted: boolean;
  /** Only on a valid row: worth a look, does not stop it. */
  warnings: string[];
}

export interface ImportPlan {
  headers: string[];
  rows: PlannedRow[];
  /** Each distinct thing the coordinator cells wrote and who it became; problems first. */
  coordinatorMatches: CoordinatorMatch[];
  /** File-level things worth a look, never failures. */
  warnings: string[];
  /** File-level information (not a problem): how the sheet's dates were read. */
  notes: string[];
}

export interface ImportPlanOptions {
  /** IST "today". */
  today: string;
  directory: CoordinatorDirectory;
  /** Who a blank coordinator cell means; null = nobody, such rows fail. */
  defaultCoordinatorId: string | null;
  /**
   * Whether the run will skip rows whose consumer number is already in (the
   * RPC's `p_skip_existing`); true unless said otherwise. It decides whether a
   * consumer number repeated within the file is worth a warning.
   */
  skipExisting?: boolean;
}

/** What the matches panel says for blank cells when no default was chosen. */
export const NO_DEFAULT_PROBLEM = "no default coordinator was chosen — these rows fail";

const referenceKey = (written: string) => written.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Who each distinct coordinator cell entry became, with the rows it is on.
 * Entries that are not accounts come first (they are why rows fail), each
 * group in the order first met.
 */
function collectMatches(
  readings: readonly { rowNo: number; reading: RowReading }[],
  defaultCoordinator: DirectoryAccount | null,
): CoordinatorMatch[] {
  const matches = new Map<string, CoordinatorMatch>();
  const note = (key: string, make: () => CoordinatorMatch, rowNo: number) => {
    const match = matches.get(key) ?? make();
    if (!matches.has(key)) matches.set(key, match);
    if (!match.rows.includes(rowNo)) match.rows.push(rowNo);
  };
  for (const { rowNo, reading } of readings) {
    if (reading.blankCoordinator) {
      note(
        "",
        () => ({
          written: "",
          account: defaultCoordinator,
          problem: defaultCoordinator ? null : NO_DEFAULT_PROBLEM,
          rows: [],
        }),
        rowNo,
      );
    }
    for (const ref of reading.references) {
      note(
        referenceKey(ref.written),
        () => ({ written: ref.written, account: ref.account, problem: ref.problem, rows: [] }),
        rowNo,
      );
    }
  }
  const all = [...matches.values()];
  return [...all.filter((m) => m.account === null), ...all.filter((m) => m.account !== null)];
}

/** `3`, `3 and 5`, `3, 5 and 9`. */
function joinAnd(items: readonly (string | number)[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `3`, `3 and 5`, `3, 5 and 9`; past `limit` rows, `3, 5, 9 and 20 more`. */
function listRows(rows: readonly number[], limit = rows.length): string {
  if (rows.length > limit) {
    return `${rows.slice(0, limit).join(", ")} and ${rows.length - limit} more`;
  }
  return joinAnd(rows);
}

/** Rows named in a warning before the rest are counted (as the matches panel does). */
const ROWS_NAMED = 12;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function rupees(n: number): string {
  return Number.isInteger(n) ? formatCurrencyWhole(n) : formatCurrency(n);
}

/** Look-alike key for the same sale typed twice. */
function saleKey(row: ImportRow): string {
  return `${nameKey(row.client_name)}|${row.order_date}|${row.total_cost}`;
}

/**
 * The importer skips a row whose consumer number is already in, and a row met
 * earlier in the same run is already in: of several rows with one number only
 * the first goes in. Said here so Check file agrees with Import.
 */
function repeatedConsumerNumbers(rows: readonly ImportRow[]): string[] {
  const groups = new Map<string, ImportRow[]>();
  for (const row of rows) {
    if (row.consumer_number === null) continue;
    const key = consumerKey(row.consumer_number);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const warnings: string[] = [];
  for (const same of groups.values()) {
    if (same.length < 2) continue;
    const [first] = same;
    warnings.push(
      `Rows ${listRows(same.map((r) => r.row_no), ROWS_NAMED)} share consumer number ${first.consumer_number} — only the first (row ${first.row_no}) will be imported; ${plural(same.length - 1, "the other is", "the others are")} skipped. Turn off "Skip rows whose consumer number already exists" to import them all.`,
    );
  }
  return warnings;
}

/**
 * File-level notes about the rows that WILL import: things that are legal but
 * likely not what was meant. Never failures.
 */
function fileWarnings(
  rows: readonly ImportRow[],
  { skipExisting }: { skipExisting: boolean },
): string[] {
  const warnings: string[] = [];

  const unnumbered = rows.filter((r) => r.consumer_number === null).length;
  if (unnumbered > 0) {
    warnings.push(
      `${unnumbered} ${plural(unnumbered, "row has", "rows have")} no consumer_number — ${plural(unnumbered, "it", "they")} will be imported again on every upload; to retry, upload only the failed-rows download`,
    );
  }
  if (skipExisting) warnings.push(...repeatedConsumerNumbers(rows));

  const groups = new Map<string, ImportRow[]>();
  for (const row of rows) {
    const key = saleKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const same of groups.values()) {
    if (same.length < 2) continue;
    const [first] = same;
    warnings.push(
      `Rows ${listRows(same.map((r) => r.row_no))} look like the same sale (${first.client_name}, ${first.order_date}, ${rupees(first.total_cost)}) — remove one if so`,
    );
  }

  const undated = rows.filter((r) => r.is_completed && r.commissioned_on === null).length;
  if (undated > 0) {
    warnings.push(
      `${undated} completed ${plural(undated, "row has", "rows have")} no commissioned_on — ${plural(undated, "it is", "they are")} imported as complete with the commissioning date not recorded`,
    );
  }
  return warnings;
}

/** `March 2025`, `March 2025 and April 2025`; past three, `\u2026, \u2026 and 2 more`. */
function listMonths(months: readonly string[]): string {
  const shown = months.slice(0, 3);
  const rest = months.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : joinAnd(shown);
}

/** Which rows are the odd ones out of a sheet's order dates. */
interface DatedRow {
  rowNo: number;
  reading: RowReading;
}

/**
 * Dates are read day first. When some cells were written that way (anything
 * but YYYY-MM-DD), say how many and show one, so a sheet whose dates Excel
 * turned around is noticed on the first check. Information, not a warning:
 * the reading is a rule, not a guess.
 */
function dayFirstNote(readings: readonly DatedRow[]): string[] {
  const reads = readings.flatMap(({ reading }) => reading.dayFirst);
  if (reads.length === 0) return [];
  const rows = readings.filter(({ reading }) => reading.dayFirst.length > 0).length;
  const [example] = reads;
  return [
    `${reads.length} date ${plural(reads.length, "cell was", "cells were")} written day first (in ${rows} ${plural(rows, "row", "rows")}) and read that way \u2014 "${example.written}" is ${formatDate(example.iso)}. Dates are never read month first.`,
  ];
}

/** At least this many in five order dates in one month makes the others suspect. */
const SPREAD_MAJORITY = { of: 5, atLeast: 3 };

/**
 * A monthly sheet's order dates sit in one month. When most of them do (60% or
 * more) and some fall elsewhere, the odd ones are often a day and month swapped
 * \u2014 Excel in a US locale does it silently \u2014 so list them. Never a failure: an
 * order from late last month is legitimate.
 */
function monthSpreadWarning(readings: readonly DatedRow[]): string[] {
  const dated = readings.flatMap(({ rowNo, reading }) =>
    reading.orderDate ? [{ rowNo, month: monthKey(reading.orderDate) }] : [],
  );
  const counts = new Map<string, number>();
  for (const { month } of dated) counts.set(month, (counts.get(month) ?? 0) + 1);
  // The busiest month; the earlier one when two tie.
  const [main] = [...counts].sort(([ma, a], [mb, b]) => b - a || (ma < mb ? -1 : 1));
  if (!main) return [];

  const [mainMonth, mainCount] = main;
  const others = dated.filter(({ month }) => month !== mainMonth);
  if (others.length === 0 || mainCount * SPREAD_MAJORITY.of < dated.length * SPREAD_MAJORITY.atLeast) {
    return [];
  }
  const months = [...new Set(others.map(({ month }) => month))].sort().map(monthName);
  return [
    `${mainCount} of ${dated.length} order dates are in ${monthName(mainMonth)}, but ${plural(others.length, "row", "rows")} ${listRows(
      others.map((o) => o.rowNo),
      ROWS_NAMED,
    )} ${plural(others.length, "is", "are")} in ${listMonths(months)} \u2014 may be a day/month mix-up. Check ${plural(others.length, "that date", "those dates")}.`,
  ];
}

const REPLACEMENT_CHARACTER = "\uFFFD";

/**
 * A file read as UTF-8 that was not (Excel's default CSV is Windows-1252) comes
 * out with U+FFFD where each en dash, curly quote or accented letter was. A
 * row that is otherwise valid goes in with those characters stored, so name
 * the rows — failed ones too, which will be fixed and checked again.
 */
function damagedTextWarning(rows: readonly PlannedRow[]): string[] {
  const damaged = rows
    .filter((r) => Object.values(r.cells).some((cell) => cell.includes(REPLACEMENT_CHARACTER)))
    .map((r) => r.rowNo);
  if (damaged.length === 0) return [];
  return [
    `${plural(damaged.length, "Row", "Rows")} ${listRows(damaged, ROWS_NAMED)} ${plural(damaged.length, "contains", "contain")} the replacement character ${REPLACEMENT_CHARACTER} — text was damaged when the file was read, usually because it was not saved as CSV UTF-8. Fix ${plural(damaged.length, "that cell", "those cells")}, or export the sheet again as CSV UTF-8.`,
  ];
}

/** The file's cells under the canonical column names the row reader uses. */
function canonicalRecord(
  cells: Readonly<Record<string, string>>,
  layout: ImportLayout,
): Record<string, string> {
  const record: Record<string, string> = { ...cells };
  for (const [uploaded, column] of Object.entries(layout.canonical)) {
    record[column] = cells[uploaded] ?? "";
  }
  return record;
}

/**
 * Parse and validate a whole upload. A file-level problem (empty, malformed
 * quoting, bad header, too many rows, a default coordinator who cannot own a
 * sale) is an error; row problems — values past the last column included — are
 * carried per row so the valid rows can still be imported.
 */
export function planImport(
  text: string,
  { today, directory, defaultCoordinatorId, skipExisting = true }: ImportPlanOptions,
): ActionResult<ImportPlan> {
  if (!text.trim()) return fail("Paste CSV or choose a file first.");

  let defaultCoordinator: DirectoryAccount | null = null;
  if (defaultCoordinatorId !== null) {
    defaultCoordinator = directory.byId(defaultCoordinatorId);
    if (!defaultCoordinator || !WORK_ORDER_OWNER_ROLES.includes(defaultCoordinator.role)) {
      return fail("Select a default coordinator who is a coordinator or office account.");
    }
  }

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

  const ctx: ImportRowContext = {
    today,
    paymentSlots: layout.data.paymentSlots,
    incentiveSlots: layout.data.incentiveSlots,
    directory,
    defaultCoordinator,
    columnNames: uploadedNames(layout.data),
  };
  const readings = csv.records.map(({ cells, problem, line: rowNo }) => {
    const reading = readImportRow(canonicalRecord(cells, layout.data), rowNo, ctx);
    // The CSV problem goes first: a split value shifts every cell after it,
    // which usually explains the rest.
    const parsed = problem
      ? fail(reading.parsed.ok ? problem : `${problem}; ${reading.parsed.error}`)
      : reading.parsed;
    const row: PlannedRow = {
      rowNo,
      client: textCell(cells.client_name) ?? "",
      cells,
      parsed,
      coordinators: reading.coordinators,
      defaulted: reading.defaulted,
      warnings: parsed.ok ? reading.warnings : [],
    };
    return { row, reading };
  });

  const rows = readings.map((r) => r.row);
  const valid = rows.flatMap((r) => (r.parsed.ok ? [r.parsed.data] : []));
  const read = readings.map(({ row, reading }) => ({ rowNo: row.rowNo, reading }));
  return ok({
    headers: layout.data.headers,
    rows,
    coordinatorMatches: collectMatches(read, defaultCoordinator),
    warnings: [
      ...damagedTextWarning(rows),
      ...fileWarnings(valid, { skipExisting }),
      ...monthSpreadWarning(read),
    ],
    notes: dayFirstNote(read),
  });
}
