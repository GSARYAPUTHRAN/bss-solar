import { fail, ok, type ActionResult } from "@/lib/result";
import type { UserRole, WorkOrderStatus } from "@/lib/types";
import type { NotificationEvent } from "./notifications";
import { WORK_ORDER_OWNER_ROLES, isOfficeRole } from "./role";

/**
 * Who shares a sale.
 *
 * A work order can be shared by up to `MAX_SALE_COORDINATORS` coordinators
 * (`work_order_coordinators`, the only list there is; a project's coordinators
 * are its work order's). The first is the one who logged it and is mirrored to
 * `work_orders.coordinator_id`. Everyone listed sees and edits the sale and
 * hears about it; each person's incentive stays private to them and the office.
 *
 * Who may change the list:
 *   - the office: any list, any time (add, remove, reorder);
 *   - the FIRST coordinator, while the work order is pending: add partners only,
 *     and only other coordinators (see `mayAddToSale`);
 *   - nobody else.
 * `set_work_order_coordinators()` enforces this in the database
 * (migration 20261022120000); `planCoordinatorChange` mirrors it so the person
 * gets a plain message before the round trip. The wording is shared.
 */

/**
 * Most people who can share one sale (a typo guard). Mirrors
 * `max_sale_coordinators()` in migration 20261022120000; coordinators.test.ts
 * reads the migration and fails when the two drift. Change both together.
 */
export const MAX_SALE_COORDINATORS = 5;

/** The refusals, worded for the people who see them (shared with the RPC). */
export const COORDINATOR_ERRORS = {
  addPartnersOnly:
    "Only the office or the coordinator who logged this work order can add partners.",
  officeAfterReview:
    "Only the office can change who shares an approved or rejected work order.",
  officeRemoves: "Only the office can take a coordinator off a work order.",
  atLeastOne: "A work order needs at least one coordinator.",
  tooMany: `A sale can have at most ${MAX_SALE_COORDINATORS} coordinators.`,
  notEligible: "Only coordinator or office accounts can share a sale.",
  officeAccount: "Only the office can add an office account to a sale.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ids as a form posts them (`coordinator_ids`, one per row, in order): trimmed,
 * lower-cased, anything that is not a UUID dropped, duplicates removed with the
 * first occurrence kept — so the order the person arranged survives.
 */
export function normalizeCoordinatorIds(
  ids: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw?.trim().toLowerCase();
    if (id && UUID.test(id)) seen.add(id);
  }
  return [...seen];
}

