import { spreadsheetText, toCsv } from "@/lib/csv";
import type { TicketStatus, TicketType } from "@/lib/types";
import { isIsoDate, istDateOf, monthKey, monthName } from "./dates";
import { round2 } from "./rounding";
import { isActiveTicket } from "./ticket-workflow";

/**
 * The Services report (/reports/services): how many service visits each
 * engineer completed in a period, and what is on their plate right now.
 *
 * Pure — the repository fetches every ticket and every service engineer; this
 * module does all the counting. What each figure means:
 *
 * - **Completed in the period**: status `completed`, and the visit's date falls
 *   in the period. The visit's date is the service date on the sheet; a ticket
 *   closed without one counts on the IST day it was last updated (in practice,
 *   the day it was closed).
 * - **Routine / Ad-hoc**: the completed visits, split by ticket type.
 * - **Charges billed**: Σ ticket total of the completed visits.
 * - **Cancelled in the period**: status `cancelled`, on the IST day the ticket
 *   was last updated (a ticket keeps no "cancelled on" date of its own).
 * - **Now** — open/scheduled, in progress, overdue: where every ticket stands
 *   today, whatever period is chosen. Overdue is an active ticket whose
 *   scheduled date is before today; it is part of the other two, not extra.
 *
 * Every service engineer gets a row, with or without tickets. Tickets held by
 * someone who is no longer a service engineer keep a row under that person's
 * name, and tickets with nobody on them an "Unassigned" row — each only when it
 * has something to show — so the rows always add up to the totals.
 */

/** A ticket as the report reads it. */
export interface ServiceTicketFact {
  id: string;
  ticketNo: string | null;
  ticketType: TicketType;
  status: TicketStatus;
  /** The assigned engineer's profile id; null when nobody holds it. */
  engineerId: string | null;
  /** The assignee's name as stored — still there for a former engineer. */
  engineerName: string | null;
  /** The customer on the ticket's project; null for a ticket with no project. */
  clientName: string | null;
  scheduledDate: string | null;
  serviceDate: string | null;
  total: number | null;
  /** timestamptz, ISO. */
  createdAt: string;
  /** timestamptz, ISO. */
  updatedAt: string;
}

/** A current service engineer. */
export interface ServiceEngineerRef {
  id: string;
  name: string;
}

/** A calendar month (`YYYY-MM`, IST), or every ticket there is. */
export type ServicePeriod = { kind: "month"; month: string } | { kind: "all" };

/** `?month=` value for the whole history. */
export const ALL_TIME = "all";
export const ALL_TIME_LABEL = "All time";

/** Months in the 12-month trend. */
export const TREND_MONTHS = 12;

/** Rows the on-screen completed list shows; the CSV always has them all. */
export const COMPLETED_LIST_LIMIT = 200;

/**
 * The oldest month the picker lists (10 years back). A mistyped date years
 * before BSS existed must not grow the list to hundreds of entries; "All time"
 * still counts such a ticket.
 */
export const MAX_PICKER_MONTHS = 120;

/** Nothing before this is a real service visit. */
const EARLIEST_MONTH = "2000-01";

/** The row key of tickets nobody holds. */
export const UNASSIGNED_KEY = "unassigned";
export const UNASSIGNED_LABEL = "Unassigned";

/** Short ticket-type names for tables and the CSV. */
export const SERVICE_TYPE_LABELS: Record<TicketType, string> = {
  routine_6m: "Routine 6-month",
  adhoc: "Ad-hoc",
};

// ---------------------------------------------------------------------------
// Months and periods
// ---------------------------------------------------------------------------

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Strict `YYYY-MM`. */
export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY.test(value);
}

