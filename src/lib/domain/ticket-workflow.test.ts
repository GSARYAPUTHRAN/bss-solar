import { describe, it, expect } from "vitest";
import {
  ACTIVE_TICKET_STATUSES,
  ENGINEER_TICKET_SCOPES,
  assignmentEvents,
  engineerActions,
  initialTicketStatus,
  isActiveTicket,
  isTicketStatus,
  parseEngineerScope,
  requiresAssignee,
  scheduleState,
  statusChangeError,
  ticketUpdateEvents,
  type TicketUpdate,
} from "./ticket-workflow";
import { audienceFor, resolveRecipients, type NotificationEvent } from "./notifications";
import { TICKET_STATUS } from "./status";
import type { TicketStatus } from "@/lib/types";

const ALL_STATUSES = Object.keys(TICKET_STATUS) as TicketStatus[];

describe("isActiveTicket", () => {
  it("is true while the ticket still needs work", () => {
    expect(ALL_STATUSES.filter(isActiveTicket)).toEqual([
      "open",
      "scheduled",
      "in_progress",
    ]);
  });
});

describe("isTicketStatus", () => {
  it("accepts every registered status", () => {
    for (const status of ALL_STATUSES) expect(isTicketStatus(status)).toBe(true);
  });
  it("rejects anything else, including prototype keys", () => {
    for (const value of ["", "done", "Completed", "toString", null, 3]) {
      expect(isTicketStatus(value)).toBe(false);
    }
  });
});

describe("engineerActions", () => {
  const targets = (status: TicketStatus) =>
    engineerActions(status).map((action) => action.to);

  it("offers Start work and Mark completed before work has begun", () => {
    expect(targets("open")).toEqual(["in_progress", "completed"]);
    expect(targets("scheduled")).toEqual(["in_progress", "completed"]);
    expect(engineerActions("scheduled").map((a) => a.label)).toEqual([
      "Start work",
      "Mark completed",
    ]);
  });

  it("offers only Mark completed once work is in progress", () => {
    expect(targets("in_progress")).toEqual(["completed"]);
  });

  it("offers nothing on a closed ticket", () => {
    expect(targets("completed")).toEqual([]);
    expect(targets("cancelled")).toEqual([]);
  });

  it("only ever targets the two statuses the database lets engineers set", () => {
    for (const status of ALL_STATUSES) {
      for (const to of targets(status)) {
        expect(["in_progress", "completed"]).toContain(to);
      }
    }
  });

  it("confirms completion but not starting work", () => {
    const [start, complete] = engineerActions("open");
    expect(start.confirm).toBe(false);
    expect(complete.confirm).toBe(true);
  });
});

describe("statusChangeError", () => {
  it("lets an engineer make exactly the moves their buttons offer", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const offered = engineerActions(from).some((a) => a.to === to);
        expect(statusChangeError("service_engineer", from, to) === null).toBe(
          offered,
        );
      }
    }
  });

  it("explains why an engineer cannot cancel or reopen", () => {
    expect(statusChangeError("service_engineer", "scheduled", "cancelled")).toMatch(
      /start work .* or mark it completed/i,
    );
    expect(statusChangeError("service_engineer", "completed", "in_progress")).toMatch(
      /closed/i,
    );
  });

  it("gives the office full control", () => {
    expect(statusChangeError("admin", "completed", "open")).toBeNull();
    expect(statusChangeError("superadmin", "open", "cancelled")).toBeNull();
  });

  it("rejects a no-op change for everyone", () => {
    expect(statusChangeError("admin", "open", "open")).not.toBeNull();
    expect(statusChangeError("service_engineer", "in_progress", "in_progress")).not.toBeNull();
  });

  it("never lets a coordinator move a ticket", () => {
    expect(statusChangeError("coordinator", "open", "in_progress")).toMatch(
      /only service engineers and the office/i,
    );
  });
});

describe("initialTicketStatus / requiresAssignee", () => {
  it("schedules a ticket that has a visit date", () => {
    expect(initialTicketStatus("2026-10-12")).toBe("scheduled");
    expect(initialTicketStatus(null)).toBe("open");
  });

  it("requires an engineer exactly while the ticket is active", () => {
    expect(ALL_STATUSES.filter(requiresAssignee)).toEqual([
      ...ACTIVE_TICKET_STATUSES,
    ]);
  });
});

