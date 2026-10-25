import { describe, it, expect, expectTypeOf } from "vitest";
import { formatCurrency, formatDate } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/constants";
import { addDays } from "./dates";
import { KSEB_FEES } from "./kseb";
import {
  FEASIBILITY_FINAL_WARNING_DAYS,
  NOTIFICATION_TYPES,
  audienceFor,
  categoryOf,
  describe as describeEvent,
  feasibilityEvents,
  isNotificationType,
  resolveRecipients,
  type NotificationEvent,
  type NotificationType,
} from "./notifications";

type EventOf<T extends NotificationType> = Extract<NotificationEvent, { type: T }>;

/**
 * One representative event per type. The mapped type makes this a
 * compile-time completeness check in both directions: a catalogue entry with
 * no event variant has `never` as its value type, and a missing entry is a
 * missing property.
 */
const EVENTS: { [K in NotificationType]: EventOf<K> } = {
  "work_order.submitted": {
    type: "work_order.submitted",
    actorId: "coord-1",
    actorName: "Rahul",
    workOrderId: "wo-1",
    clientName: "Anil Kumar",
    capacity: "3kW",
    partnerNames: [],
  },
  "work_order.assigned": {
    type: "work_order.assigned",
    actorId: "admin-1",
    actorName: "Office",
    coordinatorIds: ["coord-1"],
    workOrderId: "wo-1",
    clientName: "Anil Kumar",
    capacity: "3kW",
  },
  "work_order.updated": {
    type: "work_order.updated",
    actorId: "coord-1",
    actorName: "Rahul",
    coordinatorIds: ["coord-1", "coord-2"],
    workOrderId: "wo-1",
    clientName: "Anil Kumar",
  },
  "work_order.approved": {
    type: "work_order.approved",
    actorId: "admin-1",
    coordinatorIds: ["coord-1"],
    workOrderId: "wo-1",
    projectId: "pr-1",
    clientName: "Anil Kumar",
  },
  "work_order.rejected": {
    type: "work_order.rejected",
    actorId: "admin-1",
    coordinatorIds: ["coord-1"],
    workOrderId: "wo-1",
    clientName: "Anil Kumar",
  },
  "work_order.coordinator_added": {
    type: "work_order.coordinator_added",
    actorId: "coord-1",
    actorName: "Rahul",
    addedIds: ["coord-2"],
    notifyOffice: true,
    workOrderId: "wo-1",
    projectId: null,
    clientName: "Anil Kumar",
    capacity: "3kW",
    teamNames: ["Rahul", "Priya"],
  },
  "work_order.coordinator_removed": {
    type: "work_order.coordinator_removed",
    actorId: "admin-1",
    actorName: "Office",
    removedIds: ["coord-2"],
    clientName: "Anil Kumar",
  },
  "project.milestone_completed": {
    type: "project.milestone_completed",
    actorId: "admin-1",
    coordinatorIds: ["coord-1"],
    projectId: "pr-1",
    clientName: "Anil Kumar",
    stage: "panel_installation",
  },
  "project.commissioned": {
    type: "project.commissioned",
    actorId: "admin-1",
    coordinatorIds: ["coord-1"],
    projectId: "pr-1",
    clientName: "Anil Kumar",
    planType: "solar",
  },
  "project.cancelled": {
    type: "project.cancelled",
    actorId: "admin-1",
    coordinatorIds: ["coord-1"],
    projectId: "pr-1",
    clientName: "Anil Kumar",
    cancellation: "cancelled",
    remarks: "Customer withdrew after the survey.",
  },
  "project.reinstated": {
    type: "project.reinstated",
    actorId: "admin-1",
    coordinatorIds: ["coord-1"],
    projectId: "pr-1",
    clientName: "Anil Kumar",
    previous: "refunded",
  },
  "payment.recorded": {
    type: "payment.recorded",
    actorId: "admin-1",
    coordinatorIds: ["coord-1"],
    workOrderId: "wo-1",
    projectId: "pr-1",
    clientName: "Anil Kumar",
    amount: 50000,
    balanceDue: 25000,
    cancellation: null,
  },
  "incentive.updated": {
    type: "incentive.updated",
    actorId: "admin-1",
    coordinatorId: "coord-1",
    projectId: "pr-1",
    clientName: "Anil Kumar",
    amount: 5000,
    paidOn: null,
  },
  "ticket.assigned": {
    type: "ticket.assigned",
    actorId: "admin-1",
    engineerId: "eng-1",
    ticketId: "t-1",
    ticketNo: "ST-2026-0001",
    clientName: "Anil Kumar",
    scheduledDate: "2026-10-12",
  },
  "ticket.unassigned": {
    type: "ticket.unassigned",
    actorId: "admin-1",
    engineerId: "eng-1",
    ticketId: "t-1",
    ticketNo: "ST-2026-0001",
  },
  "ticket.status_changed": {
    type: "ticket.status_changed",
    actorId: "eng-1",
    actorName: "Suresh",
    ticketId: "t-1",
    ticketNo: "ST-2026-0001",
    status: "completed",
    clientName: "Anil Kumar",
  },
  "ticket.updated": {
    type: "ticket.updated",
    actorId: "admin-1",
    engineerId: "eng-1",
    ticketId: "t-1",
    ticketNo: "ST-2026-0001",
    clientName: "Anil Kumar",
    reason: "rescheduled",
    status: "scheduled",
    scheduledDate: "2026-10-15",
    stillAssigned: true,
  },
  "feasibility.expiring": {
    type: "feasibility.expiring",
    actorId: null,
    coordinatorIds: ["coord-1"],
    projectId: "pr-1",
    clientName: "Anil Kumar",
    daysLeft: 7,
    validUntil: "2026-01-31",
    period: 1,
    threshold: 7,
  },
  "feasibility.extended": {
    type: "feasibility.extended",
    actorId: null,
    coordinatorIds: ["coord-1"],
    projectId: "pr-1",
    clientName: "Anil Kumar",
    renewals: 1,
    validUntil: "2026-03-02",
    extensionCost: 1000,
  },
};

