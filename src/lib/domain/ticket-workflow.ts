import type { TicketStatus, UserRole } from "@/lib/types";
import type { NotificationEvent, TicketUpdateReason } from "./notifications";
import { diffDays, isIsoDate } from "./dates";
import { isOfficeRole, isServiceEngineerRole } from "./role";
import { TICKET_STATUS } from "./status";

/**
 * How a service ticket moves, and who may move it.
 *
 *   open ──► scheduled ──► in_progress ──► completed
 *     └──────────┴──────────────┴─────────► cancelled   (office only)
 *
 * Service engineers work only the forward path: they start work and mark it
 * done. The office keeps full control (any status, via the service sheet).
 * The database enforces the same boundary for engineers (guard_service_ticket),
 * so these rules decide what the UI offers and the action accepts — the
 * trigger is the backstop.
 */

/** Statuses that still need an engineer's attention. */
export const ACTIVE_TICKET_STATUSES = [
  "open",
  "scheduled",
  "in_progress",
] as const satisfies readonly TicketStatus[];

export function isActiveTicket(status: TicketStatus): boolean {
  return (ACTIVE_TICKET_STATUSES as readonly TicketStatus[]).includes(status);
}

/** Type guard for values arriving from a form/URL. */
export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && Object.hasOwn(TICKET_STATUS, value);
}

/** A status change a service engineer can make from the field. */
export interface EngineerAction {
  to: "in_progress" | "completed";
  label: string;
  /** Closing a ticket is final for the engineer, so it is confirmed first. */
  confirm: boolean;
}

/** The statuses a field move can land on (what `ticket.status_changed` announces). */
export function isFieldMove(status: TicketStatus): status is EngineerAction["to"] {
  return status === "in_progress" || status === "completed";
}

const START_WORK: EngineerAction = {
  to: "in_progress",
  label: "Start work",
  confirm: false,
};
const MARK_COMPLETED: EngineerAction = {
  to: "completed",
  label: "Mark completed",
  confirm: true,
};

/** The buttons an engineer sees for a ticket in `status`, in display order. */
export function engineerActions(status: TicketStatus): EngineerAction[] {
  switch (status) {
    case "open":
    case "scheduled":
      return [START_WORK, MARK_COMPLETED];
    case "in_progress":
      return [MARK_COMPLETED];
    case "completed":
    case "cancelled":
      return [];
  }
}

/**
 * Why `role` may not move a ticket from `from` to `to`, or `null` when the
 * change is allowed. Messages are shown to the user as-is.
 */
export function statusChangeError(
  role: UserRole,
  from: TicketStatus,
  to: TicketStatus,
): string | null {
  if (from === to) return "The ticket already has that status.";
  if (isOfficeRole(role)) return null;
  if (!isServiceEngineerRole(role)) {
    return "Only service engineers and the office can update tickets.";
  }
  if (engineerActions(from).some((action) => action.to === to)) return null;
  return isActiveTicket(from)
    ? "You can only start work on a ticket or mark it completed."
    : "This ticket is closed. Ask the office if it needs to be reopened.";
}

/** Office list filter value (`?engineer=`) for tickets nobody holds. */
export const UNASSIGNED_ENGINEER_FILTER = "unassigned";

/** A new ticket with a visit date is already scheduled. */
export function initialTicketStatus(scheduledDate: string | null): TicketStatus {
  return scheduledDate ? "scheduled" : "open";
}

/** Every ticket that still needs work must have an engineer on it. */
export function requiresAssignee(status: TicketStatus): boolean {
  return isActiveTicket(status);
}

export type ScheduleState = "overdue" | "today" | "upcoming";

/**
 * Where an active ticket's visit sits relative to `today` (IST, YYYY-MM-DD).
 * `null` when there is nothing to flag: no date, or the ticket is closed.
 */
export function scheduleState(
  status: TicketStatus,
  scheduledDate: string | null,
  today: string,
): { state: ScheduleState; days: number } | null {
  if (!isActiveTicket(status) || !isIsoDate(scheduledDate) || !isIsoDate(today)) {
    return null;
  }
  const days = diffDays(today, scheduledDate);
  if (days < 0) return { state: "overdue", days: -days };
  if (days === 0) return { state: "today", days: 0 };
  return { state: "upcoming", days };
}

