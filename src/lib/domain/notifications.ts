import { formatCurrency, formatDate } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/constants";
import { feasibilityStatus, FEASIBILITY_WARNING_DAYS } from "./kseb";
import type { ProjectStage, TicketStatus } from "@/lib/types";

/**
 * The notification catalogue: every event the system can announce, who hears
 * about it, and what it says. Pure — the server layer (src/server/notifications)
 * resolves "office" to user ids, stores the rows and sends Web Push.
 *
 * Rules that hold for every type:
 *   - the actor never notifies themselves;
 *   - "office" means every admin and the SuperAdmin;
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
  "project.milestone_completed": { label: "Milestone completed", push: false, category: "project" },
  "project.commissioned": { label: "Plant commissioned", push: true, category: "project" },
  "payment.recorded": { label: "Payment recorded", push: true, category: "payment" },
  "incentive.updated": { label: "Incentive updated", push: true, category: "payment" },
  "ticket.assigned": { label: "Service ticket assigned", push: true, category: "service" },
  "ticket.unassigned": { label: "Service ticket reassigned", push: true, category: "service" },
  "ticket.status_changed": { label: "Service ticket updated", push: true, category: "service" },
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

export type NotificationEvent = Actor &
  (
    | {
        type: "work_order.submitted";
        actorName: string;
        workOrderId: string;
        clientName: string;
        capacity: string;
      }
    | {
        type: "work_order.assigned";
        actorName: string;
        coordinatorId: string;
        workOrderId: string;
        clientName: string;
        capacity: string;
      }
    | {
        type: "work_order.updated";
        actorName: string;
        workOrderId: string;
        clientName: string;
      }
    | {
        type: "work_order.approved";
        coordinatorId: string;
        workOrderId: string;
        projectId: string | null;
        clientName: string;
      }
    | {
        type: "work_order.rejected";
        coordinatorId: string;
        workOrderId: string;
        clientName: string;
      }
    | {
        type: "project.milestone_completed";
        coordinatorId: string;
        projectId: string;
        clientName: string;
        stage: ProjectStage;
      }
    | {
        type: "project.commissioned";
        coordinatorId: string;
        projectId: string;
        clientName: string;
      }
    | {
        type: "payment.recorded";
        coordinatorId: string;
        workOrderId: string;
        projectId: string | null;
        clientName: string;
        amount: number;
        balanceDue: number;
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
        status: TicketStatus;
        clientName: string | null;
      }
    | {
        type: "feasibility.expiring";
        coordinatorId: string;
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
        coordinatorId: string;
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
    case "work_order.updated":
    case "ticket.status_changed":
      return { office: true, users: [] };
    case "work_order.assigned":
    case "work_order.approved":
    case "work_order.rejected":
    case "project.milestone_completed":
    case "payment.recorded":
    case "incentive.updated":
      return { office: false, users: [event.coordinatorId] };
    case "project.commissioned":
    case "feasibility.expiring":
    case "feasibility.extended":
      return { office: true, users: [event.coordinatorId] };
    case "ticket.assigned":
    case "ticket.unassigned":
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

function ticketLabel(ticketNo: string | null): string {
  return ticketNo ?? "a service ticket";
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
        `${event.clientName} · ${event.capacity} — awaiting approval`,
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
    case "project.milestone_completed":
      return plain(
        `Milestone completed: ${STAGE_LABELS[event.stage]}`,
        event.clientName,
        `/projects/${event.projectId}`,
      );
    case "project.commissioned":
      return plain(
        "Plant commissioned",
        `${event.clientName} — all KSEB/ANERT milestones complete.`,
        `/projects/${event.projectId}`,
      );
    case "payment.recorded":
      return plain(
        `Payment received: ${formatCurrency(event.amount)}`,
        event.balanceDue > 0
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
        `New service ticket ${ticketLabel(event.ticketNo)}`,
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
        `${ticketLabel(event.ticketNo)} was reassigned`,
        "It is no longer on your list.",
        "/tickets",
      );
    case "ticket.status_changed":
      return plain(
        event.status === "completed"
          ? `${ticketLabel(event.ticketNo)} completed`
          : `${ticketLabel(event.ticketNo)} in progress`,
        [event.clientName, `by ${event.actorName}`].filter(Boolean).join(" · "),
        `/tickets/${event.ticketId}`,
      );
    case "feasibility.expiring":
      return {
        title:
          event.daysLeft <= 0
            ? "Feasibility expires today"
            : `Feasibility expires in ${event.daysLeft} day${event.daysLeft === 1 ? "" : "s"}`,
        body: `${event.clientName} — valid until ${formatDate(event.validUntil)}. Commission before then to avoid a ₹1,000 renewal.`,
        link: `/projects/${event.projectId}`,
        dedupeKey: `feasibility.expiring:${event.projectId}:p${event.period}:d${event.threshold}`,
      };
    case "feasibility.extended":
      return {
        title: `Feasibility renewed (${event.renewals}×) — BSS cost ${formatCurrency(event.extensionCost)}`,
        body: `${event.clientName} — now valid until ${formatDate(event.validUntil)}.`,
        link: `/projects/${event.projectId}`,
        dedupeKey: `feasibility.extended:${event.projectId}:r${event.renewals}`,
      };
  }
}

/** Second, final reminder before a period lapses. */
export const FEASIBILITY_FINAL_WARNING_DAYS = 1;

/**
 * The feasibility alerts a project warrants today (the daily cron emits these;
 * dedupe keys make re-runs harmless). An active project:
 *   - in a renewed period → one "extended" alert per renewal;
 *   - within 7 days of its period ending → an "expiring" alert at the 7-day
 *     threshold and again at the 1-day threshold.
 */
export function feasibilityEvents(
  project: {
    projectId: string;
    coordinatorId: string;
    clientName: string;
    feasibilityDate: string | null;
    completedAt: string | null;
    isCompleted: boolean;
  },
  today: string,
): NotificationEvent[] {
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
    coordinatorId: project.coordinatorId,
    projectId: project.projectId,
    clientName: project.clientName,
  };
  const events: NotificationEvent[] = [];

  if (status.renewals > 0) {
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