describe("scheduleState", () => {
  const today = "2026-10-10";

  it("flags an overdue visit with the number of days late", () => {
    expect(scheduleState("scheduled", "2026-10-07", today)).toEqual({
      state: "overdue",
      days: 3,
    });
  });

  it("flags a visit due today", () => {
    expect(scheduleState("open", today, today)).toEqual({ state: "today", days: 0 });
  });

  it("counts down to an upcoming visit, across a month boundary", () => {
    expect(scheduleState("in_progress", "2026-11-02", today)).toEqual({
      state: "upcoming",
      days: 23,
    });
  });

  it("has nothing to say about closed tickets or missing dates", () => {
    expect(scheduleState("completed", "2026-10-01", today)).toBeNull();
    expect(scheduleState("cancelled", "2026-10-01", today)).toBeNull();
    expect(scheduleState("open", null, today)).toBeNull();
    expect(scheduleState("open", "not-a-date", today)).toBeNull();
  });
});

describe("assignmentEvents", () => {
  const base = {
    actorId: "office",
    ticketId: "t1",
    ticketNo: "BSS-2610-1001",
    clientName: "Anand Kumar",
    scheduledDate: "2026-10-12",
    status: "scheduled" as TicketStatus,
  };

  it("tells a newly assigned engineer about the ticket", () => {
    expect(
      assignmentEvents({ ...base, previousEngineerId: null, engineerId: "eng-1" }),
    ).toEqual([
      {
        type: "ticket.assigned",
        actorId: "office",
        engineerId: "eng-1",
        ticketId: "t1",
        ticketNo: "BSS-2610-1001",
        clientName: "Anand Kumar",
        scheduledDate: "2026-10-12",
      },
    ]);
  });

  it("on reassignment tells the previous engineer first, then the new one", () => {
    const events = assignmentEvents({
      ...base,
      previousEngineerId: "eng-1",
      engineerId: "eng-2",
    });
    expect(events.map((e) => e.type)).toEqual(["ticket.unassigned", "ticket.assigned"]);
    expect(events[0]).toMatchObject({ engineerId: "eng-1", ticketId: "t1" });
    expect(events[1]).toMatchObject({ engineerId: "eng-2", ticketId: "t1" });
  });

  it("tells only the previous engineer when the ticket is left unassigned", () => {
    const events = assignmentEvents({
      ...base,
      previousEngineerId: "eng-1",
      engineerId: null,
    });
    expect(events.map((e) => e.type)).toEqual(["ticket.unassigned"]);
  });

  it("is silent when the assignee did not change", () => {
    expect(
      assignmentEvents({ ...base, previousEngineerId: "eng-1", engineerId: "eng-1" }),
    ).toEqual([]);
  });

  it("is silent for closed tickets", () => {
    for (const status of ["completed", "cancelled"] as TicketStatus[]) {
      expect(
        assignmentEvents({
          ...base,
          status,
          previousEngineerId: "eng-1",
          engineerId: "eng-2",
        }),
      ).toEqual([]);
    }
  });
});

