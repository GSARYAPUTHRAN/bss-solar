import type {
  FinancingType,
  PaymentMethod,
  PaymentPurpose,
  PlanType,
  ProjectCancellation,
  TicketStatus,
  WorkOrderStatus,
} from "@/lib/types";
import { spreadsheetText } from "@/lib/csv";
import { istDateOf } from "./dates";
import { FINANCING_LABELS, PAYMENT_METHOD_LABELS } from "./payment";
import { round2 } from "./rounding";

/**
 * The monthly management report (/reports): what the CEO and the office read
 * to see how the business is doing — sales booked, money collected, plants
 * commissioned, service work — for one calendar month, against the month before,
 * the same month last year and the financial year so far.
 *
 * Everything here is pure: the repository hands over plain rows, this module
 * counts. Business dates (order, payment, cancellation, service, advance) are
 * calendar days and are compared as YYYY-MM-DD strings; timestamps (a project's
 * commissioning, a ticket's last update) are first turned into their India
 * (Asia/Kolkata) calendar day, so 00:30 IST on the 1st counts in the new month.
 *
 * The current month is reported "so far": the window runs from the 1st to today,
 * and every comparison window has the same number of days (1–24 Nov against
 * 1–24 Oct and 1–24 Nov last year), so a month in progress is never compared with
 * a whole one. A past month is compared whole with whole.
 */

// ---------------------------------------------------------------------------
// Inputs — what the repository reads
// ---------------------------------------------------------------------------

/** Where a sale's project stands today. `none`: no project (not approved yet, or rejected). */
export type ProjectState = "active" | "commissioned" | "cancelled" | "refunded" | "none";

/** One work order, with what the report needs from `work_orders_list` and `work_orders`. */
export interface ReportSale {
  id: string;
  clientName: string;
  /** The business date the sale was booked (YYYY-MM-DD). */
  orderDate: string;
  status: WorkOrderStatus;
  totalCost: number;
  /** A solar plant's kW. Custom plans have none (null). */
  capacityKw: number | null;
  /** What was sold, as printed on the work order: "5kW", or a custom plan's label. */
  plan: string;
  planType: PlanType;
  /** The booking advance (0 when none). */
  advanceAmount: number;
  /** When the advance was paid; unknown for older sales (then the order date counts). */
  advancePaidOn: string | null;
  advanceMethod: PaymentMethod | null;
  advanceReference: string | null;
  /** Net received to date: advance + contract payments − refunds. */
  receivedToDate: number;
  /** Total − net received − write-offs. */
  balanceDue: number;
  /** Everyone on the sale, in the sale's order; `coordinatorNames` lines up with it. */
  coordinatorIds: string[];
  coordinatorNames: string[];
  projectState: ProjectState;
  financing: FinancingType;
  loanBank: string | null;
}

/** One ledger entry (`payments`). */
export interface ReportPayment {
  workOrderId: string;
  paidOn: string;
  amount: number;
  purpose: PaymentPurpose;
  /** KSEB fees only: the BSS office paid KSEB for the customer. */
  paidByOffice: boolean;
  method: PaymentMethod;
  reference: string | null;
}

export interface ReportProject {
  workOrderId: string;
  isCompleted: boolean;
  /**
   * When it was commissioned (a timestamp). Null for an imported project whose
   * commissioning date was not in the sheet: it is never counted in a month.
   */
  completedAt: string | null;
  cancellation: ProjectCancellation | null;
  cancelledOn: string | null;
}

export interface ReportTicket {
  status: TicketStatus;
  /** The day the visit was done, when the engineer recorded it. */
  serviceDate: string | null;
  /** Timestamp of the ticket's last change: the fallback day for a completed visit. */
  updatedAt: string;
}

/** One incentive instalment paid to a coordinator. */
export interface ReportIncentivePayment {
  amount: number;
  paidOn: string;
}

export interface ReportData {
  /** Every work order (rejected ones too: payments and projects may point at them). */
  sales: ReportSale[];
  /** Ledger entries dated inside the report's range. */
  payments: ReportPayment[];
  projects: ReportProject[];
  /** Completed service tickets (other statuses are ignored). */
  tickets: ReportTicket[];
  /** Instalments dated inside the report's range. */
  incentivePayments: ReportIncentivePayment[];
}

/** "As of today" figures, not tied to the month (from `dashboard_metrics()`). */
export interface ReportSnapshot {
  activeProjects: number;
  /** Commissioned, not cancelled, with a balance still due. */
  commissionedUnpaid: number;
  /** Σ balance due on those. */
  outstandingAmount: number;
  /** Agreed incentives less the instalments paid. */
  incentivePending: number;
  /** Open, scheduled or in progress. */
  openTickets: number;
}

// ---------------------------------------------------------------------------
// Months, windows and the financial year
// ---------------------------------------------------------------------------

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** Nothing in the business predates this; an older `?month=` is a typo. */
const FIRST_MONTH = "2000-01";

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const MONTH_SHORT = MONTH_LONG.map((m) => m.slice(0, 3));

const pad2 = (n: number) => String(n).padStart(2, "0");