/** The month `delta` months after `month` (negative goes back). */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mon = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(mon).padStart(2, "0")}`;
}

/**
 * The period a `?month=` value asks for: "all", or a real month from 2000 up
 * to the current IST month. Anything else — missing, malformed, a future month
 * — is the current month.
 */
export function parseServicePeriod(value: unknown, today: string): ServicePeriod {
  if (value === ALL_TIME) return { kind: "all" };
  const current = monthKey(today);
  if (isMonthKey(value) && value >= EARLIEST_MONTH && value <= current) {
    return { kind: "month", month: value };
  }
  return { kind: "month", month: current };
}

/** The `?month=` value of a period. */
export function periodParam(period: ServicePeriod): string {
  return period.kind === "all" ? ALL_TIME : period.month;
}

/** "November 2026", with "(so far)" while it is the current month. */
export function monthLabel(month: string, today: string): string {
  return month === monthKey(today) ? `${monthName(month)} (so far)` : monthName(month);
}

export function periodLabel(period: ServicePeriod, today: string): string {
  return period.kind === "all" ? ALL_TIME_LABEL : monthLabel(period.month, today);
}

/** The CSV download's file name. */
export function servicesCsvFilename(period: ServicePeriod): string {
  return `bss-services-${periodParam(period)}.csv`;
}

/** The IST calendar day of a timestamp, or null when it is not one. */
function istDay(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? null : istDateOf(d);
}

/** The day a completed visit counts on; null for any other status. */
export function completedOn(
  ticket: Pick<ServiceTicketFact, "status" | "serviceDate" | "updatedAt">,
): string | null {
  if (ticket.status !== "completed") return null;
  return isIsoDate(ticket.serviceDate) ? ticket.serviceDate : istDay(ticket.updatedAt);
}

/** The day a cancelled ticket counts on; null for any other status. */
export function cancelledOn(
  ticket: Pick<ServiceTicketFact, "status" | "updatedAt">,
): string | null {
  return ticket.status === "cancelled" ? istDay(ticket.updatedAt) : null;
}

/** An active ticket whose visit was due before today. */
export function isOverdue(
  ticket: Pick<ServiceTicketFact, "status" | "scheduledDate">,
  today: string,
): boolean {
  return (
    isActiveTicket(ticket.status) &&
    isIsoDate(ticket.scheduledDate) &&
    ticket.scheduledDate < today
  );
}

export function inPeriod(date: string | null, period: ServicePeriod): boolean {
  if (!date) return false;
  return period.kind === "all" || monthKey(date) === period.month;
}

/**
 * The first month with service activity: the earliest IST day a ticket was
 * raised, or a completed visit's date when that is earlier (a sheet filled in
 * for an old visit). Null when there are no tickets.
 */
export function earliestServiceMonth(tickets: readonly ServiceTicketFact[]): string | null {
  let earliest: string | null = null;
  for (const t of tickets) {
    for (const day of [istDay(t.createdAt), completedOn(t)]) {
      if (day && day.slice(0, 7) >= EARLIEST_MONTH && (!earliest || day < earliest)) {
        earliest = day;
      }
    }
  }
  return earliest ? monthKey(earliest) : null;
}

export interface PeriodOption {
  value: string;
  label: string;
}

/**
 * The picker's choices: "All time", then every month from the current one back
 * to the first with service activity (at most MAX_PICKER_MONTHS), newest
 * first. A selected month older than that is listed too, so the picker never
 * shows a blank.
 */
export function periodOptions(
  earliestMonth: string | null,
  today: string,
  selected: ServicePeriod,
): PeriodOption[] {
  const current = monthKey(today);
  const floor = addMonths(current, -(MAX_PICKER_MONTHS - 1));
  let start = earliestMonth && earliestMonth < current ? earliestMonth : current;
  if (start < floor) start = floor;

  const months: string[] = [];
  for (let m = current; m >= start; m = addMonths(m, -1)) months.push(m);
  if (selected.kind === "month" && !months.includes(selected.month)) {
    months.push(selected.month);
  }
  return [
    { value: ALL_TIME, label: ALL_TIME_LABEL },
    ...months.map((m) => ({ value: m, label: monthLabel(m, today) })),
  ];
}

/** `count` months ending at `endMonth`, oldest first. */
export function trendMonths(endMonth: string, count = TREND_MONTHS): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(endMonth, i - (count - 1)));
}

// ---------------------------------------------------------------------------
// Who a ticket belongs to
// ---------------------------------------------------------------------------

/** engineer: a service engineer now. former: no longer one. unassigned: nobody. */
export type ServiceRowKind = "engineer" | "former" | "unassigned";

interface RowIdentity {
  /** The engineer's profile id, or UNASSIGNED_KEY. */
  key: string;
  name: string;
  kind: ServiceRowKind;
}

/** Said for a holder whose name could not be read. */
const UNKNOWN_HOLDER = "Former engineer";

/** Every current engineer by id, plus the row any ticket falls into. */
function identities(engineers: readonly ServiceEngineerRef[]) {
  const byId = new Map(engineers.map((e) => [e.id, e]));
  return {
    engineers: engineers.map(
      (e): RowIdentity => ({ key: e.id, name: e.name, kind: "engineer" }),
    ),
    of(ticket: Pick<ServiceTicketFact, "engineerId" | "engineerName">): RowIdentity {
      if (!ticket.engineerId) {
        return { key: UNASSIGNED_KEY, name: UNASSIGNED_LABEL, kind: "unassigned" };
      }
      const current = byId.get(ticket.engineerId);
      if (current) return { key: current.id, name: current.name, kind: "engineer" };
      return {
        key: ticket.engineerId,
        name: ticket.engineerName?.trim() || UNKNOWN_HOLDER,
        kind: "former",
      };
    },
  };
}

const byName = new Intl.Collator("en-IN", { sensitivity: "base", numeric: true });

/**
 * People first — by `score` (highest first), then name — and Unassigned last:
 * it is not a person to rank.
 */
function rankRows<T extends RowIdentity>(rows: T[], score: (row: T) => number): T[] {
  return [...rows].sort((a, b) => {
    const unassigned = Number(a.kind === "unassigned") - Number(b.kind === "unassigned");
    if (unassigned !== 0) return unassigned;
    return (
      score(b) - score(a) ||
      byName.compare(a.name, b.name) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    );
  });
}

/** A ticket's total in paise (no float dust when adding many). */
function paise(total: number | null | undefined): number {
  const n = Number(total ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ---------------------------------------------------------------------------
// Per-engineer summary
// ---------------------------------------------------------------------------

export interface ServiceCounts {
  /** Completed in the period. */
  completed: number;
  /** …of which routine 6-month checks. */
  routine: number;
  /** …of which ad-hoc visits. */
  adhoc: number;
  /** Σ total of the completed visits, rupees. */
  charges: number;
  /** Now: open or scheduled. */
  openScheduled: number;
  /** Now: in progress. */
  inProgress: number;
  /** Now: active and past its scheduled date. */
  overdue: number;
  /** Cancelled in the period. */
  cancelled: number;
}

export interface EngineerServiceRow extends ServiceCounts, RowIdentity {}

export function emptyCounts(): ServiceCounts {
  return {
    completed: 0,
    routine: 0,
    adhoc: 0,
    charges: 0,
    openScheduled: 0,
    inProgress: 0,
    overdue: 0,
    cancelled: 0,
  };
}

const COUNT_KEYS = Object.keys(emptyCounts()) as (keyof ServiceCounts)[];

function hasAny(counts: ServiceCounts): boolean {
  return COUNT_KEYS.some((key) => counts[key] !== 0);
}

/** One ticket's contribution, charges in paise. */
function countTicket(
  counts: ServiceCounts,
  ticket: ServiceTicketFact,
  period: ServicePeriod,
  today: string,
): void {
  if (inPeriod(completedOn(ticket), period)) {
    counts.completed += 1;
    if (ticket.ticketType === "routine_6m") counts.routine += 1;
    else counts.adhoc += 1;
    counts.charges += paise(ticket.total);
  }
  if (inPeriod(cancelledOn(ticket), period)) counts.cancelled += 1;
  if (ticket.status === "open" || ticket.status === "scheduled") counts.openScheduled += 1;
  if (ticket.status === "in_progress") counts.inProgress += 1;
  if (isOverdue(ticket, today)) counts.overdue += 1;
}

function toRupees<T extends ServiceCounts>(counts: T): T {
  return { ...counts, charges: round2(counts.charges / 100) };
}

/**
 * One row per service engineer (zeros included), one per former engineer and
 * one for Unassigned when they have anything to show, ranked by completed
 * visits then name; and the totals, which every row adds up to.
 */
export function summarizeByEngineer(
  tickets: readonly ServiceTicketFact[],
  engineers: readonly ServiceEngineerRef[],
  period: ServicePeriod,
  today: string,
): { rows: EngineerServiceRow[]; total: ServiceCounts } {
  const who = identities(engineers);
  const rows = new Map<string, EngineerServiceRow>(
    who.engineers.map((id) => [id.key, { ...id, ...emptyCounts() }]),
  );
  const total = emptyCounts();

  for (const ticket of tickets) {
    const id = who.of(ticket);
    let row = rows.get(id.key);
    if (!row) {
      row = { ...id, ...emptyCounts() };
      rows.set(id.key, row);
    }
    countTicket(row, ticket, period, today);
    countTicket(total, ticket, period, today);
  }

  const shown = [...rows.values()].filter((row) => row.kind === "engineer" || hasAny(row));
  return {
    rows: rankRows(shown, (row) => row.completed).map(toRupees),
    total: toRupees(total),
  };
}

// ---------------------------------------------------------------------------
// 12-month trend
// ---------------------------------------------------------------------------

export interface ServiceTrendRow extends RowIdentity {
  /** Completed visits per month, in `months` order. */
  counts: number[];
  total: number;
}

export interface ServiceTrend {
  /** Month keys, oldest first, ending at the selected month. */
  months: string[];
  /** Completed visits per month, everyone together. */
  totals: number[];
  /** Σ totals. */
  total: number;
  /** Every engineer, then anyone else with a visit in the window; ranked like the summary. */
  rows: ServiceTrendRow[];
}

/** Completed visits per month for the `count` months ending at `endMonth`. */
export function completedTrend(
  tickets: readonly ServiceTicketFact[],
  engineers: readonly ServiceEngineerRef[],
  endMonth: string,
  count = TREND_MONTHS,
): ServiceTrend {
  const months = trendMonths(endMonth, count);
  const column = new Map(months.map((m, i) => [m, i]));
  const who = identities(engineers);
  const blank = () => new Array<number>(months.length).fill(0);
  const rows = new Map<string, ServiceTrendRow>(
    who.engineers.map((id) => [id.key, { ...id, counts: blank(), total: 0 }]),
  );
  const totals = blank();

  for (const ticket of tickets) {
    const day = completedOn(ticket);
    const i = day === null ? undefined : column.get(monthKey(day));
    if (i === undefined) continue;
    const id = who.of(ticket);
    let row = rows.get(id.key);
    if (!row) {
      row = { ...id, counts: blank(), total: 0 };
      rows.set(id.key, row);
    }
    row.counts[i] += 1;
    row.total += 1;
    totals[i] += 1;
  }

  const shown = [...rows.values()].filter((row) => row.kind === "engineer" || row.total > 0);
  return {
    months,
    totals,
    total: totals.reduce((a, b) => a + b, 0),
    rows: rankRows(shown, (row) => row.total),
  };
}

// ---------------------------------------------------------------------------
// Completed visits list and CSV
// ---------------------------------------------------------------------------

export interface CompletedService {
  id: string;
  ticketNo: string | null;
  /** The day the visit counts on (see `completedOn`). */
  date: string;
  /** True when the sheet has no service date and `date` is the day it was closed. */
  dateIsClosedDay: boolean;
  clientName: string | null;
  engineer: string;
  engineerKind: ServiceRowKind;
  ticketType: TicketType;
  total: number;
}

/** The visits completed in the period, latest first. */
export function completedServices(
  tickets: readonly ServiceTicketFact[],
  engineers: readonly ServiceEngineerRef[],
  period: ServicePeriod,
): CompletedService[] {
  const who = identities(engineers);
  const list: CompletedService[] = [];
  for (const ticket of tickets) {
    const date = completedOn(ticket);
    if (!date || !inPeriod(date, period)) continue;
    const id = who.of(ticket);
    list.push({
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      date,
      dateIsClosedDay: !isIsoDate(ticket.serviceDate),
      clientName: ticket.clientName,
      engineer: id.name,
      engineerKind: id.kind,
      ticketType: ticket.ticketType,
      total: paise(ticket.total) / 100,
    });
  }
  return list.sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      byName.compare(b.ticketNo ?? "", a.ticketNo ?? "") ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export const SERVICES_CSV_HEADER = [
  "ticket_no",
  "service_date",
  "customer",
  "engineer",
  "type",
  "total",
] as const;

/**
 * The completed list as CSV (no BOM — the download adds it): dates as
 * YYYY-MM-DD, amounts as plain numbers. The customer and engineer names are
 * free text and go through `spreadsheetText`, so a name typed as a formula
 * stays text in Excel.
 */
export function servicesCsv(list: readonly CompletedService[]): string {
  return toCsv([
    [...SERVICES_CSV_HEADER],
    ...list.map((s) => [
      s.ticketNo ?? "",
      s.date,
      spreadsheetText(s.clientName ?? ""),
      spreadsheetText(s.engineer),
      SERVICE_TYPE_LABELS[s.ticketType],
      s.total.toFixed(2),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// The whole page
// ---------------------------------------------------------------------------

export interface ServiceReport {
  period: ServicePeriod;
  /** "November 2026 (so far)", "October 2026", "All time". */
  label: string;
  rows: EngineerServiceRow[];
  total: ServiceCounts;
  /** Null for "All time". */
  trend: ServiceTrend | null;
  /** Every completed visit in the period, latest first. */
  completed: CompletedService[];
  options: PeriodOption[];
}

export function buildServiceReport({
  tickets,
  engineers,
  period,
  today,
}: {
  tickets: readonly ServiceTicketFact[];
  engineers: readonly ServiceEngineerRef[];
  period: ServicePeriod;
  today: string;
}): ServiceReport {
  const { rows, total } = summarizeByEngineer(tickets, engineers, period, today);
  return {
    period,
    label: periodLabel(period, today),
    rows,
    total,
    trend:
      period.kind === "month" ? completedTrend(tickets, engineers, period.month) : null,
    completed: completedServices(tickets, engineers, period),
    options: periodOptions(earliestServiceMonth(tickets), today, period),
  };
}