describe("ticketUpdateEvents", () => {
  /** An office edit of eng-1's scheduled ticket that, as given, changes nothing. */
  const unchanged: TicketUpdate = {
    actorId: "office",
    ticketId: "t1",
    ticketNo: "BSS-2610-1001",
    clientName: "Anand Kumar",
    previousStatus: "scheduled",
    status: "scheduled",
    previousScheduledDate: "2026-10-12",
    scheduledDate: "2026-10-12",
    previousEngineerId: "eng-1",
    engineerId: "eng-1",
  };
  const edit = (overrides: Partial<TicketUpdate>) =>
    ticketUpdateEvents({ ...unchanged, ...overrides });
  const reasons = (events: NotificationEvent[]) =>
    events.map((e) => (e.type === "ticket.updated" ? e.reason : e.type));

  it("tells the holding engineer when the office moves the visit", () => {
    expect(edit({ scheduledDate: "2026-10-15" })).toEqual([
      {
        type: "ticket.updated",
        actorId: "office",
        engineerId: "eng-1",
        ticketId: "t1",
        ticketNo: "BSS-2610-1001",
        clientName: "Anand Kumar",
        reason: "rescheduled",
        status: "scheduled",
        scheduledDate: "2026-10-15",
        stillAssigned: true,
      },
    ]);
  });

  it("counts a visit date set or cleared as a reschedule", () => {
    expect(
      reasons(edit({ previousStatus: "open", previousScheduledDate: null })),
    ).toEqual(["rescheduled"]);
    expect(reasons(edit({ status: "open", scheduledDate: null }))).toEqual(["rescheduled"]);
  });

  it("tells the holding engineer about a cancellation", () => {
    for (const previousStatus of ACTIVE_TICKET_STATUSES) {
      expect(reasons(edit({ previousStatus, status: "cancelled" }))).toEqual(["cancelled"]);
    }
  });

  it("tells the holding engineer when a closed ticket is reopened", () => {
    for (const previousStatus of ["completed", "cancelled"] as TicketStatus[]) {
      expect(reasons(edit({ previousStatus, status: "open" }))).toEqual(["reopened"]);
    }
    // Reopened with a new visit date: still "reopened", and the date travels.
    const [event] = edit({ previousStatus: "completed", scheduledDate: "2026-11-02" });
    expect(event).toMatchObject({ reason: "reopened", scheduledDate: "2026-11-02" });
  });

  it("reports any other office status change, including completing it", () => {
    expect(reasons(edit({ status: "in_progress" }))).toEqual(["status_changed"]);
    expect(reasons(edit({ previousStatus: "in_progress", status: "open" }))).toEqual([
      "status_changed",
    ]);
    expect(reasons(edit({ status: "completed" }))).toEqual(["status_changed"]);
  });

  it("still tells the previous engineer when closing the ticket also unassigns it", () => {
    for (const status of ["cancelled", "completed"] as TicketStatus[]) {
      const events = edit({ status, engineerId: null });
      expect(events).toEqual([
        expect.objectContaining({
          type: "ticket.updated",
          engineerId: "eng-1",
          status,
          stillAssigned: false,
        }),
      ]);
    }
    // Closed and handed to someone else for the record: only eng-1 needs to know.
    expect(edit({ status: "cancelled", engineerId: "eng-2" })).toEqual([
      expect.objectContaining({ engineerId: "eng-1", reason: "cancelled", stillAssigned: false }),
    ]);
  });

  it("leaves a change of hands on an open ticket to the assignment events", () => {
    expect(
      edit({ engineerId: "eng-2", scheduledDate: "2026-10-15", status: "in_progress" }).map(
        (e) => [e.type, "engineerId" in e && e.engineerId],
      ),
    ).toEqual([
      ["ticket.unassigned", "eng-1"],
      ["ticket.assigned", "eng-2"],
    ]);
  });

  it("is silent when nothing the engineer acts on changed", () => {
    expect(edit({})).toEqual([]);
  });

  it("is silent about record keeping on a ticket that stays closed", () => {
    expect(edit({ previousStatus: "completed", status: "cancelled" })).toEqual([]);
    expect(
      edit({ previousStatus: "completed", status: "completed", scheduledDate: "2026-09-01" }),
    ).toEqual([]);
    expect(
      edit({ previousStatus: "completed", status: "completed", engineerId: "eng-2" }),
    ).toEqual([]);
  });

  it("is silent when nobody held the ticket", () => {
    expect(
      edit({ previousEngineerId: null, engineerId: null, previousStatus: "open", status: "cancelled" }),
    ).toEqual([]);
  });

  it("goes only to the engineer, and never back to whoever made the change", () => {
    const [event] = edit({ scheduledDate: "2026-10-15" });
    const officeIds = ["office", "admin-2"];
    expect(resolveRecipients(audienceFor(event), { officeIds, actorId: "office" })).toEqual([
      "eng-1",
    ]);
    expect(resolveRecipients(audienceFor(event), { officeIds, actorId: "eng-1" })).toEqual([]);
  });
});

describe("engineer worklist scopes", () => {
  it("defaults to the active scope for unknown or missing values", () => {
    expect(parseEngineerScope(undefined)).toBe("active");
    expect(parseEngineerScope("bogus")).toBe("active");
    expect(parseEngineerScope("constructor")).toBe("active");
    expect(parseEngineerScope("completed")).toBe("completed");
    expect(parseEngineerScope("all")).toBe("all");
  });

  it("covers active work, finished work and everything", () => {
    expect(ENGINEER_TICKET_SCOPES.active.statuses).toEqual(ACTIVE_TICKET_STATUSES);
    expect(ENGINEER_TICKET_SCOPES.completed.statuses).toEqual(["completed"]);
    expect(ENGINEER_TICKET_SCOPES.all.statuses).toBeNull();
  });

  it("lists pending visits soonest first and finished ones newest first", () => {
    expect(ENGINEER_TICKET_SCOPES.active).toMatchObject({
      sort: "scheduled_date",
      dir: "asc",
    });
    expect(ENGINEER_TICKET_SCOPES.completed).toMatchObject({
      sort: "service_date",
      dir: "desc",
    });
  });
});
