import { parseCsvRecords } from "@/lib/csv";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  PlanType,
  ProjectCancellation,
  ProjectStage,
} from "@/lib/types";
import { capacityProblem } from "./capacity";
import { CANCELLATION_REMARKS_MAX } from "./cancellation";
import {
  analyzeCoordinatorCell,
  type CoordinatorDirectory,
  type CoordinatorMatch,
  type CoordinatorReference,
  type DirectoryAccount,
} from "./coordinator-match";
import {
  booleanCell,
  cancellationCell,
  dateCell,
  financingCell,
  identifierCell,
  moneyCell,
  paymentMethodCell,
  paymentPurposeCell,
  planTypeCell,
  stageCell,
  textCell,
  type Cell,
} from "./import-cells";
import { ledgerTotals, paymentSummary } from "./payment";
import { HANDOVER_STAGE, PLAN_LABEL_MAX } from "./plan";
import { WORK_ORDER_OWNER_ROLES } from "./role";
import { closestMatch } from "./suggest";

/**
 * The onboarding import: CSV columns, header validation and row rules.
 *
 * Everything here is pure. The server action feeds the rows this module
 * accepts to the `import_projects` RPC (migration 20261022120300), whose input
 * shape `ImportRow` mirrors field for field. The database makes the checks only
 * it can (is the consumer number already there, does an id still belong to a
 * coordinator); this module makes the ones a person can fix in the sheet — who
 * the coordinators are included, resolved against the team's accounts — and
 * reports every problem in a row at once so a sheet does not take one upload
 * per mistake.
 *
 * The import never invents data: a coordinator is never guessed from a close
 * spelling, a date the sheet leaves out stays unknown, and a blank coordinator
 * cell is a problem unless the office chose a default for it.
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
  { title: "Incentive", columns: ["coordinator_incentive", "incentive_paid_on"] },
];

// --- Header -------------------------------------------------------------------

export interface ImportLayout {
  /** The header row as uploaded (lower-cased), for the failed-rows download. */
  headers: string[];
  /** Payment group numbers present, ascending. */
  paymentSlots: number[];
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
 * missing columns, one column under two names, and payment groups without both
 * an amount and a date column. Every problem is reported in one message.
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
      if (m) {
        const n = Number(m[1]);
        slots.set(n, (slots.get(n) ?? new Set()).add(m[2]));
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

  if (problems.length) {
    return fail(`The header row needs fixing. ${problems.join(" ")}`);
  }
  return ok({ headers: [...headers], paymentSlots: groups.map(([n]) => n), canonical });
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
  reference: string | null;
  notes: string | null;
};