/** A ticket's assignee as it stands after a change, and who held it before. */
export interface TicketAssignment {
  actorId: string;
  ticketId: string;
  ticketNo: string | null;
  clientName: string | null;
  scheduledDate: string | null;
  status: TicketStatus;
  previousEngineerId: string | null;
  engineerId: string | null;
}

/** An office edit of an existing ticket: the assignment plus where it stood before. */
export interface TicketUpdate extends TicketAssignment {
  previousStatus: TicketStatus;
  previousScheduledDate: string | null;
}

/**
 * The ticket.assigned / ticket.unassigned notifications an assignment change
 * warrants. Only active tickets notify: re-pointing a closed ticket is record
 * keeping, not new work for anyone.
 */
export function assignmentEvents(change: TicketAssignment): NotificationEvent[] {
  if (change.previousEngineerId === change.engineerId) return [];
  if (!isActiveTicket(change.status)) return [];

  const events: NotificationEvent[] = [];
  if (change.previousEngineerId) {
    events.push({
      type: "ticket.unassigned",
      actorId: change.actorId,
      engineerId: change.previousEngineerId,
      ticketId: change.ticketId,
      ticketNo: change.ticketNo,
    });
  }
  if (change.engineerId) {
    events.push({
      type: "ticket.assigned",
      actorId: change.actorId,
      engineerId: change.engineerId,
      ticketId: change.ticketId,
      ticketNo: change.ticketNo,
      clientName: change.clientName,
      scheduledDate: change.scheduledDate,
    });
  }
  return events;
}

/**
 * What an office edit changed that the engineer holding the ticket acts on, or
 * null when nothing did. Edits of a ticket that stays closed are record keeping.
 */
function ticketUpdateReason(update: TicketUpdate): TicketUpdateReason | null {
  const wasActive = isActiveTicket(update.previousStatus);
  const isActive = isActiveTicket(update.status);
  if (!wasActive && !isActive) return null;
  if (update.status === "cancelled") return "cancelled";
  if (!wasActive) return "reopened";
  if (isActive && update.scheduledDate !== update.previousScheduledDate) {
    return "rescheduled";
  }
  return update.status !== update.previousStatus ? "status_changed" : null;
}

/**
 * Everything an office edit of a ticket tells its engineers. An open ticket
 * that changed hands is announced by assignmentEvents. Otherwise the engineer
 * who held it hears (`ticket.updated`) when the office moved the visit,
 * cancelled, reopened or otherwise changed the status — even when the same
 * edit closed the ticket and took it off their list.
 */
export function ticketUpdateEvents(update: TicketUpdate): NotificationEvent[] {
  const holder = update.previousEngineerId;
  const stillAssigned = holder === update.engineerId;
  if (!stillAssigned && isActiveTicket(update.status)) return assignmentEvents(update);

  const reason = ticketUpdateReason(update);
  if (!holder || !reason) return [];
  return [
    {
      type: "ticket.updated",
      actorId: update.actorId,
      engineerId: holder,
      ticketId: update.ticketId,
      ticketNo: update.ticketNo,
      clientName: update.clientName,
      reason,
      status: update.status,
      scheduledDate: update.scheduledDate,
      stillAssigned,
    },
  ];
}

/**
 * The engineer's worklist tabs. Each scope picks its statuses and the order
 * that makes sense for it: soonest visit first while work is pending, most
 * recent first once it is done.
 */
export const ENGINEER_TICKET_SCOPES = {
  active: {
    label: "Active",
    statuses: ACTIVE_TICKET_STATUSES,
    sort: "scheduled_date",
    dir: "asc",
  },
  completed: {
    label: "Completed",
    statuses: ["completed"],
    sort: "service_date",
    dir: "desc",
  },
  all: {
    label: "All",
    statuses: null,
    sort: "created_at",
    dir: "desc",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    statuses: readonly TicketStatus[] | null;
    sort: string;
    dir: "asc" | "desc";
  }
>;

export type EngineerTicketScope = keyof typeof ENGINEER_TICKET_SCOPES;

export const DEFAULT_ENGINEER_SCOPE: EngineerTicketScope = "active";

export function parseEngineerScope(value: unknown): EngineerTicketScope {
  return typeof value === "string" && Object.hasOwn(ENGINEER_TICKET_SCOPES, value)
    ? (value as EngineerTicketScope)
    : DEFAULT_ENGINEER_SCOPE;
}
