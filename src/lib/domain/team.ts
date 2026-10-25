import type { UserRole } from "@/lib/types";
import { isOfficeRole, isServiceEngineerRole } from "./role";

/**
 * Rules for changing who someone is on the team. Each returns the message to
 * show when the change must be refused, or `null` when it may go ahead. They
 * exist so a role change or deletion can never strand work:
 *   - a sale is shared by its coordinators (`work_order_coordinators`, which
 *     references the member `on delete restrict`) and may only be owned or
 *     shared by a coordinator or the office — so a member of a shared sale
 *     counts as owning work exactly like the coordinator who logged it;
 *   - service tickets reference their engineer `on delete set null` and may
 *     only be held by a service engineer — so without these checks deleting or
 *     re-roling an engineer would silently orphan their open tickets.
 */

/** Business that is still attached to a team member. */
export interface OwnedWork {
  /** Work orders they logged or share (membership, not just `coordinator_id`). */
  workOrders: number;
  /** Projects of the sales they share. */
  projects: number;
  /** Tickets assigned to them that are still open, scheduled or in progress. */
  activeTickets: number;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function salesWork(owned: OwnedWork): string | null {
  const parts = [
    owned.workOrders > 0 && count(owned.workOrders, "work order"),
    owned.projects > 0 && count(owned.projects, "project"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" and ") : null;
}

function openTickets(owned: OwnedWork): string {
  return count(owned.activeTickets, "open service ticket");
}

/** Why `name` cannot be deleted yet, or `null`. */
export function deletionBlocker(name: string, owned: OwnedWork): string | null {
  const sales = salesWork(owned);
  if (sales) {
    return `${name} still owns or shares ${sales}. Take them off those sales (Change coordinators on each work order) or delete that business first.`;
  }
  if (owned.activeTickets > 0) {
    return `${name} still has ${openTickets(owned)}. Reassign them to another engineer first.`;
  }
  return null;
}

/**
 * Why `name` cannot move from `from` to `to`, or `null`. The caller has already
 * ruled out self-changes and the immutable Super Admin seat.
 */
export function roleChangeBlocker(change: {
  name: string;
  from: UserRole;
  to: UserRole;
  /** Accounts holding office rights (admin + Super Admin), including `name`. */
  adminCount: number;
  owned: OwnedWork;
}): string | null {
  const { name, from, to, adminCount, owned } = change;
  if (from === to) return null;

  if (isOfficeRole(from) && !isOfficeRole(to) && adminCount <= 1) {
    return "At least one administrator is required.";
  }

  const sales = salesWork(owned);
  if (isServiceEngineerRole(to) && sales) {
    return `${name} owns or shares ${sales}. Service engineers cannot own sales work — take them off those sales first.`;
  }

  if (isServiceEngineerRole(from) && owned.activeTickets > 0) {
    return `${name} still has ${openTickets(owned)}. Only service engineers can hold tickets — reassign them first.`;
  }

  return null;
}
