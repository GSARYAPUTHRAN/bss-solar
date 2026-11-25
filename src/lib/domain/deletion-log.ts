import { STAGE_LABELS, STAGE_ORDER } from "@/lib/constants";
import { formatCurrencyWhole, formatDate } from "@/lib/format";
import type { ProjectStage } from "@/lib/types";
import { ROLE_LABELS, isUserRole } from "./role";

/**
 * The deletion log (`deleted_records`), as the clean-up page's "Recently
 * deleted" section shows it. Every delete a signed-in person makes is logged by
 * a trigger with a full snapshot of the row; whatever went with it (a sale's
 * project and milestones, ledger entries, who shared it and their incentives)
 * is logged in the same transaction (`tx`). So one transaction is one thing
 * someone deleted, headed by the most important record in it and followed by a
 * count of the rest.
 *
 * There is no restore button: a deleted row can be put back from its snapshot
 * with SQL. Pure: the repository reads the rows.
 */

/**
 * The tables whose deletes are logged, most important first. A sale's
 * coordinators and a project's milestones come last: they are logged only when
 * their sale or project goes too, so they are only ever counted under "also
 * removed", never the headline.
 */
export const DELETED_TABLES = [
  "work_orders",
  "profiles",
  "projects",
  "service_tickets",
  "payments",
  "coordinator_incentives",
  "coordinator_incentive_payments",
  "work_order_coordinators",
  "project_milestones",
] as const;

export type DeletedTable = (typeof DELETED_TABLES)[number];

/** One logged row. */
export interface DeletedRecord {
  id: number;
  /** One of DELETED_TABLES (anything else is shown by its table name). */
  tableName: string;
  /**
   * The row's id; a sale's coordinator's and an incentive's (neither has one)
   * is "<work_order_id>:<coordinator_id>".
   */
  recordId: string;
  /**
   * The row as it was (`to_jsonb(old)`). A project's also lists the service
   * tickets linked to it then (`service_ticket_ids`).
   */
  snapshot: Record<string, unknown>;
  /** Who deleted it, as they were named then; null when unknown. */
  deletedByName: string | null;
  deletedAt: string;
  /** The transaction: a delete and its cascades share one. */
  tx: number;
}

/** What one delete removed. */
export interface DeletionGroup {
  tx: number;
  deletedAt: string;
  deletedByName: string | null;
  /** The table the headline records are from. */
  kind: string;
  /** What was deleted: the labels of the group's most important records. */
  headline: string[];
  /** What went with it, by kind, most important first ("3 ledger entries"). */
  alsoRemoved: { kind: string; count: number; label: string }[];
}

/** People's names by profile id, to name a coordinator in an incentive. */
export type NameLookup = ReadonlyMap<string, string>;

/** What a label can use besides the row itself. */
export interface DeletionContext {
  /** The other rows deleted in the same transaction. */
  group?: readonly DeletedRecord[];
  names?: NameLookup;
}

/** The singular and plural nouns of each kind, for "also removed". */
const NOUNS: Record<DeletedTable, [string, string]> = {
  work_orders: ["sale", "sales"],
  profiles: ["team member", "team members"],
  projects: ["project", "projects"],
  service_tickets: ["service ticket", "service tickets"],
  payments: ["ledger entry", "ledger entries"],
  coordinator_incentives: ["incentive", "incentives"],
  coordinator_incentive_payments: ["incentive payment", "incentive payments"],
  work_order_coordinators: ["coordinator", "coordinators"],
  project_milestones: ["milestone", "milestones"],
};

function isStage(value: string): value is ProjectStage {
  return (STAGE_ORDER as readonly string[]).includes(value);
}

const PURPOSES: Record<string, string> = {
  contract: "contract",
  kseb_fees: "KSEB fee",
  refund: "refund",
  write_off: "write-off",
};

function isDeletedTable(value: string): value is DeletedTable {
  return (DELETED_TABLES as readonly string[]).includes(value);
}

/** Where a kind ranks: lower is more important; unknown tables come last. */
function rank(table: string): number {
  return isDeletedTable(table) ? DELETED_TABLES.indexOf(table) : DELETED_TABLES.length;
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** A snapshot's money: numeric columns arrive as numbers (or strings). */
function moneyOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? formatCurrencyWhole(n) : null;
}

function dateOf(value: unknown): string | null {
  const text = textOf(value);
  return text ? formatDate(text) : null;
}

/** "Head — a, b, c", leaving out the parts that are missing. */
function labelled(head: string, parts: (string | null)[]): string {
  const known = parts.filter((part): part is string => part !== null);
  return known.length > 0 ? `${head} — ${known.join(", ")}` : head;
}

function shortId(value: unknown): string {
  return (textOf(value) ?? "").slice(0, 8);
}

