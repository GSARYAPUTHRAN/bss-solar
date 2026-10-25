import { formatCurrency, formatDate } from "@/lib/format";
import { STAGE_LABELS, TICKET_STATUS_LABELS } from "@/lib/constants";
import { coordinatorsLabel } from "./coordinators";
import { addDays, diffDays } from "./dates";
import { feasibilityStatus, FEASIBILITY_WARNING_DAYS, KSEB_FEES } from "./kseb";
import { isActiveTicket } from "./ticket-workflow";
import type {
  PlanType,
  ProjectCancellation,
  ProjectStage,
  TicketStatus,
} from "@/lib/types";

/**
 * The notification catalogue: every event the system can announce, who hears
 * about it, and what it says. Pure — the server layer (src/server/notifications)
 * resolves "office" to user ids, stores the rows and sends Web Push.
 *
 * Rules that hold for every type:
 *   - the actor never notifies themselves;
 *   - "office" means every admin and the SuperAdmin;
 *   - a sale is shared by one or more coordinators: events about the sale name
 *     them all (`coordinatorIds`) and each hears it once; a person's incentive
 *     is theirs alone (`incentive.updated` keeps a single `coordinatorId`);
 *   - links are in-app paths (the DB rejects anything else).
 */

export type NotificationCategory = "sales" | "project" | "payment" | "service" | "kseb";

interface CatalogueEntry {
  label: string;
  /** Also send a browser push (otherwise in-app only). */
  push: boolean;
  category: NotificationCategory;
}

export const NOTIFICATION_TYPES = {
  "work_order.submitted": { label: "New work order", push: true, category: "sales" },
  "work_order.assigned": { label: "Work order assigned to you", push: true, category: "sales" },
  "work_order.updated": { label: "Work order updated", push: false, category: "sales" },
  "work_order.approved": { label: "Work order approved", push: true, category: "sales" },
  "work_order.rejected": { label: "Work order rejected", push: true, category: "sales" },
  "work_order.coordinator_added": { label: "Added to a sale", push: true, category: "sales" },
  "work_order.coordinator_removed": { label: "Removed from a sale", push: false, category: "sales" },
  "project.milestone_completed": { label: "Milestone completed", push: false, category: "project" },
  "project.commissioned": { label: "Plant commissioned", push: true, category: "project" },
  "project.cancelled": { label: "Project cancelled or refunded", push: true, category: "project" },
  "project.reinstated": { label: "Project reinstated", push: true, category: "project" },
  "payment.recorded": { label: "Payment recorded", push: true, category: "payment" },
  "incentive.updated": { label: "Incentive updated", push: true, category: "payment" },
  "ticket.assigned": { label: "Service ticket assigned", push: true, category: "service" },
  "ticket.unassigned": { label: "Service ticket reassigned", push: true, category: "service" },
  "ticket.status_changed": { label: "Service ticket updated", push: true, category: "service" },
  "ticket.updated": { label: "Service ticket changed by the office", push: true, category: "service" },
  "feasibility.expiring": { label: "Feasibility expiring", push: true, category: "kseb" },
  "feasibility.extended": { label: "Feasibility extended", push: true, category: "kseb" },
} as const satisfies Record<string, CatalogueEntry>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function isNotificationType(value: string): value is NotificationType {
  return Object.hasOwn(NOTIFICATION_TYPES, value);
}

/** Category of a stored row's `type`; unknown/legacy types fall back to sales. */
export function categoryOf(type: string): NotificationCategory {
  return isNotificationType(type) ? NOTIFICATION_TYPES[type].category : "sales";
}

/** Who performed the action. `null` for the system (scheduled jobs). */
interface Actor {
  actorId: string | null;
}

/** What the office changed on a ticket an engineer holds (`ticket.updated`). */
export type TicketUpdateReason = "rescheduled" | "cancelled" | "reopened" | "status_changed";