const ALL_EVENTS: NotificationEvent[] = Object.values(EVENTS);

/** Variants that exercise every branch of `describe`. */
const VARIANTS: NotificationEvent[] = [
  ...ALL_EVENTS,
  { ...EVENTS["work_order.approved"], projectId: null },
  { ...EVENTS["work_order.submitted"], partnerNames: ["Priya", "Arun"] },
  { ...EVENTS["work_order.coordinator_added"], projectId: "pr-1" },
  { ...EVENTS["project.commissioned"], planType: "custom" },
  { ...EVENTS["project.cancelled"], cancellation: "refunded", remarks: null },
  { ...EVENTS["project.cancelled"], remarks: "x".repeat(500) },
  { ...EVENTS["project.reinstated"], previous: "cancelled" },
  { ...EVENTS["payment.recorded"], projectId: null, balanceDue: 0 },
  { ...EVENTS["payment.recorded"], balanceDue: -100 },
  { ...EVENTS["payment.recorded"], balanceDue: 0, cancellation: "cancelled" },
  { ...EVENTS["payment.recorded"], balanceDue: 0, cancellation: "refunded" },
  { ...EVENTS["incentive.updated"], amount: null },
  { ...EVENTS["incentive.updated"], paidOn: "2026-10-01" },
  { ...EVENTS["incentive.updated"], amount: 0 },
  { ...EVENTS["ticket.assigned"], clientName: null, scheduledDate: null },
  { ...EVENTS["ticket.status_changed"], status: "in_progress", clientName: null },
  { ...EVENTS["ticket.updated"], status: "open", scheduledDate: null, clientName: null },
  { ...EVENTS["ticket.updated"], reason: "cancelled", status: "cancelled", stillAssigned: false },
  { ...EVENTS["ticket.updated"], reason: "reopened", status: "open", ticketNo: null },
  { ...EVENTS["ticket.updated"], reason: "status_changed", status: "in_progress" },
  { ...EVENTS["ticket.updated"], reason: "status_changed", status: "completed" },
  { ...EVENTS["feasibility.expiring"], daysLeft: 1, threshold: 1 },
  { ...EVENTS["feasibility.expiring"], daysLeft: 0, threshold: 1 },
];

describe("NOTIFICATION_TYPES", () => {
  it("has exactly one catalogue entry per event in the union", () => {
    expectTypeOf<NotificationEvent["type"]>().toEqualTypeOf<NotificationType>();
    expect(Object.keys(EVENTS).sort()).toEqual(Object.keys(NOTIFICATION_TYPES).sort());
    for (const [key, event] of Object.entries(EVENTS)) expect(event.type).toBe(key);
  });

  it("gives every type a label and a known category", () => {
    const categories = ["sales", "project", "payment", "service", "kseb"];
    for (const entry of Object.values(NOTIFICATION_TYPES)) {
      expect(entry.label.trim()).not.toBe("");
      expect(categories).toContain(entry.category);
      expect(typeof entry.push).toBe("boolean");
    }
  });

  it("pushes everything except the three in-app-only types (per the catalogue)", () => {
    const inAppOnly = Object.entries(NOTIFICATION_TYPES)
      .filter(([, entry]) => !entry.push)
      .map(([type]) => type)
      .sort();
    expect(inAppOnly).toEqual([
      "project.milestone_completed",
      "work_order.coordinator_removed",
      "work_order.updated",
    ]);
  });

  it("catalogues the sale-team and cancellation events", () => {
    expect(NOTIFICATION_TYPES["work_order.coordinator_added"]).toEqual({
      label: "Added to a sale",
      push: true,
      category: "sales",
    });
    expect(NOTIFICATION_TYPES["work_order.coordinator_removed"]).toEqual({
      label: "Removed from a sale",
      push: false,
      category: "sales",
    });
    expect(NOTIFICATION_TYPES["project.cancelled"]).toEqual({
      label: "Project cancelled or refunded",
      push: true,
      category: "project",
    });
    expect(NOTIFICATION_TYPES["project.reinstated"]).toEqual({
      label: "Project reinstated",
      push: true,
      category: "project",
    });
  });
});

describe("isNotificationType / categoryOf", () => {
  it("recognises every catalogue type", () => {
    for (const type of Object.keys(NOTIFICATION_TYPES)) {
      expect(isNotificationType(type)).toBe(true);
      expect(categoryOf(type)).toBe(NOTIFICATION_TYPES[type as NotificationType].category);
    }
  });

  it.each(["", "legacy.type", "WORK_ORDER.SUBMITTED", "constructor", "toString", "__proto__"])(
    "treats %j as unknown and files it under sales",
    (type) => {
      expect(isNotificationType(type)).toBe(false);
      expect(categoryOf(type)).toBe("sales");
    },
  );
});