/** The client of the sale `workOrderId`, from a sale deleted alongside. */
function clientOf(workOrderId: unknown, group: readonly DeletedRecord[]): string | null {
  const sale = group.find(
    (row) => row.tableName === "work_orders" && textOf(row.snapshot.id) === textOf(workOrderId),
  );
  return sale ? textOf(sale.snapshot.client_name) : null;
}

/**
 * A deleted record in words, e.g. "Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000".
 * A project's snapshot has no client name: it is taken from its sale when that
 * was deleted in the same transaction (`context.group`). An incentive names its
 * coordinator when `context.names` knows them.
 */
export function describeDeletion(row: DeletedRecord, context: DeletionContext = {}): string {
  const s = row.snapshot ?? {};
  switch (row.tableName) {
    case "work_orders":
      return labelled("Sale", [textOf(s.client_name), dateOf(s.order_date), moneyOf(s.total_cost)]);
    case "projects": {
      const client = clientOf(s.work_order_id, context.group ?? []);
      return client ? `Project — ${client}` : `Project — sale ${shortId(s.work_order_id)}`;
    }
    case "payments": {
      const purpose = PURPOSES[textOf(s.purpose) ?? ""] ?? null;
      const amount = moneyOf(s.amount);
      const what = [amount, purpose].filter(Boolean).join(" ") || null;
      return labelled("Payment", [what, dateOf(s.paid_on)]);
    }
    case "service_tickets":
      return `Ticket ${textOf(s.ticket_no) ?? shortId(s.id ?? row.recordId)}`;
    case "profiles": {
      const role = textOf(s.role);
      const name = textOf(s.full_name) ?? "Unknown";
      const roleLabel = role && isUserRole(role) ? ROLE_LABELS[role] : null;
      return `Team member — ${name}${roleLabel ? ` (${roleLabel})` : ""}`;
    }
    case "coordinator_incentives": {
      const person = context.names?.get(textOf(s.coordinator_id) ?? "") ?? null;
      const amount = moneyOf(s.amount);
      return `Incentive${amount ? ` — ${amount}` : ""}${person ? ` (${person})` : ""}`;
    }
    case "coordinator_incentive_payments":
      return labelled("Incentive payment", [moneyOf(s.amount), dateOf(s.paid_on)]);
    case "work_order_coordinators": {
      const person = context.names?.get(textOf(s.coordinator_id) ?? "") ?? null;
      return labelled("Coordinator", [person]);
    }
    case "project_milestones": {
      const stage = textOf(s.stage);
      return labelled("Milestone", [stage && isStage(stage) ? STAGE_LABELS[stage] : stage]);
    }
    default:
      return `${row.tableName} ${row.recordId}`;
  }
}

function countLabel(kind: string, count: number): string {
  const [one, many] = isDeletedTable(kind) ? NOUNS[kind] : [kind, kind];
  return `${count} ${count === 1 ? one : many}`;
}

function newer(a: DeletedRecord, b: DeletedRecord): boolean {
  const ta = Date.parse(a.deletedAt);
  const tb = Date.parse(b.deletedAt);
  if (ta !== tb) return ta > tb;
  return a.id > b.id;
}

/**
 * The log as one entry per delete (per transaction), newest first. The headline
 * is every record of the most important kind in it (work orders, then team
 * members, projects, service tickets, ledger entries, incentives, incentive
 * payments, a sale's coordinators, milestones), in the order they were deleted;
 * the rest are counted by kind.
 */
export function groupDeletions(
  rows: readonly DeletedRecord[],
  names?: NameLookup,
): DeletionGroup[] {
  const byTx = new Map<number, DeletedRecord[]>();
  for (const row of rows) byTx.set(row.tx, [...(byTx.get(row.tx) ?? []), row]);

  const groups: { latest: DeletedRecord; group: DeletionGroup }[] = [];
  for (const [tx, members] of byTx) {
    const inOrder = [...members].sort((a, b) => a.id - b.id);
    const latest = inOrder.reduce((best, row) => (newer(row, best) ? row : best));
    const kind = inOrder.reduce(
      (best, row) => (rank(row.tableName) < rank(best) ? row.tableName : best),
      inOrder[0].tableName,
    );

    const counts = new Map<string, number>();
    for (const row of inOrder) {
      if (row.tableName !== kind) counts.set(row.tableName, (counts.get(row.tableName) ?? 0) + 1);
    }

    groups.push({
      latest,
      group: {
        tx,
        deletedAt: latest.deletedAt,
        deletedByName: inOrder.find((row) => row.deletedByName)?.deletedByName ?? null,
        kind,
        headline: inOrder
          .filter((row) => row.tableName === kind)
          .map((row) => describeDeletion(row, { group: inOrder, names })),
        alsoRemoved: [...counts]
          .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
          .map(([other, count]) => ({ kind: other, count, label: countLabel(other, count) })),
      },
    });
  }

  return groups
    .sort((a, b) => (newer(a.latest, b.latest) ? -1 : newer(b.latest, a.latest) ? 1 : 0))
    .map(({ group }) => group);
}