export type NotificationEvent = Actor &
  (
    | {
        type: "work_order.submitted";
        actorName: string;
        workOrderId: string;
        clientName: string;
        capacity: string;
        /** Names of the partners the coordinator logged it with (not the actor). */
        partnerNames: readonly string[];
      }
    | {
        type: "work_order.assigned";
        actorName: string;
        coordinatorIds: readonly string[];
        workOrderId: string;
        clientName: string;
        capacity: string;
      }
    | {
        type: "work_order.updated";
        actorName: string;
        /** The sale's coordinators — they hear about edits alongside the office. */
        coordinatorIds: readonly string[];
        workOrderId: string;
        clientName: string;
      }
    | {
        type: "work_order.approved";
        coordinatorIds: readonly string[];
        workOrderId: string;
        projectId: string | null;
        clientName: string;
      }
    | {
        type: "work_order.rejected";
        coordinatorIds: readonly string[];
        workOrderId: string;
        clientName: string;
      }
    | {
        type: "work_order.coordinator_added";
        actorName: string;
        /** Who was just put on the sale. */
        addedIds: readonly string[];
        /** A coordinator brought partners onto an existing sale: the office hears too. */
        notifyOffice: boolean;
        workOrderId: string;
        projectId: string | null;
        clientName: string;
        capacity: string;
        /** Everyone on the sale after the change, in order. */
        teamNames: readonly string[];
      }
    | {
        type: "work_order.coordinator_removed";
        actorName: string;
        removedIds: readonly string[];
        clientName: string;
      }
    | {
        type: "project.milestone_completed";
        coordinatorIds: readonly string[];
        projectId: string;
        clientName: string;
        stage: ProjectStage;
      }
    | {
        type: "project.commissioned";
        coordinatorIds: readonly string[];
        projectId: string;
        clientName: string;
        /** A custom plan is "handed over", not commissioned. */
        planType: PlanType;
      }
    | {
        type: "project.cancelled";
        coordinatorIds: readonly string[];
        projectId: string;
        clientName: string;
        cancellation: ProjectCancellation;
        remarks: string | null;
      }
    | {
        type: "project.reinstated";
        coordinatorIds: readonly string[];
        projectId: string;
        clientName: string;
        /** What it was before. */
        previous: ProjectCancellation;
      }
    | {
        type: "payment.recorded";
        coordinatorIds: readonly string[];
        workOrderId: string;
        projectId: string | null;
        clientName: string;
        amount: number;
        /** What is still collectable — from `collectibleBalance` (0 once cancelled). */
        balanceDue: number;
        /** The project's state; null while live or before there is a project. */
        cancellation: ProjectCancellation | null;
      }
    | {
        type: "incentive.updated";
        coordinatorId: string;
        projectId: string;
        clientName: string;
        amount: number | null;
        paidOn: string | null;
      }
    | {
        type: "ticket.assigned";
        engineerId: string;
        ticketId: string;
        ticketNo: string | null;
        clientName: string | null;
        scheduledDate: string | null;
      }
    | {
        type: "ticket.unassigned";
        engineerId: string;
        ticketId: string;
        ticketNo: string | null;
      }
    | {
        type: "ticket.status_changed";
        actorName: string;
        ticketId: string;
        ticketNo: string | null;
        /** Only the field moves an engineer can make are announced. */
        status: Extract<TicketStatus, "in_progress" | "completed">;
        clientName: string | null;
      }
    | {
        type: "ticket.updated";
        engineerId: string;
        ticketId: string;
        ticketNo: string | null;
        clientName: string | null;
        reason: TicketUpdateReason;
        /** Status and visit date after the change. */
        status: TicketStatus;
        scheduledDate: string | null;
        /** False when the same edit also took the ticket off the engineer's list. */
        stillAssigned: boolean;
      }
    | {
        type: "feasibility.expiring";
        coordinatorIds: readonly string[];
        projectId: string;
        clientName: string;
        daysLeft: number;
        validUntil: string;
        period: number;
        /** The warning threshold crossed (7 or 1) — part of the dedupe key. */
        threshold: number;
      }
    | {
        type: "feasibility.extended";
        coordinatorIds: readonly string[];
        projectId: string;
        clientName: string;
        renewals: number;
        validUntil: string;
        extensionCost: number;
      }
  );