function splitMonth(month: string): [number, number] {
  const [y, m] = month.split("-").map(Number);
  return [y, m];
}

function splitDate(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

/** A real `YYYY-MM` (month 01–12). */
export function isMonthKey(value: string | null | undefined): value is string {
  return !!value && MONTH_KEY.test(value);
}

/** Days in a `YYYY-MM` month (leap years included). */
export function daysInMonth(month: string): number {
  const [y, m] = splitMonth(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** `YYYY-MM` moved by `n` months (negative goes back). */
export function addMonths(month: string, n: number): string {
  const [y, m] = splitMonth(month);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
}

/** The given day of a month, clamped to the month's length (31 → 28 in February). */
function dayOf(month: string, day: number): string {
  return `${month}-${pad2(Math.min(day, daysInMonth(month)))}`;
}

/** `2026-11` → "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = splitMonth(month);
  return `${MONTH_LONG[m - 1]} ${y}`;
}

/** `2026-11` → "Nov 2026". */
export function monthShortLabel(month: string): string {
  const [y, m] = splitMonth(month);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

/**
 * A span of days as people say it: "1–24 Nov 2026", "1 Apr – 24 Nov 2026",
 * "1 Apr 2025 – 31 Mar 2026", or a single day.
 */
export function rangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = splitDate(from);
  const [ty, tm, td] = splitDate(to);
  const fMon = MONTH_SHORT[fm - 1];
  const tMon = MONTH_SHORT[tm - 1];
  if (from === to) return `${fd} ${fMon} ${fy}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${tMon} ${ty}`;
  if (fy === ty) return `${fd} ${fMon} – ${td} ${tMon} ${ty}`;
  return `${fd} ${fMon} ${fy} – ${td} ${tMon} ${ty}`;
}

/**
 * The month the report is for, from `?month=`. Anything that is not a real
 * `YYYY-MM` up to the current month — missing, malformed, in the future, or
 * absurdly old — falls back to the current month (in India time, from `today`).
 */
export function parseReportMonth(
  value: string | string[] | undefined,
  today: string,
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const current = today.slice(0, 7);
  if (!isMonthKey(raw) || raw > current || raw < FIRST_MONTH) return current;
  return raw;
}

/**
 * The Indian financial year (1 April – 31 March) a day falls in: its first day.
 * 2026-03-31 → 2025-04-01; 2026-04-01 → 2026-04-01.
 */
export function fyStartOf(iso: string): string {
  const [y, m] = splitDate(iso);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** "FY 2026–27" for the year starting 2026-04-01. */
export function fyLabel(fyStart: string): string {
  const y = Number(fyStart.slice(0, 4));
  return `FY ${y}–${pad2((y + 1) % 100)}`;
}

/** The same calendar day a year earlier; 29 Feb becomes 28 Feb. */
function yearEarlier(iso: string): string {
  const [y, m, d] = splitDate(iso);
  return dayOf(`${y - 1}-${pad2(m)}`, d);
}

/** Inclusive span of business days, with how it is printed. */
export interface DateWindow {
  from: string;
  to: string;
  label: string;
}

export interface ReportPeriod {
  /** The month reported (`YYYY-MM`). */
  month: string;
  /** It is the current month: the window ends today, and comparisons match its days. */
  soFar: boolean;
  /** The month itself (1st–today for the current month). */
  current: DateWindow;
  /** The month before, cut to the same number of days when `soFar`. */
  previous: DateWindow;
  /** The same month a year earlier, likewise. */
  lastYear: DateWindow;
  /** The financial year to the end of the window. */
  fy: DateWindow;
  /** The same span one year earlier. */
  fyBase: DateWindow;
  /** "FY 2026–27" and "FY 2025–26". */
  fyName: string;
  fyBaseName: string;
  /** Every dated record the report uses lies in this span. */
  range: { from: string; to: string };
}

/** A whole month's window, or its first `days` days. */
function monthWindow(month: string, days: number | null): DateWindow {
  const from = `${month}-01`;
  if (days === null) {
    return { from, to: dayOf(month, 31), label: monthShortLabel(month) };
  }
  const to = dayOf(month, days);
  return { from, to, label: rangeLabel(from, to) };
}

/**
 * The windows of a report for `month`, given today's date in India. The
 * current month runs 1st..today and every comparison window keeps the same
 * day count (clamped to a shorter month); a past month is whole against whole.
 */
export function reportPeriod(month: string, today: string): ReportPeriod {
  const soFar = month === today.slice(0, 7);
  const days = soFar ? splitDate(today)[2] : null;
  const current = monthWindow(month, days);
  const previous = monthWindow(addMonths(month, -1), days);
  const lastYear = monthWindow(addMonths(month, -12), days);

  const fyFrom = fyStartOf(current.to);
  const fyBaseFrom = yearEarlier(fyFrom);
  const fyBaseTo = yearEarlier(current.to);
  const fy = { from: fyFrom, to: current.to, label: rangeLabel(fyFrom, current.to) };
  const fyBase = { from: fyBaseFrom, to: fyBaseTo, label: rangeLabel(fyBaseFrom, fyBaseTo) };

  // The trend reaches 12 months back (its first row's month-on-month base).
  const trendFrom = `${addMonths(month, -12)}-01`;
  return {
    month,
    soFar,
    current,
    previous,
    lastYear,
    fy,
    fyBase,
    fyName: fyLabel(fyFrom),
    fyBaseName: fyLabel(fyBaseFrom),
    range: { from: trendFrom < fyBaseFrom ? trendFrom : fyBaseFrom, to: current.to },
  };
}

/** The month of the earliest order date, or null with no sales at all. */
export function earliestOrderMonth(sales: readonly Pick<ReportSale, "orderDate">[]): string | null {
  let earliest: string | null = null;
  for (const sale of sales) {
    if (sale.orderDate && (earliest === null || sale.orderDate < earliest)) {
      earliest = sale.orderDate;
    }
  }
  return earliest ? earliest.slice(0, 7) : null;
}

/**
 * The month picker: every month from the earliest sale (or the selected month,
 * if older) to the current month, newest first. The current month reads
 * "<Month YYYY> (so far)".
 */
export function reportMonthOptions(
  earliest: string | null,
  today: string,
  selected: string,
): { value: string; label: string }[] {
  const current = today.slice(0, 7);
  let first = earliest && earliest < current ? earliest : current;
  if (selected < first) first = selected;
  // A mistyped order date from before the business must not list decades.
  if (first < FIRST_MONTH) first = FIRST_MONTH;
  const options: { value: string; label: string }[] = [];
  for (let m = current; m >= first; m = addMonths(m, -1)) {
    options.push({
      value: m,
      label: m === current ? `${monthLabel(m)} (so far)` : monthLabel(m),
    });
  }
  return options;
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

/**
 * Change against a base. `change`: (current − base) / |base| × 100, one decimal
 * (|base| so a negative base — refunds outweighing receipts — still reads the
 * right way round). `new`: nothing in the base and something now. `null`:
 * nothing to compare (both zero, or a base of zero and a negative figure).
 */
export type Growth = { kind: "change"; pct: number } | { kind: "new" } | null;

function round1(value: number): number {
  const r = Math.sign(value) * Math.round(Math.abs(value) * 10 + 1e-9) / 10;
  return r === 0 ? 0 : r;
}

export function growth(current: number, base: number): Growth {
  if (base === 0) return current > 0 ? { kind: "new" } : null;
  return { kind: "change", pct: round1(((current - base) / Math.abs(base)) * 100) };
}

/** "▲ 12.5%", "▼ 3.0%", "0.0%", "new" or "—" (on screen). */
export function formatGrowth(g: Growth): string {
  if (g === null) return "—";
  if (g.kind === "new") return "new";
  if (g.pct > 0) return `▲ ${g.pct.toFixed(1)}%`;
  if (g.pct < 0) return `▼ ${Math.abs(g.pct).toFixed(1)}%`;
  return "0.0%";
}

/** "+12.5%", "-3.0%", "0.0%", "new" or "-" — for the PDF, whose fonts have no arrows. */
export function formatGrowthPlain(g: Growth): string {
  if (g === null) return "-";
  if (g.kind === "new") return "new";
  if (g.pct > 0) return `+${g.pct.toFixed(1)}%`;
  if (g.pct < 0) return `-${Math.abs(g.pct).toFixed(1)}%`;
  return "0.0%";
}

/** The CSV form: the number ("12.5", "-3"), "new", or empty. */
function growthCell(g: Growth): string {
  if (g === null) return "";
  if (g.kind === "new") return "new";
  return String(g.pct);
}

// ---------------------------------------------------------------------------
// Counting one window
// ---------------------------------------------------------------------------

/** Data indexed once, so each window is a cheap pass. */
export interface PreparedReport {
  saleById: ReadonlyMap<string, ReportSale>;
  /** Booked sales: every status but rejected. */
  booked: readonly ReportSale[];
  /** Booked sales with an advance, and the day it counts on. */
  advances: readonly { sale: ReportSale; on: string }[];
  payments: readonly ReportPayment[];
  /** Commissioned, not cancelled, with a known day (IST). */
  commissions: readonly { workOrderId: string; on: string }[];
  cancellations: readonly { kind: ProjectCancellation; on: string }[];
  /** The day each completed service visit counts on. */
  servicesDone: readonly string[];
  incentivePayments: readonly ReportIncentivePayment[];
}

export function prepareReportData(data: ReportData): PreparedReport {
  const booked = data.sales.filter((s) => s.status !== "rejected");
  return {
    saleById: new Map(data.sales.map((s) => [s.id, s])),
    booked,
    advances: booked
      .filter((s) => s.advanceAmount > 0)
      .map((sale) => ({ sale, on: sale.advancePaidOn ?? sale.orderDate })),
    payments: data.payments,
    commissions: data.projects.flatMap((p) =>
      p.isCompleted && p.completedAt && p.cancellation === null
        ? [{ workOrderId: p.workOrderId, on: istDateOf(p.completedAt) }]
        : [],
    ),
    cancellations: data.projects.flatMap((p) =>
      p.cancellation && p.cancelledOn ? [{ kind: p.cancellation, on: p.cancelledOn }] : [],
    ),
    servicesDone: data.tickets.flatMap((t) =>
      t.status === "completed" ? [t.serviceDate ?? istDateOf(t.updatedAt)] : [],
    ),
    incentivePayments: data.incentivePayments,
  };
}

const inWindow = (day: string, w: { from: string; to: string }) =>
  day >= w.from && day <= w.to;

export interface SalesFigures {
  /** Work orders booked (order date in the window), rejected ones left out. */
  count: number;
  /** Σ total cost of those. */
  value: number;
  /** Σ kW of those (custom plans have none). */
  kw: number;
  /** value / count (0 with no sales). */
  average: number;
  /** Of those, still waiting for approval today. */
  pendingApproval: number;
  /** Of those, cancelled since. */
  cancelledSince: number;
  /** Of those, refunded since. */
  refundedSince: number;
}

/** A collections line: Σ amount and how many entries. */
export interface CollectionTotal {
  amount: number;
  count: number;
}

export interface CollectionFigures {
  /** Booking advances, on the day paid (or the order date when that is unknown). */
  advances: CollectionTotal;
  contract: CollectionTotal;
  refunds: CollectionTotal;
  /** advances + contract − refunds: the money that came in and stayed. */
  net: number;
  /** Not in `net`: KSEB fees the customer paid through BSS (passed on to KSEB). */
  ksebCollected: CollectionTotal;
  /** Not in `net`: KSEB fees the office paid for the customer. */
  ksebByOffice: CollectionTotal;
  /** Not in `net`, and not money: balances the office chose not to collect. */
  writeOffs: CollectionTotal;
}

export interface PeriodFigures {
  sales: SalesFigures;
  collections: CollectionFigures;
  /** Projects commissioned (handed over) in the window and not cancelled. */
  commissioned: number;
  /** Projects cancelled in the window (cancelled_on). */
  cancelled: number;
  /** Projects refunded in the window. */
  refunded: number;
  /** Service visits completed in the window. */
  servicesCompleted: number;
  /** Σ incentive instalments paid in the window. */
  incentivesPaid: number;
}

const total = (): { amount: number; count: number } => ({ amount: 0, count: 0 });
const add = (t: CollectionTotal, amount: number) => {
  t.amount += amount;
  t.count += 1;
};
const rounded = (t: CollectionTotal): CollectionTotal => ({
  amount: round2(t.amount),
  count: t.count,
});

/** Every figure of the report for one window. */
export function periodFigures(
  data: PreparedReport,
  w: { from: string; to: string },
): PeriodFigures {
  let count = 0;
  let value = 0;
  let kw = 0;
  let pendingApproval = 0;
  let cancelledSince = 0;
  let refundedSince = 0;
  for (const sale of data.booked) {
    if (!inWindow(sale.orderDate, w)) continue;
    count += 1;
    value += sale.totalCost;
    kw += sale.capacityKw ?? 0;
    if (sale.status === "pending") pendingApproval += 1;
    if (sale.projectState === "cancelled") cancelledSince += 1;
    if (sale.projectState === "refunded") refundedSince += 1;
  }

  const advances = total();
  for (const a of data.advances) if (inWindow(a.on, w)) add(advances, a.sale.advanceAmount);

  const contract = total();
  const refunds = total();
  const ksebCollected = total();
  const ksebByOffice = total();
  const writeOffs = total();
  for (const p of data.payments) {
    if (!inWindow(p.paidOn, w)) continue;
    if (p.purpose === "contract") add(contract, p.amount);
    else if (p.purpose === "refund") add(refunds, p.amount);
    else if (p.purpose === "write_off") add(writeOffs, p.amount);
    else if (p.paidByOffice) add(ksebByOffice, p.amount);
    else add(ksebCollected, p.amount);
  }

  let incentivesPaid = 0;
  for (const p of data.incentivePayments) if (inWindow(p.paidOn, w)) incentivesPaid += p.amount;

  return {
    sales: {
      count,
      value: round2(value),
      kw: round2(kw),
      average: count ? round2(value / count) : 0,
      pendingApproval,
      cancelledSince,
      refundedSince,
    },
    collections: {
      advances: rounded(advances),
      contract: rounded(contract),
      refunds: rounded(refunds),
      net: round2(advances.amount + contract.amount - refunds.amount),
      ksebCollected: rounded(ksebCollected),
      ksebByOffice: rounded(ksebByOffice),
      writeOffs: rounded(writeOffs),
    },
    commissioned: data.commissions.filter((c) => inWindow(c.on, w)).length,
    cancelled: data.cancellations.filter((c) => c.kind === "cancelled" && inWindow(c.on, w))
      .length,
    refunded: data.cancellations.filter((c) => c.kind === "refunded" && inWindow(c.on, w))
      .length,
    servicesCompleted: data.servicesDone.filter((day) => inWindow(day, w)).length,
    incentivesPaid: round2(incentivesPaid),
  };
}

// ---------------------------------------------------------------------------
// Headline KPIs and the financial year
// ---------------------------------------------------------------------------

export type FigureFormat = "count" | "money" | "kw";

/** Which way is good news for a figure (it colours the change). */
export type Better = "up" | "down" | "neutral";

export type KpiKey =
  | "salesCount"
  | "salesValue"
  | "capacity"
  | "averageValue"
  | "netCollected"
  | "commissioned"
  | "servicesCompleted"
  | "incentivesPaid"
  | "cancelledRefunded";

export interface Kpi {
  key: KpiKey;
  label: string;
  format: FigureFormat;
  value: number;
  previous: number;
  lastYear: number;
  vsPrevious: Growth;
  vsLastYear: Growth;
  better: Better;
  /** A line of context under the figure, when there is one. */
  hint: string | null;
}

interface FigureDef {
  key: KpiKey;
  label: string;
  format: FigureFormat;
  better: Better;
  pick: (f: PeriodFigures) => number;
}

const figure = (
  key: KpiKey,
  label: string,
  format: FigureFormat,
  better: Better,
  pick: (f: PeriodFigures) => number,
): FigureDef => ({ key, label, format, better, pick });

/** The headline figures, in the order they are shown. */
const FIGURES: readonly FigureDef[] = [
  figure("salesCount", "Sales booked", "count", "up", (f) => f.sales.count),
  figure("salesValue", "Sales value", "money", "up", (f) => f.sales.value),
  figure("capacity", "Capacity sold", "kw", "up", (f) => f.sales.kw),
  figure("averageValue", "Average sale", "money", "up", (f) => f.sales.average),
  figure("netCollected", "Net collected", "money", "up", (f) => f.collections.net),
  figure("commissioned", "Commissioned", "count", "up", (f) => f.commissioned),
  figure("servicesCompleted", "Service visits done", "count", "up", (f) => f.servicesCompleted),
  figure("incentivesPaid", "Incentives paid", "money", "neutral", (f) => f.incentivesPaid),
  figure("cancelledRefunded", "Cancelled / refunded", "count", "down", (f) => f.cancelled + f.refunded),
];

function kpiHint(key: KpiKey, f: PeriodFigures): string | null {
  switch (key) {
    case "salesCount": {
      const parts = [`${f.sales.pendingApproval} pending approval`];
      const closed = f.sales.cancelledSince + f.sales.refundedSince;
      if (closed > 0) parts.push(`${closed} cancelled/refunded since`);
      return parts.join(" · ");
    }
    case "capacity":
      return "Solar plants only (custom plans have no kW)";
    case "netCollected":
      return "Advances + contract payments − refunds";
    case "cancelledRefunded":
      return `${f.cancelled} cancelled · ${f.refunded} refunded`;
    default:
      return null;
  }
}

export function headlineKpis(
  current: PeriodFigures,
  previous: PeriodFigures,
  lastYear: PeriodFigures,
): Kpi[] {
  return FIGURES.map((def) => {
    const value = def.pick(current);
    const prev = def.pick(previous);
    const ly = def.pick(lastYear);
    return {
      key: def.key,
      label: def.label,
      format: def.format,
      value,
      previous: prev,
      lastYear: ly,
      vsPrevious: growth(value, prev),
      vsLastYear: growth(value, ly),
      better: def.better,
      hint: kpiHint(def.key, current),
    };
  });
}

export interface ComparisonRow {
  label: string;
  format: FigureFormat;
  better: Better;
  value: number;
  base: number;
  change: Growth;
}

/** The figures compared across the financial year to date. */
const FY_KEYS: readonly KpiKey[] = [
  "salesCount",
  "salesValue",
  "capacity",
  "netCollected",
  "commissioned",
  "servicesCompleted",
  "incentivesPaid",
];

export function fyComparison(fy: PeriodFigures, base: PeriodFigures): ComparisonRow[] {
  return FIGURES.filter((def) => FY_KEYS.includes(def.key)).map((def) => ({
    label: def.label,
    format: def.format,
    better: def.better,
    value: def.pick(fy),
    base: def.pick(base),
    change: growth(def.pick(fy), def.pick(base)),
  }));
}

// ---------------------------------------------------------------------------
// The 12-month trend
// ---------------------------------------------------------------------------

export interface TrendRow {
  month: string;
  /** "Nov 2026", or "Nov 2026 (so far)" for the current month. */
  label: string;
  soFar: boolean;
  salesCount: number;
  salesValue: number;
  capacityKw: number;
  netCollected: number;
  commissioned: number;
  servicesCompleted: number;
  /**
   * Sales value against the month before. The current month (so far) is set
   * against the same days of the month before, like the headline figures.
   */
  valueMoM: Growth;
  /** 0–100: the month's sales value as a share of the biggest month shown. */
  barPct: number;
}

/** Twelve months ending at the report's month, oldest first. */
export function trendRows(data: PreparedReport, period: ReportPeriod): TrendRow[] {
  const rows = Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(period.month, i - 11);
    const isReportMonth = month === period.month;
    const window = isReportMonth ? period.current : monthWindow(month, null);
    const base =
      isReportMonth && period.soFar ? period.previous : monthWindow(addMonths(month, -1), null);
    const f = periodFigures(data, window);
    const soFar = isReportMonth && period.soFar;
    return {
      month,
      label: soFar ? `${monthShortLabel(month)} (so far)` : monthShortLabel(month),
      soFar,
      salesCount: f.sales.count,
      salesValue: f.sales.value,
      capacityKw: f.sales.kw,
      netCollected: f.collections.net,
      commissioned: f.commissioned,
      servicesCompleted: f.servicesCompleted,
      valueMoM: growth(f.sales.value, periodFigures(data, base).sales.value),
      barPct: 0,
    };
  });
  const max = Math.max(0, ...rows.map((r) => r.salesValue));
  for (const row of rows) {
    row.barPct = max > 0 && row.salesValue > 0 ? round1((row.salesValue / max) * 100) : 0;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// By coordinator
// ---------------------------------------------------------------------------

/** The row for sales with nobody on them (should not happen; kept so totals add up). */
export const NO_COORDINATOR = "No coordinator";

export interface CoordinatorRow {
  /** Null for the "No coordinator" row. */
  id: string | null;
  name: string;
  /** Sales booked in the window that they are on. */
  sales: number;
  /** Of those, how many they share with someone else. */
  shared: number;
  /** Σ total cost ÷ the number of people on each sale, to the paisa (see `splitUnits`). */
  valueShare: number;
  /** Σ kW ÷ the number of people on each sale, to the hundredth. */
  kwShare: number;
  /** Their sales (any month's) commissioned in the window. */
  commissioned: number;
}

export interface CoordinatorTable {
  rows: CoordinatorRow[];
  /** The whole team: equal to the headline figures (each sale once). */
  totals: { sales: number; shared: number; value: number; kw: number; commissioned: number };
}

/** A figure in whole hundredths (paise, or hundredths of a kW): those add up exactly. */
const toUnits = (value: number) => Math.round(value * 100);

/**
 * `units` split between `n` people as evenly as whole units allow — the
 * largest-remainder method: everyone gets the same, and the units left over go
 * one each to the first people in order. The parts add up to `units` exactly;
 * ₹1,00,000 three ways is ₹33,333.34 + ₹33,333.33 + ₹33,333.33.
 */
function splitUnits(units: number, n: number): number[] {
  const each = Math.floor(units / n);
  const left = units - each * n;
  return Array.from({ length: n }, (_, i) => each + (i < left ? 1 : 0));
}

/**
 * Who sold what in the window. A shared sale counts as one sale for each person
 * on it, and its value and kW are split evenly between them — the odd paisa or
 * hundredth of a kW to whoever is named first on the sale — so the rows add up
 * exactly to the totals, which are the headline figures. Sorted by value share,
 * biggest first.
 */
export function coordinatorTable(
  data: PreparedReport,
  w: { from: string; to: string },
): CoordinatorTable {
  // valueShare and kwShare are counted in whole hundredths until the end.
  const rows = new Map<string, CoordinatorRow>();
  const KEY_NONE = "\u0000none";
  const rowFor = (id: string | null, name: string): CoordinatorRow => {
    const key = id ?? KEY_NONE;
    let row = rows.get(key);
    if (!row) {
      row = { id, name, sales: 0, shared: 0, valueShare: 0, kwShare: 0, commissioned: 0 };
      rows.set(key, row);
    }
    return row;
  };
  const team = (sale: ReportSale | undefined): CoordinatorRow[] =>
    sale && sale.coordinatorIds.length > 0
      ? sale.coordinatorIds.map((id, i) => rowFor(id, sale.coordinatorNames[i] ?? "Unknown"))
      : [rowFor(null, NO_COORDINATOR)];

  let sales = 0;
  let shared = 0;
  let value = 0;
  let kw = 0;
  for (const sale of data.booked) {
    if (!inWindow(sale.orderDate, w)) continue;
    const people = team(sale);
    const isShared = people.length > 1;
    const saleValue = toUnits(sale.totalCost);
    const saleKw = toUnits(sale.capacityKw ?? 0);
    sales += 1;
    if (isShared) shared += 1;
    value += saleValue;
    kw += saleKw;
    const valueParts = splitUnits(saleValue, people.length);
    const kwParts = splitUnits(saleKw, people.length);
    people.forEach((row, i) => {
      row.sales += 1;
      if (isShared) row.shared += 1;
      row.valueShare += valueParts[i];
      row.kwShare += kwParts[i];
    });
  }

  let commissioned = 0;
  for (const c of data.commissions) {
    if (!inWindow(c.on, w)) continue;
    commissioned += 1;
    for (const row of team(data.saleById.get(c.workOrderId))) row.commissioned += 1;
  }

  const list = [...rows.values()].map((row) => ({
    ...row,
    valueShare: row.valueShare / 100,
    kwShare: row.kwShare / 100,
  }));
  list.sort(
    (a, b) =>
      b.valueShare - a.valueShare ||
      Number(a.id === null) - Number(b.id === null) ||
      a.name.localeCompare(b.name),
  );
  return {
    rows: list,
    totals: { sales, shared, value: value / 100, kw: kw / 100, commissioned },
  };
}

// ---------------------------------------------------------------------------
// Line items (the CSV downloads)
// ---------------------------------------------------------------------------

/** One sale booked in the window, as the Sales CSV lists it. */
export interface SaleLine {
  orderDate: string;
  clientName: string;
  coordinators: string;
  plan: string;
  capacityKw: number | null;
  totalCost: number;
  advance: number;
  receivedToDate: number;
  balanceDue: number;
  status: WorkOrderStatus;
  projectState: ProjectState;
  financing: string;
}

export type CollectionKind =
  | "advance"
  | "contract payment"
  | "refund"
  | "KSEB fee"
  | "KSEB fee paid by office"
  | "write-off";

const KIND_ORDER: readonly CollectionKind[] = [
  "advance",
  "contract payment",
  "refund",
  "KSEB fee",
  "KSEB fee paid by office",
  "write-off",
];

/** One money movement in the window, as the Collections CSV lists it. */
export interface CollectionLine {
  date: string;
  clientName: string;
  kind: CollectionKind;
  /** "UPI", "Cash"…; empty when not recorded (older advances). */
  method: string;
  /** As recorded (a refund is a positive amount of kind "refund"). */
  amount: number;
  reference: string;
}

function financingText(sale: ReportSale): string {
  const label = FINANCING_LABELS[sale.financing] ?? sale.financing;
  return sale.financing === "loan" && sale.loanBank ? `${label} (${sale.loanBank})` : label;
}

/** Sales booked in the window, oldest first. */
export function saleLines(data: PreparedReport, w: { from: string; to: string }): SaleLine[] {
  return data.booked
    .filter((s) => inWindow(s.orderDate, w))
    .sort(
      (a, b) =>
        a.orderDate.localeCompare(b.orderDate) || a.clientName.localeCompare(b.clientName),
    )
    .map((s) => ({
      orderDate: s.orderDate,
      clientName: s.clientName,
      coordinators: s.coordinatorNames.join(", "),
      plan: s.plan,
      capacityKw: s.capacityKw,
      totalCost: s.totalCost,
      advance: s.advanceAmount,
      receivedToDate: s.receivedToDate,
      balanceDue: s.balanceDue,
      status: s.status,
      projectState: s.projectState,
      financing: financingText(s),
    }));
}

function paymentKind(p: ReportPayment): CollectionKind {
  switch (p.purpose) {
    case "contract":
      return "contract payment";
    case "refund":
      return "refund";
    case "write_off":
      return "write-off";
    default:
      return p.paidByOffice ? "KSEB fee paid by office" : "KSEB fee";
  }
}

/** Every advance and ledger entry in the window, by date. */
export function collectionLines(
  data: PreparedReport,
  w: { from: string; to: string },
): CollectionLine[] {
  const lines: CollectionLine[] = [];
  for (const { sale, on } of data.advances) {
    if (!inWindow(on, w)) continue;
    lines.push({
      date: on,
      clientName: sale.clientName,
      kind: "advance",
      method: sale.advanceMethod ? PAYMENT_METHOD_LABELS[sale.advanceMethod] : "",
      amount: sale.advanceAmount,
      reference: sale.advanceReference ?? "",
    });
  }
  for (const p of data.payments) {
    if (!inWindow(p.paidOn, w)) continue;
    lines.push({
      date: p.paidOn,
      clientName: data.saleById.get(p.workOrderId)?.clientName ?? "Unknown sale",
      kind: paymentKind(p),
      method: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
      amount: p.amount,
      reference: p.reference ?? "",
    });
  }
  return lines.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.clientName.localeCompare(b.clientName),
  );
}

const money = (n: number) => round2(n).toFixed(2);
const kwCell = (n: number | null) => (n === null ? "" : String(round2(n)));

export const SALES_CSV_HEADER = [
  "order_date",
  "client_name",
  "coordinators",
  "plan",
  "capacity_kw",
  "total_cost",
  "advance",
  "received_to_date",
  "balance_due",
  "status",
  "project_state",
  "financing",
] as const;

/**
 * Free text (names, the plan, the bank, references) goes through
 * `spreadsheetText`, so nothing typed into the app runs as a formula when the
 * file is opened in Excel; dates, amounts and kW stay plain numbers.
 */
export function salesCsvRows(lines: readonly SaleLine[]): string[][] {
  return [
    [...SALES_CSV_HEADER],
    ...lines.map((l) => [
      l.orderDate,
      spreadsheetText(l.clientName),
      spreadsheetText(l.coordinators),
      spreadsheetText(l.plan),
      kwCell(l.capacityKw),
      money(l.totalCost),
      money(l.advance),
      money(l.receivedToDate),
      money(l.balanceDue),
      l.status,
      l.projectState,
      spreadsheetText(l.financing),
    ]),
  ];
}

export const COLLECTIONS_CSV_HEADER = [
  "date",
  "client_name",
  "kind",
  "method",
  "amount",
  "reference",
] as const;

/** Free text escaped like the sales CSV's. */
export function collectionsCsvRows(lines: readonly CollectionLine[]): string[][] {
  return [
    [...COLLECTIONS_CSV_HEADER],
    ...lines.map((l) => [
      l.date,
      spreadsheetText(l.clientName),
      l.kind,
      spreadsheetText(l.method),
      money(l.amount),
      spreadsheetText(l.reference),
    ]),
  ];
}

export const TREND_CSV_HEADER = [
  "month",
  "so_far",
  "sales_count",
  "sales_value",
  "capacity_kw",
  "net_collected",
  "commissioned",
  "services_completed",
  "sales_value_mom_pct",
] as const;

export function trendCsvRows(rows: readonly TrendRow[]): string[][] {
  return [
    [...TREND_CSV_HEADER],
    ...rows.map((r) => [
      r.month,
      r.soFar ? "yes" : "no",
      String(r.salesCount),
      money(r.salesValue),
      kwCell(r.capacityKw),
      money(r.netCollected),
      String(r.commissioned),
      String(r.servicesCompleted),
      growthCell(r.valueMoM),
    ]),
  ];
}

export type ReportFile = "pdf" | "sales" | "collections" | "trend";

/** bss-report-2026-11.pdf, bss-sales-2026-11.csv, … */
export function reportFileName(file: ReportFile, month: string): string {
  return file === "pdf" ? `bss-report-${month}.pdf` : `bss-${file}-${month}.csv`;
}

// ---------------------------------------------------------------------------
// The whole report
// ---------------------------------------------------------------------------

/** Everything the page, the PDF and the CSVs show. Plain data: it crosses to the client. */
export interface MonthlyReport {
  period: ReportPeriod;
  /** "November 2026". */
  monthLabel: string;
  /** The day it was produced (India). */
  generatedOn: string;
  current: PeriodFigures;
  previous: PeriodFigures;
  lastYear: PeriodFigures;
  kpis: Kpi[];
  fy: ComparisonRow[];
  trend: TrendRow[];
  coordinators: CoordinatorTable;
  snapshot: ReportSnapshot;
  sales: SaleLine[];
  collections: CollectionLine[];
}

export function buildMonthlyReport(
  data: ReportData,
  period: ReportPeriod,
  snapshot: ReportSnapshot,
  today: string,
): MonthlyReport {
  const prepared = prepareReportData(data);
  const current = periodFigures(prepared, period.current);
  const previous = periodFigures(prepared, period.previous);
  const lastYear = periodFigures(prepared, period.lastYear);
  return {
    period,
    monthLabel: monthLabel(period.month),
    generatedOn: today,
    current,
    previous,
    lastYear,
    kpis: headlineKpis(current, previous, lastYear),
    fy: fyComparison(
      periodFigures(prepared, period.fy),
      periodFigures(prepared, period.fyBase),
    ),
    trend: trendRows(prepared, period),
    coordinators: coordinatorTable(prepared, period.current),
    snapshot,
    sales: saleLines(prepared, period.current),
    collections: collectionLines(prepared, period.current),
  };
}

/** "12.5 kW", "1,250 kW": capacity as printed everywhere in the report. */
export function formatKw(value: number): string {
  return `${round2(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kW`;
}

/**
 * How the numbers are counted, in plain words. The page's note and the PDF's
 * last section print the same list, so they can never disagree.
 */
export const REPORT_NOTES: readonly { term: string; text: string }[] = [
  {
    term: "Sales booked",
    text: "Work orders by their order date, pending and approved (rejected ones are left out). Value is the total cost; capacity adds up the kW of solar plants (custom plans have none). Cancelled and refunded sales still count in the month they were booked; the card says how many were cancelled or refunded since.",
  },
  {
    term: "Net collected",
    text: "Booking advances (on the day paid, or the order date when that was not recorded) plus contract payments, less refunds, each by its own date. KSEB fees, whether collected from the customer or paid by the office, and write-offs are listed apart and are not in net collected.",
  },
  {
    term: "Commissioned",
    text: "Projects handed over in the period (India time) that are not cancelled or refunded. Imported projects whose commissioning date was not in the sheet have no date and are not counted in any month.",
  },
  {
    term: "Cancelled / refunded",
    text: "Projects by the date they were marked cancelled or refunded.",
  },
  {
    term: "Service visits done",
    text: "Completed service tickets by the visit date, or by the day the ticket was last updated when no visit date was recorded.",
  },
  {
    term: "Incentives paid",
    text: "Incentive instalments paid to coordinators, by the date paid.",
  },
  {
    term: "Comparisons",
    text: "The current month counts up to today and is compared with the same days of the month before and of the same month last year; a past month is compared whole. Change = (this − before) ÷ before; \"new\" when there was nothing before, \"—\" when both are zero.",
  },
  {
    term: "Financial year",
    text: "1 April to 31 March. \"To date\" runs to the end of the selected period and is compared with the same span a year earlier.",
  },
  {
    term: "By coordinator",
    text: "A shared sale counts as a sale for each person on it, and its value and kW are split evenly between them (an odd paisa, or hundredth of a kW, goes to whoever is named first on the sale), so the shares add up exactly to the totals. Commissioned counts their sales (from any month) handed over in the period.",
  },
  {
    term: "As of today",
    text: "Live figures for the business as it stands now, whichever month is selected.",
  },
];
