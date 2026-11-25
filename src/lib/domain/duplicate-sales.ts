import { STAGE_ORDER } from "@/lib/constants";
import { fail, ok, type ActionResult } from "@/lib/result";
import type {
  PlanType,
  ProjectCancellation,
  ProjectStage,
  WorkOrderStatus,
} from "@/lib/types";
import { sameCustomer, sameCustomerGroups } from "./import-duplicates";
import { isUuid } from "./notification-input";

/**
 * Duplicate sales already in the system, for the clean-up page
 * (/work-orders/duplicates). Two sales are copies of one when they have
 * (a) the same KSEB consumer number (a real one: "NA", "Nil" or "0" is no
 *     number, see `normaliseConsumerNumber`), or
 * (b) the same customer — names compared loosely, as the import does
 *     (`sameCustomerGroups`: spelling of spaces, word order, initials, case) —
 *     on the same order date, unless both have consumer numbers and they
 *     differ: one customer with two connections on one day is two sales.
 * Both relations are transitive (A–B by consumer number and B–C by name and
 * date make one group of three).
 *
 * In each group one copy is suggested as the one to keep (`suggestKeeper`): a
 * live one before a cancelled or refunded one, then the one with the most
 * recorded work. The other copies are selected for deletion by default only
 * when they are plainly the same sale as the keeper — the same customer, and no
 * other consumer number (`defaultSelection`); the rest are left for the office
 * to decide. Nothing here deletes: the page asks, the server action deletes.
 *
 * Pure: the repository reads every sale (every status, rejected included).
 */

/** A sale as the clean-up page compares and shows it. */
export interface CleanupSale {
  id: string;
  clientName: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  /** When the work order was written (ISO timestamp; "" when unknown). */
  createdAt: string;
  consumerNumber: string | null;
  status: WorkOrderStatus;
  /** The project's state once it left the pipeline; null while live or before approval. */
  cancellation: ProjectCancellation | null;
  coordinatorNames: string[];
  totalCost: number;
  amountReceived: number;
  /**
   * Every ledger entry on the sale — contract payments, KSEB fees, refunds and
   * write-offs alike: all of them go with it when it is deleted.
   */
  paymentCount: number;
  projectId: string | null;
  currentStage: ProjectStage | null;
  isCompleted: boolean;
  /** Service tickets on the sale's project. */
  ticketCount: number;
  planType: PlanType;
}

/** Why the copies are one group. */
export type DuplicateReason = "consumer_number" | "customer_and_date";

/** A value a copy has that the kept copy does not. */
export type DifferenceField =
  | "totalCost"
  | "coordinators"
  | "amountReceived"
  | "status"
  | "plan"
  | "orderDate"
  | "clientName"
  /** Both have a consumer number and they are not the same: another connection. */
  | "consumerNumber";

export interface DuplicateGroup {
  /** Stable across reloads: the copies' ids, sorted and joined. */
  key: string;
  /** In this order: consumer number first. */
  reasons: DuplicateReason[];
  /** The suggested keeper first, then the oldest written first. */
  sales: CleanupSale[];
  keeperId: string;
  /**
   * For every copy but the keeper: the values that differ from the keeper's
   * (empty when none do).
   */
  differences: Record<string, DifferenceField[]>;
}

/** What deleting a selection takes with it, for the confirm dialog. */
export interface DeletionSummary {
  sales: number;
  projects: number;
  ledgerEntries: number;
  /** Service tickets that stay but lose their project link. */
  tickets: number;
  /** Keys of the groups whose every copy is selected: nothing of that sale is left. */
  wholeGroups: string[];
}

const REASON_ORDER: readonly DuplicateReason[] = ["consumer_number", "customer_and_date"];

/**
 * A consumer number as it is compared: whitespace, "-", "/" and "." removed,
 * lower-cased — "1156 30-4/012.5" is "1156304012 5" typed differently. `null`
 * unless what is left has a digit other than 0: "NA", "N/A", "Nil", "Applied",
 * "0" and "000" are what a sheet says when there is no number yet, and such a
 * placeholder must not make unrelated customers look like one sale.
 */