export interface Audience {
  /** Every admin + the SuperAdmin. */
  office: boolean;
  users: string[];
}

export function audienceFor(event: NotificationEvent): Audience {
  switch (event.type) {
    case "work_order.submitted":
    case "ticket.status_changed":
      return { office: true, users: [] };
    case "work_order.assigned":
    case "work_order.approved":
    case "work_order.rejected":
    case "project.milestone_completed":
    case "payment.recorded":
      return { office: false, users: [...event.coordinatorIds] };
    case "work_order.updated":
    case "project.commissioned":
    case "project.cancelled":
    case "project.reinstated":
    case "feasibility.expiring":
    case "feasibility.extended":
      return { office: true, users: [...event.coordinatorIds] };
    case "work_order.coordinator_added":
      return { office: event.notifyOffice, users: [...event.addedIds] };
    case "work_order.coordinator_removed":
      return { office: false, users: [...event.removedIds] };
    case "incentive.updated":
      return { office: false, users: [event.coordinatorId] };
    case "ticket.assigned":
    case "ticket.unassigned":
    case "ticket.updated":
      return { office: false, users: [event.engineerId] };
  }
}

/** Unique recipient ids for an audience, never including the actor. */
export function resolveRecipients(
  audience: Audience,
  context: { officeIds: readonly string[]; actorId: string | null },
): string[] {
  const ids = new Set<string>(audience.users.filter(Boolean));
  if (audience.office) context.officeIds.forEach((id) => ids.add(id));
  if (context.actorId) ids.delete(context.actorId);
  return [...ids];
}

export interface NotificationMessage {
  title: string;
  body: string | null;
  link: string | null;
  /** Makes scheduled alerts idempotent per recipient; null for one-offs. */
  dedupeKey: string | null;
}

/** "BSS-2610-1001" or, before a number is assigned, a phrase that starts a title. */
function ticketSubject(ticketNo: string | null): string {
  return ticketNo ?? "A service ticket";
}

type TicketUpdatedEvent = Extract<NotificationEvent, { type: "ticket.updated" }>;

function ticketUpdateTitle(event: TicketUpdatedEvent): string {
  const subject = ticketSubject(event.ticketNo);
  switch (event.reason) {
    case "rescheduled":
      return `${subject} was rescheduled`;
    case "cancelled":
      return `${subject} was cancelled`;
    case "reopened":
      return `${subject} was reopened`;
    case "status_changed":
      return `${subject} was marked ${TICKET_STATUS_LABELS[event.status].toLowerCase()}`;
  }
}

/** Whether (and when) the engineer still has a visit to make. */
function visitNote(event: TicketUpdatedEvent): string {
  if (!isActiveTicket(event.status)) return "no visit needed";
  return event.scheduledDate
    ? `visit on ${formatDate(event.scheduledDate)}`
    : "visit date to be confirmed";
}

/** How much of a cancellation's remarks a notification carries. */
const REMARKS_SNIPPET_MAX = 120;