/** One coordinator's incentive on a sale (`import_projects` → `coordinator_incentives`). */
export type ImportIncentive = {
  coordinator_id: string;
  amount: number;
  paid_on: string | null;
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
  /** Single-coordinator rows only: a shared sale's pay is never split by guess. */
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
function readRequired(record: CsvRecord, kind: Kind, p: RowProblems, name: ColumnName) {
  const cancelled = kind.cancellation !== null;
  const client_name = textCell(record.client_name);
  if (!client_name) p.add("client_name is required");

  let plant_capacity = textCell(record.plant_capacity);
  if (!plant_capacity) {
    if (cancelled) plant_capacity = NOT_RECORDED_LABEL;
    else p.add("plant_capacity is required");
  } else if (kind.planKnown) {
    const problem = labelProblem(kind.plan, plant_capacity, name);
    if (problem) p.add(problem);
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

  const written = dateCell(record.order_date, "order_date", { notAfter: today });
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

  return {
    client_phone: p.take(identifierCell(record.client_phone, "client_phone"), null),
    address: textCell(record.address),
    advance_amount: p.take(moneyCell(record.advance_amount, "advance_amount"), null) ?? 0,
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
    dateCell(record.feasibility_date, "feasibility_date", notFuture),
    null,
  );
  const commissioned_on = p.take(
    dateCell(record.commissioned_on, "commissioned_on", notFuture),
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
    dateCell(record.cancelled_on, name("cancelled_on"), { notAfter: ctx.today }),
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
 * The incentive columns are shorthand for ONE coordinator's pay, so they are
 * only taken on a row that names that coordinator itself. A shared sale's pay
 * is never split by guess, and a row that fell back to the default coordinator
 * does not say whose it is.
 */
function readIncentive(
  record: CsvRecord,
  ctx: ImportRowContext,
  team: Team,
  p: RowProblems,
  name: ColumnName,
): ImportIncentive[] {
  const amountColumn = name("coordinator_incentive");
  const paidColumn = name("incentive_paid_on");
  const incentive = moneyCell(record.coordinator_incentive, amountColumn);
  const amount = p.take(incentive, null);
  const paid_on = p.take(
    dateCell(record.incentive_paid_on, paidColumn, { notAfter: ctx.today }),
    null,
  );

  const shared = team.ids.length > 1;
  if (shared || team.defaulted) {
    const refusal = shared
      ? `cannot be split automatically for a shared sale (${team.names.join(", ")}) — leave it blank and set each coordinator's incentive on the project page`
      : `needs the ${name("coordinator")} cell filled — name the coordinator this incentive belongs to`;
    if (amount !== null) p.add(`${amountColumn} ${refusal}`);
    if (paid_on !== null) p.add(`${paidColumn} ${refusal}`);
    return [];
  }

  // Only when the amount is genuinely blank — a malformed one is already reported.
  if (paid_on && incentive.ok && amount === null) {
    p.add(`${paidColumn} needs a ${amountColumn} amount`);
  }
  return amount !== null && team.ids.length === 1
    ? [{ coordinator_id: team.ids[0], amount, paid_on }]
    : [];
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

/** Remarks written in the coordinator cell's brackets stay with the sale. */
function withCoordinatorAside(notes: string | null, raw: string, asides: readonly string[]) {
  if (asides.length === 0) return notes;
  const line = `Coordinator as written in the import sheet: ${raw.trim()}`;
  return notes ? `${notes}\n${line}` : line;
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
  /** Everything the coordinator cell named, for the matches panel. */
  references: CoordinatorReference[];
  /** Things worth a look that do not stop the row (only on a valid row). */
  warnings: string[];
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
  const core = readRequired(record, kind, p, name);
  const workOrder = readWorkOrder(record, ctx, kind, p, warnings);
  const team = readCoordinators(record, ctx, p, name);
  const progress = readProgress(record, ctx, kind, workOrder, p, name);
  const cancellation = readCancellation(record, ctx, kind, workOrder, progress.feasibility_date, p, name);
  const incentives = readIncentive(record, ctx, team, p, name);
  const payments = ctx.paymentSlots.flatMap((n) => parsePayment(record, n, ctx.today, p) ?? []);
  if (core.total_cost !== null && !core.costUnknown) {
    checkCollections(core.total_cost, workOrder.advance_amount, payments, p);
  } else if (core.costUnknown && workOrder.advance_amount > 0) {
    // The unknown total is stored as 0, so the advance would be more than the
    // total — a state the work order's own edit form refuses to save.
    p.add("total_cost is blank but advance_amount is filled — enter the total, or clear the advance");
  }

  const reading = {
    coordinators: team.names,
    defaulted: team.defaulted,
    blankCoordinator: team.blank,
    references: team.references,
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
      order_date: workOrder.order_date,
      coordinator_ids: team.ids,
      financing_type: workOrder.financing_type,
      loan_bank_name: workOrder.loan_bank_name,
      consumer_number: workOrder.consumer_number,
      kseb_section: workOrder.kseb_section,
      notes: withCoordinatorAside(textCell(record.notes), record.coordinator ?? "", team.asides),
      ...progress,
      incentives,
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

/** `3`, `3 and 5`, `3, 5 and 9`; past `limit` rows, `3, 5, 9 and 20 more`. */
function listRows(rows: readonly number[], limit = rows.length): string {
  if (rows.length > limit) {
    return `${rows.slice(0, limit).join(", ")} and ${rows.length - limit} more`;
  }
  return rows.length < 2
    ? rows.join("")
    : `${rows.slice(0, -1).join(", ")} and ${rows[rows.length - 1]}`;
}

/** Rows named in a warning before the rest are counted (as the matches panel does). */
const ROWS_NAMED = 12;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function rupees(n: number): string {
  return Number.isInteger(n) ? formatCurrencyWhole(n) : formatCurrency(n);
}

/** Look-alike key for the same sale typed twice. */
function saleKey(row: ImportRow): string {
  const client = row.client_name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${client}|${row.order_date}|${row.total_cost}`;
}

/** The key the RPC compares consumer numbers by: all whitespace removed, case kept. */
const consumerKey = (consumerNumber: string) => consumerNumber.replace(/\s+/g, "");

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
  return ok({
    headers: layout.data.headers,
    rows,
    coordinatorMatches: collectMatches(
      readings.map(({ row, reading }) => ({ rowNo: row.rowNo, reading })),
      defaultCoordinator,
    ),
    warnings: [...damagedTextWarning(rows), ...fileWarnings(valid, { skipExisting })],
  });
}