/** Trim, drop blanks, keep the first of each id. Order is the sale's order. */
function distinct(ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw?.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

/** "—", "Ravi", "Ravi & Abhijith", "Ravi, Abhijith & Manohar". */
export function coordinatorsLabel(names: readonly string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length === 0) return "—";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`;
}

/**
 * Whether `userId` is one of the sale's coordinators. Reads either a loaded
 * sale (`coordinators`) or a list row (`coordinator_ids`).
 */
export function isSaleCoordinator(
  sale:
    | { coordinators: readonly { id: string }[] }
    | { coordinator_ids: readonly string[] | null },
  userId: string,
): boolean {
  if ("coordinators" in sale) return sale.coordinators.some((c) => c.id === userId);
  return sale.coordinator_ids?.includes(userId) ?? false;
}

export type TeamAuthority = "office" | "add_partners" | "none";

/**
 * What `viewer` may do to a sale's coordinator list: anything (`office`), add
 * partners (the coordinator who logged a still-pending work order), or nothing.
 * `coordinatorIds` is in sale order — the first is the one who logged it.
 */
export function teamAuthority(
  viewer: { id: string; role: UserRole },
  sale: { status: WorkOrderStatus; coordinatorIds: readonly string[] },
): TeamAuthority {
  if (isOfficeRole(viewer.role)) return "office";
  if (
    viewer.role === "coordinator" &&
    sale.status === "pending" &&
    sale.coordinatorIds[0] === viewer.id
  ) {
    return "add_partners";
  }
  return "none";
}

/** An account `coordinator_directory()` lists: one that can own or share a sale. */
export interface DirectoryAccount {
  id: string;
  role: UserRole;
}

/**
 * Whether `adder` may put `account` on a sale. The office: anyone who can share
 * one. A coordinator: only another coordinator. A partner is not asked, and
 * sharing a sale opens their profile (name, role, phone) to everyone on it, so
 * the office's accounts (admin, SuperAdmin) are the office's to add.
 * `set_work_order_coordinators()` makes the same call. Also what the partner
 * picker offers: it lists only people the viewer may add.
 */
export function mayAddToSale(adder: { role: UserRole }, account: { role: UserRole }): boolean {
  return isOfficeRole(adder.role) || account.role === "coordinator";
}

/**
 * Why `actor` cannot put `newcomers` (people not already on the sale; existing
 * members are never re-checked) on it, or null. Decided in the database's order:
 * every one must be an account that can share a sale (in the directory, or the
 * signed-in owner themself), then a non-office actor may add only coordinators.
 */
function addRefusal(
  actor: { id: string; role: UserRole },
  directory: readonly DirectoryAccount[],
  newcomers: readonly string[],
): string | null {
  const roles = new Map(directory.map((account) => [account.id, account.role]));
  const roleOf = (id: string): UserRole | undefined =>
    roles.get(id) ??
    (id === actor.id && WORK_ORDER_OWNER_ROLES.includes(actor.role) ? actor.role : undefined);

  const known = newcomers.map((id) => roleOf(id));
  if (known.some((role) => role === undefined)) return COORDINATOR_ERRORS.notEligible;
  if (known.some((role) => !mayAddToSale(actor, { role: role as UserRole }))) {
    return COORDINATOR_ERRORS.officeAccount;
  }
  return null;
}

/**
 * The team a NEW sale starts with. A coordinator is always first, then the
 * partners they named; the office gets what it asked for (the first is the one
 * who "logged" it) or, asking for no one, itself. Every member must be an
 * account that can own a sale (`directory`, from `coordinator_directory()`), at
 * most `MAX_SALE_COORDINATORS`; a coordinator's partners must be coordinators.
 */
export function planNewSaleTeam(input: {
  actor: { id: string; role: UserRole };
  requested: readonly string[];
  directory: readonly DirectoryAccount[];
}): ActionResult<string[]> {
  const { actor, directory } = input;
  const asked = distinct(input.requested);
  const team = isOfficeRole(actor.role)
    ? asked.length > 0
      ? asked
      : [actor.id]
    : [actor.id, ...asked.filter((id) => id !== actor.id)];

  if (team.length > MAX_SALE_COORDINATORS) return fail(COORDINATOR_ERRORS.tooMany);
  const refusal = addRefusal(actor, directory, team);
  if (refusal) return fail(refusal);
  return ok(team);
}

/** Who joined and who left, each in the order they appear (added: `after`, removed: `before`). */
export function diffCoordinators(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: [...new Set(after.filter((id) => !was.has(id)))],
    removed: [...new Set(before.filter((id) => !now.has(id)))],
  };
}

/**
 * The outcome of asking to change a sale's coordinators, decided exactly as
 * `set_work_order_coordinators()` will (so the refusals read the same):
 *   - the office: `requested` is the new list, in order;
 *   - the coordinator who logged a pending work order: partners are appended,
 *     the existing members and their order are kept; asking to drop anyone is
 *     refused;
 *   - everyone else: refused.
 * `before` is in sale order. New members must be in `directory`, and a
 * coordinator may add only coordinators. Taking a person off while they still
 * have an incentive is refused by the database, which alone knows the
 * incentives.
 */
export function planCoordinatorChange(input: {
  viewer: { id: string; role: UserRole };
  status: WorkOrderStatus;
  before: readonly string[];
  requested: readonly string[];
  directory: readonly DirectoryAccount[];
}): ActionResult<{ after: string[]; added: string[]; removed: string[] }> {
  const { viewer, status, directory } = input;
  const before = distinct(input.before);
  let after = distinct(input.requested);

  if (!isOfficeRole(viewer.role)) {
    if (before[0] !== viewer.id || viewer.role !== "coordinator") {
      return fail(COORDINATOR_ERRORS.addPartnersOnly);
    }
    if (status !== "pending") return fail(COORDINATOR_ERRORS.officeAfterReview);
    if (!before.every((id) => after.includes(id))) {
      return fail(COORDINATOR_ERRORS.officeRemoves);
    }
    after = [...before, ...after.filter((id) => !before.includes(id))];
  }

  if (after.length === 0) return fail(COORDINATOR_ERRORS.atLeastOne);
  if (after.length > MAX_SALE_COORDINATORS) return fail(COORDINATOR_ERRORS.tooMany);
  const refusal = addRefusal(
    viewer,
    directory,
    after.filter((id) => !before.includes(id)),
  );
  if (refusal) return fail(refusal);

  return ok({ after, ...diffCoordinators(before, after) });
}

/** "Coordinators updated — Abhijith Nair added, Manohar removed." (names, not ids). */
export function describeCoordinatorChange(
  added: readonly string[],
  removed: readonly string[],
): string {
  const parts = [
    added.length > 0 ? `${coordinatorsLabel(added)} added` : null,
    removed.length > 0 ? `${coordinatorsLabel(removed)} removed` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0
    ? `Coordinators updated — ${parts.join(", ")}.`
    : "Coordinators unchanged.";
}

/**
 * What a change of coordinators announces: the people added hear it (and the
 * office too, when a coordinator brought partners onto an existing sale), the
 * people removed hear it. Nobody else — the rest of the team sees the change on
 * the sale itself. `atCreate`: the sale was just logged with its partners; the
 * office already heard (`work_order.submitted` names them), so it is not told
 * twice. `team` is the sale after the change, in order.
 */
export function coordinatorChangeEvents(input: {
  actor: { id: string; full_name: string; role: UserRole };
  workOrderId: string;
  projectId: string | null;
  clientName: string;
  capacity: string;
  team: readonly { id: string; full_name: string }[];
  added: readonly string[];
  removed: readonly string[];
  atCreate: boolean;
}): NotificationEvent[] {
  const { actor, added, removed } = input;
  const events: NotificationEvent[] = [];
  if (added.length > 0) {
    events.push({
      type: "work_order.coordinator_added",
      actorId: actor.id,
      actorName: actor.full_name,
      addedIds: added,
      notifyOffice: !isOfficeRole(actor.role) && !input.atCreate,
      workOrderId: input.workOrderId,
      projectId: input.projectId,
      clientName: input.clientName,
      capacity: input.capacity,
      teamNames: input.team.map((member) => member.full_name),
    });
  }
  if (removed.length > 0) {
    events.push({
      type: "work_order.coordinator_removed",
      actorId: actor.id,
      actorName: actor.full_name,
      removedIds: removed,
      clientName: input.clientName,
    });
  }
  return events;
}