describe("audienceFor", () => {
  it.each<[NotificationType, { office: boolean; users: string[] }]>([
    ["work_order.submitted", { office: true, users: [] }],
    ["work_order.assigned", { office: false, users: ["coord-1"] }],
    ["work_order.updated", { office: true, users: ["coord-1", "coord-2"] }],
    ["work_order.approved", { office: false, users: ["coord-1"] }],
    ["work_order.rejected", { office: false, users: ["coord-1"] }],
    ["work_order.coordinator_added", { office: true, users: ["coord-2"] }],
    ["work_order.coordinator_removed", { office: false, users: ["coord-2"] }],
    ["project.milestone_completed", { office: false, users: ["coord-1"] }],
    ["project.commissioned", { office: true, users: ["coord-1"] }],
    ["project.cancelled", { office: true, users: ["coord-1"] }],
    ["project.reinstated", { office: true, users: ["coord-1"] }],
    ["payment.recorded", { office: false, users: ["coord-1"] }],
    ["incentive.updated", { office: false, users: ["coord-1"] }],
    ["ticket.assigned", { office: false, users: ["eng-1"] }],
    ["ticket.unassigned", { office: false, users: ["eng-1"] }],
    ["ticket.status_changed", { office: true, users: [] }],
    ["ticket.updated", { office: false, users: ["eng-1"] }],
    ["feasibility.expiring", { office: true, users: ["coord-1"] }],
    ["feasibility.extended", { office: true, users: ["coord-1"] }],
  ])("%s → %j", (type, audience) => {
    expect(audienceFor(EVENTS[type])).toEqual(audience);
  });

  it("never sends a service engineer's event to a coordinator or vice versa", () => {
    expect(audienceFor(EVENTS["ticket.assigned"]).users).not.toContain("coord-1");
    expect(audienceFor(EVENTS["payment.recorded"]).users).not.toContain("eng-1");
  });

  describe("on a sale shared by two coordinators", () => {
    const TEAM = ["coord-1", "coord-2"];
    const OFFICE = ["admin-1", "super-1"];
    const shared = {
      "work_order.assigned": { ...EVENTS["work_order.assigned"], coordinatorIds: TEAM },
      "work_order.updated": { ...EVENTS["work_order.updated"], coordinatorIds: TEAM },
      "work_order.approved": { ...EVENTS["work_order.approved"], coordinatorIds: TEAM },
      "work_order.rejected": { ...EVENTS["work_order.rejected"], coordinatorIds: TEAM },
      "project.milestone_completed": {
        ...EVENTS["project.milestone_completed"],
        coordinatorIds: TEAM,
      },
      "project.commissioned": { ...EVENTS["project.commissioned"], coordinatorIds: TEAM },
      "project.cancelled": { ...EVENTS["project.cancelled"], coordinatorIds: TEAM },
      "project.reinstated": { ...EVENTS["project.reinstated"], coordinatorIds: TEAM },
      "payment.recorded": { ...EVENTS["payment.recorded"], coordinatorIds: TEAM },
      "feasibility.expiring": { ...EVENTS["feasibility.expiring"], coordinatorIds: TEAM },
      "feasibility.extended": { ...EVENTS["feasibility.extended"], coordinatorIds: TEAM },
    } as const;

    /** Whether each event also reaches the office. */
    const OFFICE_TOO: Record<keyof typeof shared, boolean> = {
      "work_order.assigned": false,
      "work_order.updated": true,
      "work_order.approved": false,
      "work_order.rejected": false,
      "project.milestone_completed": false,
      "project.commissioned": true,
      "project.cancelled": true,
      "project.reinstated": true,
      "payment.recorded": false,
      "feasibility.expiring": true,
      "feasibility.extended": true,
    };

    const heard = (event: NotificationEvent, actorId: string | null) =>
      resolveRecipients(audienceFor(event), { officeIds: OFFICE, actorId }).sort();

    it.each(Object.entries(shared) as [keyof typeof shared, NotificationEvent][])(
      "%s reaches every coordinator (and the office where it should)",
      (type, event) => {
        const expected = OFFICE_TOO[type] ? [...TEAM, ...OFFICE] : TEAM;
        expect(heard(event, null)).toEqual([...expected].sort());
      },
    );

    it.each(Object.entries(shared) as [keyof typeof shared, NotificationEvent][])(
      "%s leaves the actor out — a coordinator acting, or the office",
      (type, event) => {
        const withoutCoordinator = heard(event, "coord-1");
        expect(withoutCoordinator).not.toContain("coord-1");
        expect(withoutCoordinator).toContain("coord-2");
        expect(heard(event, "admin-1")).not.toContain("admin-1");
      },
    );

    it("tells the actor's partner and the office when a coordinator edits the order", () => {
      expect(heard(shared["work_order.updated"], "coord-1")).toEqual(
        ["admin-1", "coord-2", "super-1"].sort(),
      );
    });

    it("keeps an incentive with its one person", () => {
      const incentive = EVENTS["incentive.updated"];
      expect(audienceFor(incentive)).toEqual({ office: false, users: ["coord-1"] });
      expect("coordinatorIds" in incentive).toBe(false);
    });

    it("sends added and removed people their own events only", () => {
      const added = { ...EVENTS["work_order.coordinator_added"], addedIds: ["coord-2", "coord-3"] };
      expect(heard({ ...added, notifyOffice: false }, "coord-1")).toEqual(["coord-2", "coord-3"]);
      expect(heard({ ...added, notifyOffice: true }, "coord-1")).toEqual(
        ["admin-1", "coord-2", "coord-3", "super-1"].sort(),
      );
      const removed = { ...EVENTS["work_order.coordinator_removed"], removedIds: ["coord-2"] };
      expect(heard(removed, "admin-1")).toEqual(["coord-2"]);
    });

    it("does not alias the event's own id list", () => {
      const event = shared["project.cancelled"];
      audienceFor(event).users.push("intruder");
      expect(event.coordinatorIds).toEqual(TEAM);
    });
  });
});