export function normaliseConsumerNumber(value: string | null | undefined): string | null {
  const key = (value ?? "").replace(/[\s/.-]+/g, "").toLowerCase();
  return /[1-9]/.test(key) ? key : null;
}

/** Both sales have a consumer number and they differ: two connections, so two sales. */
function otherConnection(a: CleanupSale, b: CleanupSale): boolean {
  const na = normaliseConsumerNumber(a.consumerNumber);
  const nb = normaliseConsumerNumber(b.consumerNumber);
  return na !== null && nb !== null && na !== nb;
}

// --- The keeper ------------------------------------------------------------------

const STATUS_RANK: Record<WorkOrderStatus, number> = { approved: 2, pending: 1, rejected: 0 };

/** How far the project got; no project (or no stage) is lowest. */
function stageProgress(sale: CleanupSale): number {
  return sale.currentStage === null ? -1 : STAGE_ORDER.indexOf(sale.currentStage);
}

/** An instant's time for comparing; an unknown one is the oldest. */
function timeOf(instant: string): number {
  const t = Date.parse(instant);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * The keys a copy is ranked by, most important first; higher keeps. Money and
 * recorded work come before the stage: a ledger entry is the only record of
 * money that changed hands.
 */
function keeperKeys(sale: CleanupSale): number[] {
  return [
    sale.cancellation === null ? 1 : 0, // a live copy before a cancelled or refunded one
    sale.paymentCount + sale.ticketCount,
    sale.amountReceived,
    sale.isCompleted ? 1 : 0,
    stageProgress(sale),
    STATUS_RANK[sale.status] ?? -1,
    timeOf(sale.createdAt),
  ];
}

/** Negative when `a` is the better copy to keep. */
function keeperOrder(a: CleanupSale, b: CleanupSale): number {
  const ka = keeperKeys(a);
  const kb = keeperKeys(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] > kb[i] ? -1 : 1;
  }
  // A total order: the same group suggests the same keeper whatever the input order.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The copy to keep, compared in turn by: live (not cancelled or refunded),
 * ledger entries + service tickets, money received, commissioned, how far the
 * project got, status (approved, pending, rejected), the newest written, and
 * the id. `null` for no copies.
 */
export function suggestKeeper(sales: readonly CleanupSale[]): CleanupSale | null {
  if (sales.length === 0) return null;
  return [...sales].sort(keeperOrder)[0];
}

// --- Grouping --------------------------------------------------------------------

/** Oldest written first, then by id. */
function byAge(a: CleanupSale, b: CleanupSale): number {
  const ta = timeOf(a.createdAt);
  const tb = timeOf(b.createdAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** What the status column shows: a cancelled or refunded project says so. */
function statusShown(sale: CleanupSale): string {
  return sale.cancellation ?? sale.status;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function differencesFrom(keeper: CleanupSale, copy: CleanupSale): DifferenceField[] {
  const fields: DifferenceField[] = [];
  if (copy.totalCost !== keeper.totalCost) fields.push("totalCost");
  if (!sameList(copy.coordinatorNames, keeper.coordinatorNames)) fields.push("coordinators");
  if (copy.amountReceived !== keeper.amountReceived) fields.push("amountReceived");
  if (statusShown(copy) !== statusShown(keeper)) fields.push("status");
  if (copy.planType !== keeper.planType) fields.push("plan");
  if (copy.orderDate !== keeper.orderDate) fields.push("orderDate");
  if (copy.clientName.trim() !== keeper.clientName.trim()) fields.push("clientName");
  if (otherConnection(copy, keeper)) fields.push("consumerNumber");
  return fields;
}

/** The newest order date in the group. */
function newestOrderDate(group: DuplicateGroup): string {
  return group.sales.reduce((max, s) => (s.orderDate > max ? s.orderDate : max), "");
}

/**
 * The groups of two or more sales that look like one sale, newest order date
 * first (then by the kept copy's name). A sale is in at most one group.
 */
export function findDuplicateGroups(sales: readonly CleanupSale[]): DuplicateGroup[] {
  // One entry per id (a read that shifted between pages can repeat a row).
  const items = [...new Map(sales.map((s) => [s.id, s] as const)).values()];

  const index = new Map(items.map((s, i) => [s.id, i]));
  const parent = items.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const links: [number, number, DuplicateReason][] = [];
  const link = (a: number, b: number, reason: DuplicateReason) => {
    links.push([a, b, reason]);
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // (a) The same consumer number.
  const firstWithNumber = new Map<string, number>();
  items.forEach((sale, i) => {
    const key = normaliseConsumerNumber(sale.consumerNumber);
    if (key === null) return;
    const first = firstWithNumber.get(key);
    if (first === undefined) firstWithNumber.set(key, i);
    else link(first, i, "consumer_number");
  });

  // (b) The same customer on the same order date — pair by pair, never two
  // sales with different consumer numbers (two connections are two sales).
  const byDate = new Map<string, CleanupSale[]>();
  for (const sale of items) {
    if (!sale.orderDate) continue;
    byDate.set(sale.orderDate, [...(byDate.get(sale.orderDate) ?? []), sale]);
  }
  for (const bucket of byDate.values()) {
    if (bucket.length < 2) continue;
    for (const customer of sameCustomerGroups(bucket, (s) => s.clientName)) {
      for (let i = 0; i < customer.length; i++) {
        for (let j = i + 1; j < customer.length; j++) {
          if (otherConnection(customer[i], customer[j])) continue;
          link(index.get(customer[i].id)!, index.get(customer[j].id)!, "customer_and_date");
        }
      }
    }
  }

  const members = new Map<number, CleanupSale[]>();
  items.forEach((sale, i) => {
    const r = root(i);
    members.set(r, [...(members.get(r) ?? []), sale]);
  });
  const reasonsOf = new Map<number, Set<DuplicateReason>>();
  for (const [a, , reason] of links) {
    const r = root(a);
    reasonsOf.set(r, (reasonsOf.get(r) ?? new Set()).add(reason));
  }

  const groups: DuplicateGroup[] = [];
  for (const [r, copies] of members) {
    if (copies.length < 2) continue;
    const keeper = suggestKeeper(copies)!;
    const rest = copies.filter((s) => s.id !== keeper.id).sort(byAge);
    const reasons = reasonsOf.get(r) ?? new Set();
    groups.push({
      key: copies
        .map((s) => s.id)
        .sort()
        .join(","),
      reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
      sales: [keeper, ...rest],
      keeperId: keeper.id,
      differences: Object.fromEntries(rest.map((s) => [s.id, differencesFrom(keeper, s)])),
    });
  }

  return groups.sort((a, b) => {
    const da = newestOrderDate(a);
    const db = newestOrderDate(b);
    if (da !== db) return da > db ? -1 : 1;
    const byName = a.sales[0].clientName.localeCompare(b.sales[0].clientName);
    if (byName !== 0) return byName;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// --- Selection -------------------------------------------------------------------

/**
 * The copies ticked for deletion when the page opens, in the order it lists
 * them: every copy but the suggested keeper that is plainly the same sale as
 * it — the same customer (`sameCustomer`) and no other consumer number. A group
 * can join sales that are not one (A–B by name and date, B–C by consumer
 * number, C another customer on that connection), and the warning that every
 * copy of a sale is selected only looks at whole groups — so a copy that may be
 * another sale is left unticked for the office to decide.
 */
export function defaultSelection(groups: readonly DuplicateGroup[]): string[] {
  return groups.flatMap((group) => {
    const keeper = group.sales.find((s) => s.id === group.keeperId);
    if (!keeper) return [];
    return group.sales
      .filter(
        (s) =>
          s.id !== keeper.id &&
          sameCustomer(keeper.clientName, s.clientName) &&
          !otherConnection(keeper, s),
      )
      .map((s) => s.id);
  });
}

/**
 * What deleting the `selected` copies takes with it: their projects (with
 * milestones and incentives) and ledger entries; their service tickets stay
 * without a project. `wholeGroups` names the groups where no copy would be left.
 * Ids that are in no group are ignored.
 */
export function deletionSummary(
  groups: readonly DuplicateGroup[],
  selected: Iterable<string>,
): DeletionSummary {
  const chosen = new Set(selected);
  const summary: DeletionSummary = {
    sales: 0,
    projects: 0,
    ledgerEntries: 0,
    tickets: 0,
    wholeGroups: [],
  };
  for (const group of groups) {
    const picked = group.sales.filter((s) => chosen.has(s.id));
    for (const sale of picked) {
      summary.sales += 1;
      if (sale.projectId) summary.projects += 1;
      summary.ledgerEntries += sale.paymentCount;
      summary.tickets += sale.ticketCount;
    }
    if (picked.length > 0 && picked.length === group.sales.length) {
      summary.wholeGroups.push(group.key);
    }
  }
  return summary;
}

// --- Deleting --------------------------------------------------------------------

/** Most sales one bulk delete may remove; `delete_work_orders` refuses more. */
export const MAX_BULK_DELETE = 500;

/**
 * The sales a bulk delete was asked for: 1 to MAX_BULK_DELETE work-order ids,
 * repeats dropped. Anything else is refused — a server action's arguments are
 * untrusted whatever its TypeScript signature says.
 */
export function parseSaleIds(input: unknown): ActionResult<string[]> {
  if (!Array.isArray(input)) return fail("Choose the sales to delete.");
  if (!input.every(isUuid)) {
    return fail("That selection is not valid — reload the page and try again.");
  }
  const ids = [...new Set(input.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return fail("Choose at least one sale to delete.");
  if (ids.length > MAX_BULK_DELETE) {
    return fail(`At most ${MAX_BULK_DELETE} sales can be deleted at once — select fewer.`);
  }
  return ok(ids);
}

/** Most ids the copies-to-keep check takes, across all its groups. */
export const MAX_KEEP_IDS = 5000;

/**
 * The copies a bulk delete means to keep: for each group with a copy selected,
 * its copies that are not (at least one each). The server refuses the delete
 * when a group has none of them left — the page was out of date, and deleting
 * would leave nothing of that sale. A list of non-empty lists of work-order ids,
 * at most MAX_KEEP_IDS in all; anything else is refused, like `parseSaleIds`.
 */
export function parseKeepGroups(input: unknown): ActionResult<string[][]> {
  const invalid = fail("That selection is not valid — reload the page and try again.");
  if (!Array.isArray(input)) return invalid;
  let total = 0;
  const groups: string[][] = [];
  for (const group of input) {
    if (!Array.isArray(group) || group.length === 0 || !group.every(isUuid)) return invalid;
    total += group.length;
    if (total > MAX_KEEP_IDS) return invalid;
    groups.push([...new Set(group.map((id) => id.toLowerCase()))]);
  }
  return ok(groups);
}

/** A bulk delete refused because a copy meant to be kept is already gone. */
export const STALE_SELECTION =
  "This page is out of date: a copy you meant to keep has already been deleted. Refresh the page and check the selection again.";

/**
 * The groups (from `parseKeepGroups`) that would have nothing left: none of
 * their copies still `existing`, or every one that is about to be `deleted` as
 * well. Empty when the delete may go ahead.
 */
export function groupsLeftEmpty(
  keep: readonly (readonly string[])[],
  existing: Iterable<string>,
  deleted: Iterable<string>,
): string[][] {
  const doomed = new Set(deleted);
  const left = new Set([...existing].filter((id) => !doomed.has(id)));
  return keep.filter((group) => !group.some((id) => left.has(id))).map((group) => [...group]);
}