/** The remarks on one line, cut at 120 characters with an ellipsis; null when blank. */
function remarkSnippet(remarks: string | null): string | null {
  const text = (remarks ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const chars = [...text];
  return chars.length > REMARKS_SNIPPET_MAX
    ? `${chars.slice(0, REMARKS_SNIPPET_MAX).join("").trimEnd()}…`
    : text;
}

export function describe(event: NotificationEvent): NotificationMessage {
  const plain = (title: string, body: string | null, link: string | null) => ({
    title,
    body,
    link,
    dedupeKey: null,
  });

  switch (event.type) {
    case "work_order.submitted":
      return plain(
        `New work order from ${event.actorName}`,
        `${event.clientName} · ${event.capacity} — awaiting approval${
          event.partnerNames.length > 0
            ? ` · with ${coordinatorsLabel(event.partnerNames)}`
            : ""
        }`,
        `/work-orders/${event.workOrderId}`,
      );
    case "work_order.assigned":
      return plain(
        "Work order logged for you",
        `${event.clientName} · ${event.capacity} (by ${event.actorName})`,
        `/work-orders/${event.workOrderId}`,
      );
    case "work_order.updated":
      return plain(
        `${event.actorName} updated a work order`,
        event.clientName,
        `/work-orders/${event.workOrderId}`,
      );
    case "work_order.approved":
      return plain(
        "Work order approved",
        `${event.clientName} is now an active project.`,
        event.projectId ? `/projects/${event.projectId}` : `/work-orders/${event.workOrderId}`,
      );
    case "work_order.rejected":
      return plain(
        "Work order rejected",
        event.clientName,
        `/work-orders/${event.workOrderId}`,
      );
    case "work_order.coordinator_added":
      return plain(
        `${event.actorName} added you to a sale`,
        `${event.clientName} · ${event.capacity} — with ${coordinatorsLabel(event.teamNames)}`,
        event.projectId ? `/projects/${event.projectId}` : `/work-orders/${event.workOrderId}`,
      );
    case "work_order.coordinator_removed":
      return plain(
        "You were taken off a sale",
        `${event.clientName} — by ${event.actorName}. It is no longer on your list.`,
        "/work-orders",
      );
    case "project.milestone_completed":
      return plain(
        `Milestone completed: ${STAGE_LABELS[event.stage]}`,
        event.clientName,
        `/projects/${event.projectId}`,
      );
    case "project.commissioned":
      return event.planType === "custom"
        ? plain(
            "Custom plan handed over",
            `${event.clientName} — handed over.`,
            `/projects/${event.projectId}`,
          )
        : plain(
            "Plant commissioned",
            `${event.clientName} — all KSEB/ANERT milestones complete.`,
            `/projects/${event.projectId}`,
          );
    case "project.cancelled": {
      const remarks = remarkSnippet(event.remarks);
      return plain(
        event.cancellation === "refunded" ? "Project refunded" : "Project cancelled",
        remarks ? `${event.clientName} — ${remarks}` : event.clientName,
        `/projects/${event.projectId}`,
      );
    }
    case "project.reinstated":
      return plain(
        "Project reinstated",
        `${event.clientName} is back in the pipeline (was ${event.previous}).`,
        `/projects/${event.projectId}`,
      );
    case "payment.recorded":
      return plain(
        `Payment received: ${formatCurrency(event.amount)}`,
        event.cancellation
          ? // Nothing more is collectable once a project is cancelled or refunded.
            `${event.clientName} — project ${event.cancellation}`
          : event.balanceDue > 0
            ? `${event.clientName} — ${formatCurrency(event.balanceDue)} still due`
            : `${event.clientName} — paid in full`,
        event.projectId ? `/projects/${event.projectId}` : `/work-orders/${event.workOrderId}`,
      );
    case "incentive.updated":
      return plain(
        event.amount === null
          ? "Incentive removed"
          : event.paidOn
            ? `Incentive paid: ${formatCurrency(event.amount)}`
            : `Incentive set: ${formatCurrency(event.amount)}`,
        event.clientName,
        `/projects/${event.projectId}`,
      );
    case "ticket.assigned":
      return plain(
        event.ticketNo ? `New service ticket ${event.ticketNo}` : "New service ticket",
        [
          event.clientName,
          event.scheduledDate ? `scheduled ${formatDate(event.scheduledDate)}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
        `/tickets/${event.ticketId}`,
      );
    case "ticket.unassigned":
      return plain(
        `${ticketSubject(event.ticketNo)} was reassigned`,
        "It is no longer on your list.",
        "/tickets",
      );
    case "ticket.status_changed":
      return plain(
        event.status === "completed"
          ? `${ticketSubject(event.ticketNo)} was completed`
          : `${ticketSubject(event.ticketNo)} is in progress`,
        [event.clientName, `by ${event.actorName}`].filter(Boolean).join(" · "),
        `/tickets/${event.ticketId}`,
      );
    case "ticket.updated":
      return plain(
        ticketUpdateTitle(event),
        [event.clientName, visitNote(event)].filter(Boolean).join(" · "),
        // Off their list, the ticket page is closed to them (as for unassigned).
        event.stillAssigned ? `/tickets/${event.ticketId}` : "/tickets",
      );
    case "feasibility.expiring":
      return {
        title:
          event.daysLeft <= 0
            ? "Feasibility expires today"
            : `Feasibility expires in ${event.daysLeft} day${event.daysLeft === 1 ? "" : "s"}`,
        body: `${event.clientName} — valid until ${formatDate(event.validUntil)}. Commission before then to avoid a ${formatCurrency(KSEB_FEES.feasibilityRenewalFee)} renewal.`,
        link: `/projects/${event.projectId}`,
        // Keyed on the validity window, not its ordinal: if the office corrects
        // the feasibility date, the new window's alerts must not collide with
        // the old window's rows in UNIQUE (recipient_id, dedupe_key).
        dedupeKey: `feasibility.expiring:${event.projectId}:${event.validUntil}:d${event.threshold}`,
      };
    case "feasibility.extended":
      return {
        title: `Feasibility renewed (${event.renewals}×) — BSS cost ${formatCurrency(event.extensionCost)}`,
        body: `${event.clientName} — now valid until ${formatDate(event.validUntil)}.`,
        link: `/projects/${event.projectId}`,
        dedupeKey: `feasibility.extended:${event.projectId}:${event.validUntil}`,
      };
  }
}

/** Second, final reminder before a period lapses. */
export const FEASIBILITY_FINAL_WARNING_DAYS = 1;

/**
 * Days into a renewed period during which the renewal is still announced. It is
 * news the day it happens; the slack covers missed daily runs. An older renewal
 * — a legacy project from the onboarding import, or a feasibility date entered
 * after the fact — is history, not an alert.
 */
export const FEASIBILITY_RENEWAL_GRACE_DAYS = 3;

/**
 * The feasibility alerts a project warrants today (the daily cron emits these;
 * dedupe keys make re-runs harmless). An active project:
 *   - in a period renewed within the last 3 days → one "extended" alert per
 *     renewal;
 *   - within 7 days of its period ending → an "expiring" alert at the 7-day
 *     threshold and again at the 1-day threshold.
 * Each goes to the office and every coordinator of the sale. A cancelled or
 * refunded project has no running clock, so it warrants none.
 */
export function feasibilityEvents(
  project: {
    projectId: string;
    coordinatorIds: readonly string[];
    clientName: string;
    feasibilityDate: string | null;
    completedAt: string | null;
    isCompleted: boolean;
    cancellation?: ProjectCancellation | null;
    cancelledOn?: string | null;
  },
  today: string,
): NotificationEvent[] {
  if (project.cancellation != null || project.cancelledOn != null) return [];
  const status = feasibilityStatus({
    feasibilityDate: project.feasibilityDate,
    completedAt: project.completedAt,
    isCompleted: project.isCompleted,
    today,
  });
  if (
    status.state === "not_set" ||
    status.state === "closed" ||
    status.periods === null ||
    status.validUntil === null ||
    status.daysLeft === null
  ) {
    return [];
  }

  const base = {
    actorId: null,
    coordinatorIds: project.coordinatorIds,
    projectId: project.projectId,
    clientName: project.clientName,
  };
  const events: NotificationEvent[] = [];

  // The current period began the day after the previous one ended.
  const periodStart = addDays(status.validUntil, 1 - KSEB_FEES.feasibilityValidityDays);
  if (status.renewals > 0 && diffDays(periodStart, today) <= FEASIBILITY_RENEWAL_GRACE_DAYS) {
    events.push({
      ...base,
      type: "feasibility.extended",
      renewals: status.renewals,
      validUntil: status.validUntil,
      extensionCost: status.extensionCost,
    });
  }
  if (status.daysLeft <= FEASIBILITY_WARNING_DAYS) {
    events.push({
      ...base,
      type: "feasibility.expiring",
      daysLeft: status.daysLeft,
      validUntil: status.validUntil,
      period: status.periods,
      threshold:
        status.daysLeft <= FEASIBILITY_FINAL_WARNING_DAYS
          ? FEASIBILITY_FINAL_WARNING_DAYS
          : FEASIBILITY_WARNING_DAYS,
    });
  }
  return events;
}