describe("resolveRecipients", () => {
  const officeIds = ["admin-1", "admin-2", "super-1"];

  it("merges the office with named users, without duplicates", () => {
    expect(
      resolveRecipients({ office: true, users: ["coord-1", "admin-2"] }, { officeIds, actorId: null }).sort(),
    ).toEqual(["admin-1", "admin-2", "coord-1", "super-1"]);
  });

  it("ignores the office ids when the audience is not the office", () => {
    expect(resolveRecipients({ office: false, users: ["coord-1"] }, { officeIds, actorId: null })).toEqual([
      "coord-1",
    ]);
  });

  it("never notifies the actor — whether named or part of the office", () => {
    expect(
      resolveRecipients({ office: true, users: ["coord-1"] }, { officeIds, actorId: "admin-1" }).sort(),
    ).toEqual(["admin-2", "coord-1", "super-1"]);
    expect(
      resolveRecipients({ office: false, users: ["coord-1"] }, { officeIds, actorId: "coord-1" }),
    ).toEqual([]);
  });

  it("deduplicates repeated user ids and drops blanks", () => {
    expect(
      resolveRecipients({ office: false, users: ["u1", "u1", "", "u2"] }, { officeIds: [], actorId: null }),
    ).toEqual(["u1", "u2"]);
  });

  it("is empty when nobody is left", () => {
    expect(resolveRecipients({ office: true, users: [] }, { officeIds: [], actorId: null })).toEqual([]);
    expect(
      resolveRecipients({ office: true, users: [] }, { officeIds: ["admin-1"], actorId: "admin-1" }),
    ).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const audience = { office: true, users: ["coord-1"] };
    const ids = ["admin-1"];
    resolveRecipients(audience, { officeIds: ids, actorId: "coord-1" });
    expect(audience.users).toEqual(["coord-1"]);
    expect(ids).toEqual(["admin-1"]);
  });
});

describe("describe — invariants for every event", () => {
  it.each(VARIANTS.map((e) => [e.type, e] as const))("%s renders a clean message", (_type, event) => {
    const message = describeEvent(event);

    expect(message.title.trim()).not.toBe("");
    for (const text of [message.title, message.body ?? ""]) {
      expect(text).not.toMatch(/undefined|null|NaN|\[object/);
    }

    // The DB rejects anything but an in-app path; "//host" would also be a
    // protocol-relative URL when the service worker opens it.
    expect(message.link).not.toBeNull();
    expect(message.link!.startsWith("/")).toBe(true);
    expect(message.link!.startsWith("//")).toBe(false);
    expect(message.link).not.toMatch(/\/\/|\s/);
  });

  it("is deterministic", () => {
    for (const event of VARIANTS) expect(describeEvent(event)).toEqual(describeEvent(event));
  });

  it("dedupes only the scheduled feasibility alerts", () => {
    for (const event of VARIANTS) {
      const scheduled = event.type.startsWith("feasibility.");
      if (scheduled) expect(describeEvent(event).dedupeKey).toEqual(expect.any(String));
      else expect(describeEvent(event).dedupeKey).toBeNull();
    }
  });
});

describe("describe — content per type", () => {
  it("work_order.submitted names the coordinator, client and capacity", () => {
    expect(describeEvent(EVENTS["work_order.submitted"])).toEqual({
      title: "New work order from Rahul",
      body: "Anil Kumar · 3kW — awaiting approval",
      link: "/work-orders/wo-1",
      dedupeKey: null,
    });
  });

  it("work_order.submitted names the partners the coordinator logged it with", () => {
    const submitted = EVENTS["work_order.submitted"];
    expect(describeEvent({ ...submitted, partnerNames: ["Priya Suresh"] }).body).toBe(
      "Anil Kumar · 3kW — awaiting approval · with Priya Suresh",
    );
    expect(
      describeEvent({ ...submitted, partnerNames: ["Priya Suresh", "Arun Krishnan"] }).body,
    ).toBe("Anil Kumar · 3kW — awaiting approval · with Priya Suresh & Arun Krishnan");
  });

  it("work_order.coordinator_added says who added you and who is on the sale", () => {
    expect(describeEvent(EVENTS["work_order.coordinator_added"])).toEqual({
      title: "Rahul added you to a sale",
      body: "Anil Kumar · 3kW — with Rahul & Priya",
      link: "/work-orders/wo-1",
      dedupeKey: null,
    });
  });

  it("work_order.coordinator_added links to the project once there is one", () => {
    expect(
      describeEvent({ ...EVENTS["work_order.coordinator_added"], projectId: "pr-1" }).link,
    ).toBe("/projects/pr-1");
  });

  it("work_order.coordinator_removed sends the person back to their list", () => {
    expect(describeEvent(EVENTS["work_order.coordinator_removed"])).toEqual({
      title: "You were taken off a sale",
      body: "Anil Kumar — by Office. It is no longer on your list.",
      link: "/work-orders",
      dedupeKey: null,
    });
  });

  it("project.cancelled says cancelled or refunded, with the remarks", () => {
    expect(describeEvent(EVENTS["project.cancelled"])).toEqual({
      title: "Project cancelled",
      body: "Anil Kumar — Customer withdrew after the survey.",
      link: "/projects/pr-1",
      dedupeKey: null,
    });
    expect(
      describeEvent({ ...EVENTS["project.cancelled"], cancellation: "refunded" }).title,
    ).toBe("Project refunded");
  });

  it("project.cancelled carries no dash when there are no remarks", () => {
    for (const remarks of [null, "", "   ", "\n"]) {
      expect(describeEvent({ ...EVENTS["project.cancelled"], remarks }).body).toBe("Anil Kumar");
    }
  });

  it("project.cancelled keeps remarks to one short line", () => {
    const body = describeEvent({
      ...EVENTS["project.cancelled"],
      remarks: `Refunded in full.\n\n${"x".repeat(300)}`,
    }).body!;
    expect(body).not.toMatch(/\n/);
    expect(body.startsWith("Anil Kumar — Refunded in full. xxx")).toBe(true);
    expect(body.endsWith("…")).toBe(true);
    // client + separator + at most 120 characters + the ellipsis
    expect(body.length).toBeLessThanOrEqual("Anil Kumar — ".length + 121);
  });

  it("project.cancelled leaves remarks of exactly 120 characters whole", () => {
    const remarks = "r".repeat(120);
    expect(describeEvent({ ...EVENTS["project.cancelled"], remarks }).body).toBe(
      `Anil Kumar — ${remarks}`,
    );
  });

  it("project.reinstated says what it was", () => {
    expect(describeEvent(EVENTS["project.reinstated"])).toEqual({
      title: "Project reinstated",
      body: "Anil Kumar is back in the pipeline (was refunded).",
      link: "/projects/pr-1",
      dedupeKey: null,
    });
    expect(
      describeEvent({ ...EVENTS["project.reinstated"], previous: "cancelled" }).body,
    ).toBe("Anil Kumar is back in the pipeline (was cancelled).");
  });

  it("work_order.assigned says who logged it", () => {
    expect(describeEvent(EVENTS["work_order.assigned"])).toMatchObject({
      title: "Work order logged for you",
      body: "Anil Kumar · 3kW (by Office)",
      link: "/work-orders/wo-1",
    });
  });

  it("work_order.updated", () => {
    expect(describeEvent(EVENTS["work_order.updated"])).toMatchObject({
      title: "Rahul updated a work order",
      body: "Anil Kumar",
      link: "/work-orders/wo-1",
    });
  });

  it("work_order.approved links to the new project, else the work order", () => {
    expect(describeEvent(EVENTS["work_order.approved"])).toMatchObject({
      title: "Work order approved",
      link: "/projects/pr-1",
    });
    expect(describeEvent({ ...EVENTS["work_order.approved"], projectId: null }).link).toBe(
      "/work-orders/wo-1",
    );
  });

  it("work_order.rejected", () => {
    expect(describeEvent(EVENTS["work_order.rejected"])).toMatchObject({
      title: "Work order rejected",
      body: "Anil Kumar",
      link: "/work-orders/wo-1",
    });
  });

  it("project.milestone_completed uses the stage label", () => {
    expect(describeEvent(EVENTS["project.milestone_completed"]).title).toBe(
      `Milestone completed: ${STAGE_LABELS.panel_installation}`,
    );
  });

  it("project.commissioned", () => {
    expect(describeEvent(EVENTS["project.commissioned"])).toMatchObject({
      title: "Plant commissioned",
      body: "Anil Kumar — all KSEB/ANERT milestones complete.",
      link: "/projects/pr-1",
    });
  });

  it("project.commissioned for a custom plan says handed over, not KSEB milestones", () => {
    expect(
      describeEvent({ ...EVENTS["project.commissioned"], planType: "custom" }),
    ).toEqual({
      title: "Custom plan handed over",
      body: "Anil Kumar — handed over.",
      link: "/projects/pr-1",
      dedupeKey: null,
    });
  });

  it("payment.recorded states the amount and what is still due", () => {
    expect(describeEvent(EVENTS["payment.recorded"])).toMatchObject({
      title: `Payment received: ${formatCurrency(50000)}`,
      body: `Anil Kumar — ${formatCurrency(25000)} still due`,
      link: "/projects/pr-1",
    });
  });

  it("payment.recorded on a cancelled or refunded project never says anything is still due", () => {
    for (const cancellation of ["cancelled", "refunded"] as const) {
      // Even if a caller forgot to zero the balance, the project's state wins.
      for (const balanceDue of [0, 25000]) {
        expect(
          describeEvent({ ...EVENTS["payment.recorded"], balanceDue, cancellation }),
        ).toMatchObject({
          title: `Payment received: ${formatCurrency(50000)}`,
          body: `Anil Kumar — project ${cancellation}`,
          link: "/projects/pr-1",
        });
      }
    }
  });

  it("payment.recorded is unchanged on a live project", () => {
    expect(describeEvent({ ...EVENTS["payment.recorded"], cancellation: null }).body).toBe(
      `Anil Kumar — ${formatCurrency(25000)} still due`,
    );
  });

  it("payment.recorded says paid in full at zero or negative balance", () => {
    for (const balanceDue of [0, -100]) {
      expect(describeEvent({ ...EVENTS["payment.recorded"], balanceDue }).body).toBe(
        "Anil Kumar — paid in full",
      );
    }
  });

  it("payment.recorded links to the work order before approval", () => {
    expect(describeEvent({ ...EVENTS["payment.recorded"], projectId: null }).link).toBe(
      "/work-orders/wo-1",
    );
  });

  it("incentive.updated distinguishes set, paid and removed", () => {
    const base = EVENTS["incentive.updated"];
    expect(describeEvent(base).title).toBe(`Incentive set: ${formatCurrency(5000)}`);
    expect(describeEvent({ ...base, paidOn: "2026-10-01" }).title).toBe(
      `Incentive paid: ${formatCurrency(5000)}`,
    );
    expect(describeEvent({ ...base, amount: null }).title).toBe("Incentive removed");
    expect(describeEvent({ ...base, amount: null, paidOn: "2026-10-01" }).title).toBe(
      "Incentive removed",
    );
    expect(describeEvent({ ...base, amount: 0 }).title).toBe(`Incentive set: ${formatCurrency(0)}`);
  });

  it("ticket.assigned shows the client and the schedule", () => {
    expect(describeEvent(EVENTS["ticket.assigned"])).toMatchObject({
      title: "New service ticket ST-2026-0001",
      body: `Anil Kumar · scheduled ${formatDate("2026-10-12")}`,
      link: "/tickets/t-1",
    });
  });

  it("ticket.assigned has no body when there is nothing to say", () => {
    expect(
      describeEvent({ ...EVENTS["ticket.assigned"], clientName: null, scheduledDate: null }).body,
    ).toBeNull();
    expect(
      describeEvent({ ...EVENTS["ticket.assigned"], clientName: null }).body,
    ).toBe(`scheduled ${formatDate("2026-10-12")}`);
  });

  it("ticket.unassigned sends the engineer back to their list", () => {
    expect(describeEvent(EVENTS["ticket.unassigned"])).toMatchObject({
      title: "ST-2026-0001 was reassigned",
      link: "/tickets",
    });
  });

  it("ticket.status_changed reports completed and in progress", () => {
    const base = EVENTS["ticket.status_changed"];
    expect(describeEvent(base)).toMatchObject({
      title: "ST-2026-0001 was completed",
      body: "Anil Kumar · by Suresh",
      link: "/tickets/t-1",
    });
    expect(describeEvent({ ...base, status: "in_progress", clientName: null })).toMatchObject({
      title: "ST-2026-0001 is in progress",
      body: "by Suresh",
    });
  });

  // Only the two field moves an engineer can make are announceable, so an
  // office move to open / scheduled / cancelled can never be mis-titled
  // "in progress" — the type system refuses it.
  it("ticket.status_changed only accepts the engineer's field moves", () => {
    const base = EVENTS["ticket.status_changed"];
    // @ts-expect-error — "cancelled" is not an announceable field move.
    const cancelled: NotificationEvent = { ...base, status: "cancelled" };
    // @ts-expect-error — nor is "open".
    const reopened: NotificationEvent = { ...base, status: "open" };
    expect([cancelled, reopened]).toHaveLength(2);
  });

  it("ticket.updated says what the office changed and whether a visit is still due", () => {
    const base = EVENTS["ticket.updated"];
    const message = (overrides: Partial<typeof base>) => describeEvent({ ...base, ...overrides });

    expect(message({})).toEqual({
      title: "ST-2026-0001 was rescheduled",
      body: `Anil Kumar · visit on ${formatDate("2026-10-15")}`,
      link: "/tickets/t-1",
      dedupeKey: null,
    });
    expect(message({ status: "open", scheduledDate: null, clientName: null }).body).toBe(
      "visit date to be confirmed",
    );
    expect(message({ reason: "cancelled", status: "cancelled" })).toMatchObject({
      title: "ST-2026-0001 was cancelled",
      body: "Anil Kumar · no visit needed",
    });
    expect(message({ reason: "reopened", status: "open" }).title).toBe(
      "ST-2026-0001 was reopened",
    );
    expect(message({ reason: "status_changed", status: "in_progress" }).title).toBe(
      "ST-2026-0001 was marked in progress",
    );
    expect(message({ reason: "status_changed", status: "completed" })).toMatchObject({
      title: "ST-2026-0001 was marked completed",
      body: "Anil Kumar · no visit needed",
    });
  });

  it("ticket.updated sends an engineer no longer holding the ticket to their list", () => {
    const event = { ...EVENTS["ticket.updated"], reason: "cancelled", status: "cancelled" } as const;
    expect(describeEvent({ ...event, stillAssigned: true }).link).toBe("/tickets/t-1");
    expect(describeEvent({ ...event, stillAssigned: false }).link).toBe("/tickets");
  });

  // `ticketNo` is nullable (a fresh insert may not have its number yet), so
  // every title must still read as a sentence without it.
  it("titles read naturally when the ticket number is unknown", () => {
    const titles = [
      describeEvent({ ...EVENTS["ticket.assigned"], ticketNo: null }).title,
      describeEvent({ ...EVENTS["ticket.unassigned"], ticketNo: null }).title,
      describeEvent({ ...EVENTS["ticket.status_changed"], ticketNo: null }).title,
      describeEvent({ ...EVENTS["ticket.updated"], ticketNo: null }).title,
    ];
    for (const title of titles) {
      expect(title).toMatch(/^[A-Z]/);
      expect(title).not.toMatch(/ticket a service ticket/);
    }
  });

  it("feasibility.expiring counts down and warns about the renewal", () => {
    const base = EVENTS["feasibility.expiring"];
    expect(describeEvent(base)).toEqual({
      title: "Feasibility expires in 7 days",
      body: `Anil Kumar — valid until ${formatDate("2026-01-31")}. Commission before then to avoid a ${formatCurrency(KSEB_FEES.feasibilityRenewalFee)} renewal.`,
      link: "/projects/pr-1",
      dedupeKey: "feasibility.expiring:pr-1:2026-01-31:d7",
    });
    expect(describeEvent({ ...base, daysLeft: 1, threshold: 1 }).title).toBe(
      "Feasibility expires in 1 day",
    );
    expect(describeEvent({ ...base, daysLeft: 0, threshold: 1 }).title).toBe(
      "Feasibility expires today",
    );
  });

  // the expiring body hard-codes "₹1,000" instead of
  // formatCurrency(KSEB_FEES.feasibilityRenewalFee). It drifts from the fee
  // constant if KSEB changes it, and already disagrees in format with the
  // "extended" alert for the same fee (formatCurrency renders "₹1,000.00").
  // Fix: build the sentence from formatCurrency(KSEB_FEES.feasibilityRenewalFee).
  it("feasibility.expiring prices the renewal from KSEB_FEES", () => {
    expect(describeEvent(EVENTS["feasibility.expiring"]).body).toContain(
      formatCurrency(KSEB_FEES.feasibilityRenewalFee),
    );
  });

  it("feasibility.extended states the renewals and BSS's cost", () => {
    expect(describeEvent(EVENTS["feasibility.extended"])).toEqual({
      title: `Feasibility renewed (1×) — BSS cost ${formatCurrency(1000)}`,
      body: `Anil Kumar — now valid until ${formatDate("2026-03-02")}.`,
      link: "/projects/pr-1",
      dedupeKey: "feasibility.extended:pr-1:2026-03-02",
    });
  });

  it("builds feasibility dedupe keys from project, validity window and threshold only", () => {
    const expiring = EVENTS["feasibility.expiring"];
    // Day-to-day changes inside one threshold window keep the key.
    expect(describeEvent({ ...expiring, daysLeft: 3 }).dedupeKey).toBe(
      describeEvent(expiring).dedupeKey,
    );
    // A new threshold, validity window or project is a new alert.
    const keys = new Set([
      describeEvent(expiring).dedupeKey,
      describeEvent({ ...expiring, threshold: 1, daysLeft: 1 }).dedupeKey,
      describeEvent({ ...expiring, validUntil: "2026-03-02", period: 2 }).dedupeKey,
      describeEvent({ ...expiring, projectId: "pr-2" }).dedupeKey,
    ]);
    expect(keys.size).toBe(4);

    // Each renewal opens a new window, so it is its own alert; within one
    // window the key does not depend on the renewal ordinal.
    const extended = EVENTS["feasibility.extended"];
    expect(describeEvent({ ...extended, validUntil: "2026-04-01", renewals: 2 }).dedupeKey).not.toBe(
      describeEvent(extended).dedupeKey,
    );
    expect(describeEvent({ ...extended, renewals: 5 }).dedupeKey).toBe(
      describeEvent(extended).dedupeKey,
    );
  });
});

describe("feasibilityEvents", () => {
  const START = "2026-01-01";
  type FeasibilityProject = Parameters<typeof feasibilityEvents>[0];
  const project: FeasibilityProject = {
    projectId: "pr-1",
    coordinatorIds: ["coord-1"],
    clientName: "Anil Kumar",
    feasibilityDate: START,
    completedAt: null,
    isCompleted: false,
  };
  const on = (elapsed: number, overrides: Partial<FeasibilityProject> = {}) =>
    feasibilityEvents({ ...project, ...overrides }, addDays(START, elapsed));
  const types = (events: NotificationEvent[]) => events.map((e) => e.type);

  it("emits nothing without a feasibility date", () => {
    expect(on(30, { feasibilityDate: null })).toEqual([]);
  });

  it("emits nothing for a commissioned project, even one past its validity", () => {
    expect(on(59, { isCompleted: true, completedAt: "2026-02-28T06:00:00Z" })).toEqual([]);
    expect(on(59, { isCompleted: true })).toEqual([]);
  });

  it("emits nothing while more than 7 days are left", () => {
    expect(on(0)).toEqual([]);
    expect(on(22)).toEqual([]);
  });

  it("emits nothing for a future feasibility date", () => {
    expect(on(-20)).toEqual([]);
  });

  it("warns at the 7-day threshold from 7 down to 2 days left", () => {
    for (const elapsed of [23, 25, 28]) {
      const events = on(elapsed);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "feasibility.expiring",
        actorId: null,
        coordinatorIds: ["coord-1"],
        projectId: "pr-1",
        clientName: "Anil Kumar",
        daysLeft: 30 - elapsed,
        validUntil: "2026-01-31",
        period: 1,
        threshold: 7,
      });
    }
  });

  it("warns again at the final 1-day threshold, and on the last day", () => {
    for (const elapsed of [29, 30]) {
      const [event] = on(elapsed);
      expect(event).toMatchObject({
        type: "feasibility.expiring",
        threshold: FEASIBILITY_FINAL_WARNING_DAYS,
        daysLeft: 30 - elapsed,
      });
    }
  });

  it("announces a renewal once the first period lapses", () => {
    const events = on(31);
    expect(events).toEqual([
      {
        type: "feasibility.extended",
        actorId: null,
        coordinatorIds: ["coord-1"],
        projectId: "pr-1",
        clientName: "Anil Kumar",
        renewals: 1,
        validUntil: "2026-03-02",
        extensionCost: 1000,
      },
    ]);
  });

  it("keeps announcing a renewal for 3 days, so a missed daily run still sends it", () => {
    for (const elapsed of [31, 32, 33, 34]) {
      expect(types(on(elapsed))).toEqual(["feasibility.extended"]);
    }
    expect(on(35)).toEqual([]);
    // Every later renewal is news on its own day too.
    expect(on(61)).toEqual([expect.objectContaining({ type: "feasibility.extended", renewals: 2 })]);
    expect(on(91)).toEqual([expect.objectContaining({ type: "feasibility.extended", renewals: 3 })]);
  });

  // An onboarding import brings in projects whose feasibility was issued months
  // ago; the first daily run must not turn each old renewal into a push.
  it("never announces a renewal that started more than 3 days ago", () => {
    for (const elapsed of [45, 66, 75, 140, 200]) {
      expect(types(on(elapsed))).not.toContain("feasibility.extended");
    }
    expect(on(75)).toEqual([]);
  });

  it("warns before a renewed period lapses without re-announcing the renewal", () => {
    const events = on(59);
    expect(types(events)).toEqual(["feasibility.expiring"]);
    expect(events[0]).toMatchObject({ period: 2, daysLeft: 1, threshold: 1 });
  });

  it("produces stable dedupe keys across daily re-runs", () => {
    const keys = (elapsed: number) => on(elapsed).map((e) => describeEvent(e).dedupeKey);
    // Same day twice → identical.
    expect(keys(25)).toEqual(keys(25));
    // Within the 7-day window → same key every day.
    expect(keys(23)).toEqual(keys(28));
    // Crossing into the final warning → a new key.
    expect(keys(29)).not.toEqual(keys(28));
    // The 1-day and last-day alerts share a key (one final reminder only).
    expect(keys(30)).toEqual(keys(29));
    // While a renewal is announced its "extended" key is constant.
    expect(keys(31)).toEqual(keys(34));
  });

  // The office will correct feasibility dates (likely right after the bulk
  // import). Keys are built from the validity WINDOW, not its ordinal, so the
  // corrected window's alerts never collide with the old window's rows in
  // UNIQUE (recipient_id, dedupe_key) — e.g. a date moved from 1 Jan to 10 Jan
  // must still get the 7-day warning for its new 9 Feb expiry.
  it("a corrected feasibility date gets fresh alerts", () => {
    const key = (feasibilityDate: string, today: string) =>
      feasibilityEvents({ ...project, feasibilityDate }, today).map(
        (e) => describeEvent(e).dedupeKey,
      );
    const original = key("2026-01-01", "2026-01-24"); // valid until 31 Jan
    const corrected = key("2026-01-10", "2026-02-02"); // valid until 9 Feb
    expect(original).toHaveLength(1);
    expect(corrected).toHaveLength(1);
    expect(corrected).not.toEqual(original);
  });

  it("only emits events whose recipients are the coordinator and the office", () => {
    for (let elapsed = 0; elapsed <= 120; elapsed++) {
      for (const event of on(elapsed)) {
        expect(event.actorId).toBeNull();
        expect(audienceFor(event)).toEqual({ office: true, users: ["coord-1"] });
      }
    }
  });

  it("reaches every coordinator of a shared sale, each alert once", () => {
    const team = ["coord-1", "coord-2"];
    for (const elapsed of [25, 31]) {
      const events = on(elapsed, { coordinatorIds: team });
      expect(events).toHaveLength(1);
      expect(audienceFor(events[0])).toEqual({ office: true, users: team });
      // One alert, one dedupe key: the recipients are the rows, not the events.
      expect(describeEvent(events[0]).dedupeKey).toEqual(expect.any(String));
    }
  });

  describe("cancelled and refunded projects", () => {
    it.each(["cancelled", "refunded"] as const)(
      "emits nothing for a %s project, however far past its validity",
      (cancellation) => {
        for (const elapsed of [25, 29, 31, 59, 120]) {
          expect(on(elapsed, { cancellation, cancelledOn: addDays(START, 10) })).toEqual([]);
          // …nor when the date was never recorded.
          expect(on(elapsed, { cancellation, cancelledOn: null })).toEqual([]);
        }
      },
    );

    it("emits nothing for a project with a cancellation date alone", () => {
      expect(on(29, { cancelledOn: addDays(START, 5) })).toEqual([]);
    });

    it("still warns for a live project whose fields are null", () => {
      expect(types(on(29, { cancellation: null, cancelledOn: null }))).toEqual([
        "feasibility.expiring",
      ]);
    });
  });
});
