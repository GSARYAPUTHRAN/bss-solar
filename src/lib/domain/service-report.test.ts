import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";
import {
  ALL_TIME,
  COMPLETED_LIST_LIMIT,
  MAX_PICKER_MONTHS,
  SERVICES_CSV_HEADER,
  UNASSIGNED_KEY,
  addMonths,
  buildServiceReport,
  cancelledOn,
  completedOn,
  completedServices,
  completedTrend,
  earliestServiceMonth,
  inPeriod,
  isMonthKey,
  isOverdue,
  monthLabel,
  parseServicePeriod,
  periodLabel,
  periodOptions,
  periodParam,
  servicesCsv,
  servicesCsvFilename,
  summarizeByEngineer,
  trendMonths,
  type ServiceEngineerRef,
  type ServicePeriod,
  type ServiceTicketFact,
} from "./service-report";

const TODAY = "2026-11-24";
const NOV: ServicePeriod = { kind: "month", month: "2026-11" };
const OCT: ServicePeriod = { kind: "month", month: "2026-10" };
const ALL: ServicePeriod = { kind: "all" };

const ANIL: ServiceEngineerRef = { id: "e-anil", name: "Anil Kumar" };
const VINEETH: ServiceEngineerRef = { id: "e-vineeth", name: "Vineeth Nair" };
const ENGINEERS = [VINEETH, ANIL];

let seq = 0;
function ticket(over: Partial<ServiceTicketFact> = {}): ServiceTicketFact {
  seq += 1;
  return {
    id: `t${String(seq).padStart(3, "0")}`,
    ticketNo: `BSS-2611-${1000 + seq}`,
    ticketType: "routine_6m",
    status: "completed",
    engineerId: ANIL.id,
    engineerName: ANIL.name,
    clientName: "Rajesh Babu",
    scheduledDate: null,
    serviceDate: "2026-11-10",
    total: 1500,
    createdAt: "2026-11-01T04:30:00Z",
    updatedAt: "2026-11-10T06:00:00Z",
    ...over,
  };
}

/** An instant that is `iso` 00:30 IST — still the previous day in UTC. */
function justAfterIstMidnight(iso: string): string {
  return new Date(`${iso}T00:30:00+05:30`).toISOString();
}

describe("months", () => {
  it("knows a month key", () => {
    expect(isMonthKey("2026-11")).toBe(true);
    expect(isMonthKey("2026-1")).toBe(false);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-11-01")).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
    expect(isMonthKey(202611)).toBe(false);
  });

  it("adds months across year ends, both ways", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", -11)).toBe("2025-12");
    expect(addMonths("2026-11", -24)).toBe("2024-11");
    expect(addMonths("2026-11", 0)).toBe("2026-11");
  });

  it("lists the 12 months ending at a month, oldest first", () => {
    expect(trendMonths("2026-11")).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(trendMonths("2024-03", 3)).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("labels the current month as so far, others plainly", () => {
    expect(monthLabel("2026-11", TODAY)).toBe("November 2026 (so far)");
    expect(monthLabel("2026-10", TODAY)).toBe("October 2026");
    expect(periodLabel(ALL, TODAY)).toBe("All time");
    expect(periodLabel(OCT, TODAY)).toBe("October 2026");
  });
});

describe("parseServicePeriod", () => {
  it("defaults to the current IST month", () => {
    expect(parseServicePeriod(undefined, TODAY)).toEqual(NOV);
    expect(parseServicePeriod("", TODAY)).toEqual(NOV);
  });

  it("takes 'all' and any real past month", () => {
    expect(parseServicePeriod(ALL_TIME, TODAY)).toEqual(ALL);
    expect(parseServicePeriod("2026-10", TODAY)).toEqual(OCT);
    expect(parseServicePeriod("2024-02", TODAY)).toEqual({ kind: "month", month: "2024-02" });
    expect(parseServicePeriod("2026-11", TODAY)).toEqual(NOV);
  });

  it("falls back to the current month for anything else", () => {
    for (const value of ["2026-12", "2027-01", "2026-13", "nov", "2026-11-01", "1999-12", "ALL", 5]) {
      expect(parseServicePeriod(value, TODAY)).toEqual(NOV);
    }
  });

  it("uses the IST month on the first of a month", () => {
    expect(parseServicePeriod(undefined, "2026-12-01")).toEqual({ kind: "month", month: "2026-12" });
    expect(parseServicePeriod("2026-12", "2026-11-30")).toEqual({ kind: "month", month: "2026-11" });
  });

  it("round-trips through the URL value and names the CSV file", () => {
    expect(periodParam(OCT)).toBe("2026-10");
    expect(periodParam(ALL)).toBe("all");
    expect(servicesCsvFilename(OCT)).toBe("bss-services-2026-10.csv");
    expect(servicesCsvFilename(ALL)).toBe("bss-services-all.csv");
  });
});

describe("completedOn / cancelledOn / isOverdue / inPeriod", () => {
  it("counts a completed visit on its service date", () => {
    expect(completedOn(ticket({ serviceDate: "2026-10-31" }))).toBe("2026-10-31");
  });

  it("falls back to the IST day the ticket was last updated", () => {
    // 2026-10-31T19:00Z is 1 Nov 00:30 in India: November, not October.
    const t = ticket({ serviceDate: null, updatedAt: justAfterIstMidnight("2026-11-01") });
    expect(t.updatedAt.startsWith("2026-10-31")).toBe(true);
    expect(completedOn(t)).toBe("2026-11-01");
  });

  it("ignores a malformed service date", () => {
    const t = ticket({ serviceDate: "2026-02-30", updatedAt: "2026-03-02T06:00:00Z" });
    expect(completedOn(t)).toBe("2026-03-02");
  });

  it("is nothing for a ticket that is not completed, or has no readable date", () => {
    for (const status of ["open", "scheduled", "in_progress", "cancelled"] as const) {
      expect(completedOn(ticket({ status }))).toBeNull();
    }
    expect(completedOn(ticket({ serviceDate: null, updatedAt: "garbage" }))).toBeNull();
  });

  it("counts a cancellation on the IST day it was last updated", () => {
    expect(
      cancelledOn(ticket({ status: "cancelled", updatedAt: justAfterIstMidnight("2026-12-01") })),
    ).toBe("2026-12-01");
    expect(cancelledOn(ticket({ status: "completed" }))).toBeNull();
  });

  it("is overdue only while active and past its scheduled date", () => {
    expect(isOverdue({ status: "scheduled", scheduledDate: "2026-11-23" }, TODAY)).toBe(true);
    expect(isOverdue({ status: "in_progress", scheduledDate: "2026-11-01" }, TODAY)).toBe(true);
    expect(isOverdue({ status: "open", scheduledDate: "2025-01-01" }, TODAY)).toBe(true);
    // Due today is not overdue yet.
    expect(isOverdue({ status: "scheduled", scheduledDate: TODAY }, TODAY)).toBe(false);
    expect(isOverdue({ status: "open", scheduledDate: null }, TODAY)).toBe(false);
    expect(isOverdue({ status: "completed", scheduledDate: "2026-11-01" }, TODAY)).toBe(false);
    expect(isOverdue({ status: "cancelled", scheduledDate: "2026-11-01" }, TODAY)).toBe(false);
  });

  it("matches a date to a month or to all time", () => {
    expect(inPeriod("2026-11-01", NOV)).toBe(true);
    expect(inPeriod("2026-10-31", NOV)).toBe(false);
    expect(inPeriod("2026-12-01", NOV)).toBe(false);
    expect(inPeriod("1999-01-01", ALL)).toBe(true);
    expect(inPeriod(null, ALL)).toBe(false);
  });
});

describe("summarizeByEngineer", () => {
  it("gives every engineer a row of zeros when there are no tickets", () => {
    const { rows, total } = summarizeByEngineer([], ENGINEERS, NOV, TODAY);
    expect(rows.map((r) => r.name)).toEqual(["Anil Kumar", "Vineeth Nair"]);
    for (const row of rows) {
      expect(row).toMatchObject({ completed: 0, charges: 0, openScheduled: 0, cancelled: 0 });
    }
    expect(total).toEqual({
      completed: 0,
      routine: 0,
      adhoc: 0,
      charges: 0,
      openScheduled: 0,
      inProgress: 0,
      overdue: 0,
      cancelled: 0,
    });
  });

  it("has no rows and zero totals with no engineers and no tickets", () => {
    expect(summarizeByEngineer([], [], NOV, TODAY)).toEqual({
      rows: [],
      total: expect.objectContaining({ completed: 0 }),
    });
  });

  it("counts completed visits by type and adds their charges, in the period only", () => {
    const tickets = [
      ticket({ ticketType: "routine_6m", total: 1850, serviceDate: "2026-11-01" }),
      ticket({ ticketType: "adhoc", total: 1200.5, serviceDate: "2026-11-30" }),
      ticket({ ticketType: "adhoc", total: 999, serviceDate: "2026-10-31" }),
      ticket({ ticketType: "routine_6m", total: 700, serviceDate: "2026-12-01" }),
    ];
    const { rows, total } = summarizeByEngineer(tickets, ENGINEERS, NOV, TODAY);
    const anil = rows.find((r) => r.key === ANIL.id);
    expect(anil).toMatchObject({ completed: 2, routine: 1, adhoc: 1, charges: 3050.5 });
    expect(total).toMatchObject({ completed: 2, routine: 1, adhoc: 1, charges: 3050.5 });
  });

  it("counts a completed visit with no service date on the IST day it was closed", () => {
    const late = ticket({ serviceDate: null, updatedAt: justAfterIstMidnight("2026-11-01") });
    expect(summarizeByEngineer([late], ENGINEERS, NOV, TODAY).total.completed).toBe(1);
    expect(summarizeByEngineer([late], ENGINEERS, OCT, TODAY).total.completed).toBe(0);
  });

  it("handles a leap day and the end of February", () => {
    const tickets = [
      ticket({ serviceDate: "2024-02-29" }),
      ticket({ serviceDate: "2024-03-01" }),
      ticket({ serviceDate: "2025-02-28" }),
    ];
    const feb2024: ServicePeriod = { kind: "month", month: "2024-02" };
    expect(summarizeByEngineer(tickets, ENGINEERS, feb2024, TODAY).total.completed).toBe(1);
    const feb2025: ServicePeriod = { kind: "month", month: "2025-02" };
    expect(summarizeByEngineer(tickets, ENGINEERS, feb2025, TODAY).total.completed).toBe(1);
  });

  it("counts cancellations in the period, never as completed or billed", () => {
    const tickets = [
      ticket({ status: "cancelled", total: 500, updatedAt: "2026-11-05T06:00:00Z" }),
      ticket({ status: "cancelled", updatedAt: "2026-10-05T06:00:00Z" }),
    ];
    const { total } = summarizeByEngineer(tickets, ENGINEERS, NOV, TODAY);
    expect(total).toMatchObject({ cancelled: 1, completed: 0, charges: 0 });
    expect(summarizeByEngineer(tickets, ENGINEERS, ALL, TODAY).total.cancelled).toBe(2);
  });

  it("counts open, scheduled, in-progress and overdue as they stand now, whatever the period", () => {
    const tickets = [
      ticket({ engineerId: VINEETH.id, status: "open", scheduledDate: null }),
      ticket({ engineerId: VINEETH.id, status: "scheduled", scheduledDate: "2026-11-30" }),
      ticket({ engineerId: VINEETH.id, status: "scheduled", scheduledDate: "2026-11-20" }),
      ticket({ engineerId: VINEETH.id, status: "in_progress", scheduledDate: "2025-06-01" }),
    ];
    for (const period of [NOV, OCT, ALL, { kind: "month", month: "2020-01" } as const]) {
      const vineeth = summarizeByEngineer(tickets, ENGINEERS, period, TODAY).rows.find(
        (r) => r.key === VINEETH.id,
      );
      expect(vineeth).toMatchObject({
        openScheduled: 3,
        inProgress: 1,
        overdue: 2,
        completed: 0,
      });
    }
  });

  it("adds an Unassigned row, last, only when it has something to show", () => {
    const loose = ticket({ engineerId: null, engineerName: null, serviceDate: "2026-11-02" });
    const { rows } = summarizeByEngineer([loose], ENGINEERS, NOV, TODAY);
    expect(rows.map((r) => r.key)).toEqual([ANIL.id, VINEETH.id, UNASSIGNED_KEY]);
    expect(rows.at(-1)).toMatchObject({ name: "Unassigned", kind: "unassigned", completed: 1 });

    // Completed in another month: nothing to show this month.
    expect(
      summarizeByEngineer([loose], ENGINEERS, OCT, TODAY).rows.map((r) => r.key),
    ).not.toContain(UNASSIGNED_KEY);
  });

  it("keeps a former engineer's visits under their name", () => {
    const former = ticket({ engineerId: "e-old", engineerName: "Suresh P", serviceDate: "2026-11-03" });
    const nameless = ticket({ engineerId: "e-gone", engineerName: null, serviceDate: "2026-11-03" });
    const { rows, total } = summarizeByEngineer([former, nameless], ENGINEERS, NOV, TODAY);
    expect(rows.find((r) => r.key === "e-old")).toMatchObject({
      name: "Suresh P",
      kind: "former",
      completed: 1,
    });
    expect(rows.find((r) => r.key === "e-gone")).toMatchObject({ name: "Former engineer" });
    expect(total.completed).toBe(2);
    // Nothing this month: no row.
    expect(
      summarizeByEngineer([former], ENGINEERS, OCT, TODAY).rows.find((r) => r.key === "e-old"),
    ).toBeUndefined();
  });

  it("uses the engineer's current name, not the one on the ticket", () => {
    const t = ticket({ engineerName: "Anil K (old name)" });
    const anil = summarizeByEngineer([t], ENGINEERS, NOV, TODAY).rows.find((r) => r.key === ANIL.id);
    expect(anil?.name).toBe("Anil Kumar");
  });

  it("ranks by completed visits, then name — Unassigned always last", () => {
    const engineers = [
      { id: "z", name: "zara" },
      { id: "a", name: "Arjun" },
      { id: "b", name: "Bindu" },
      { id: "c", name: "chitra" },
    ];
    const tickets = [
      ticket({ engineerId: "b" }),
      ticket({ engineerId: "b" }),
      ticket({ engineerId: "z" }),
      ticket({ engineerId: "c" }),
      ticket({ engineerId: null }),
      ticket({ engineerId: null }),
      ticket({ engineerId: null }),
    ];
    const names = summarizeByEngineer(tickets, engineers, NOV, TODAY).rows.map((r) => r.name);
    expect(names).toEqual(["Bindu", "chitra", "zara", "Arjun", "Unassigned"]);
  });

  it("makes the rows add up to the totals", () => {
    const tickets = [
      ticket({ engineerId: VINEETH.id, total: 0.1 }),
      ticket({ engineerId: VINEETH.id, total: 0.2 }),
      ticket({ engineerId: ANIL.id, ticketType: "adhoc", total: "250.25" as unknown as number }),
      ticket({ engineerId: null, status: "open" }),
      ticket({ engineerId: "e-old", engineerName: "Old", status: "cancelled", updatedAt: "2026-11-02T00:00:00Z" }),
      ticket({ engineerId: ANIL.id, status: "scheduled", scheduledDate: "2026-11-01" }),
    ];
    const { rows, total } = summarizeByEngineer(tickets, ENGINEERS, NOV, TODAY);
    const keys = ["completed", "routine", "adhoc", "openScheduled", "inProgress", "overdue", "cancelled"] as const;
    for (const key of keys) {
      expect(rows.reduce((sum, r) => sum + r[key], 0)).toBe(total[key]);
    }
    expect(total.charges).toBe(250.55);
    expect(rows.find((r) => r.key === VINEETH.id)?.charges).toBe(0.3);
  });

  it("bills a missing or unreadable total as nothing", () => {
    const tickets = [
      ticket({ total: null }),
      ticket({ total: Number.NaN }),
      ticket({ total: 100 }),
    ];
    expect(summarizeByEngineer(tickets, ENGINEERS, NOV, TODAY).total).toMatchObject({
      completed: 3,
      charges: 100,
    });
  });
});

describe("completedTrend", () => {
  it("counts completed visits per month for the 12 months ending at the selected one", () => {
    const tickets = [
      ticket({ serviceDate: "2026-11-02" }),
      ticket({ serviceDate: "2026-11-20", engineerId: VINEETH.id }),
      ticket({ serviceDate: "2026-10-31" }),
      ticket({ serviceDate: "2025-12-01" }),
      // Outside the window either side.
      ticket({ serviceDate: "2025-11-30" }),
      ticket({ serviceDate: "2026-12-01" }),
      // Not completed: never in the trend.
      ticket({ status: "cancelled", updatedAt: "2026-11-05T00:00:00Z" }),
      ticket({ status: "in_progress", serviceDate: "2026-11-05" }),
    ];
    const trend = completedTrend(tickets, ENGINEERS, "2026-11");
    expect(trend.months).toHaveLength(12);
    expect(trend.months[0]).toBe("2025-12");
    expect(trend.months[11]).toBe("2026-11");
    expect(trend.totals).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
    expect(trend.total).toBe(4);
    expect(trend.rows.map((r) => [r.name, r.total])).toEqual([
      ["Anil Kumar", 3],
      ["Vineeth Nair", 1],
    ]);
    expect(trend.rows[0].counts).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it("has a zero row for every engineer even with nothing in the window", () => {
    const trend = completedTrend([], ENGINEERS, "2026-11");
    expect(trend.rows.map((r) => r.total)).toEqual([0, 0]);
    expect(trend.totals.every((n) => n === 0)).toBe(true);
  });

  it("spans a year end and a leap February", () => {
    const tickets = [ticket({ serviceDate: "2024-02-29" }), ticket({ serviceDate: "2023-12-31" })];
    const trend = completedTrend(tickets, ENGINEERS, "2024-03", 4);
    expect(trend.months).toEqual(["2023-12", "2024-01", "2024-02", "2024-03"]);
    expect(trend.totals).toEqual([1, 0, 1, 0]);
  });

  it("adds Unassigned and former engineers only when they have visits in the window", () => {
    const tickets = [
      ticket({ engineerId: null, serviceDate: "2026-11-01" }),
      ticket({ engineerId: "e-old", engineerName: "Old Hand", serviceDate: "2024-01-01" }),
    ];
    const trend = completedTrend(tickets, ENGINEERS, "2026-11");
    expect(trend.rows.map((r) => r.name)).toEqual(["Anil Kumar", "Vineeth Nair", "Unassigned"]);
  });
});

describe("completedServices", () => {
  it("lists the period's completed visits, latest first, with who and what", () => {
    const tickets = [
      ticket({ id: "a", ticketNo: "BSS-2611-1001", serviceDate: "2026-11-02" }),
      ticket({ id: "b", ticketNo: "BSS-2611-1010", serviceDate: "2026-11-20", engineerId: VINEETH.id }),
      ticket({ id: "c", ticketNo: "BSS-2611-1009", serviceDate: "2026-11-20", ticketType: "adhoc" }),
      ticket({ id: "d", serviceDate: "2026-10-31" }),
      ticket({ id: "e", status: "open", serviceDate: "2026-11-21" }),
    ];
    const list = completedServices(tickets, ENGINEERS, NOV);
    expect(list.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(list[0]).toMatchObject({
      ticketNo: "BSS-2611-1010",
      date: "2026-11-20",
      dateIsClosedDay: false,
      engineer: "Vineeth Nair",
      engineerKind: "engineer",
      clientName: "Rajesh Babu",
      ticketType: "routine_6m",
      total: 1500,
    });
    expect(completedServices(tickets, ENGINEERS, ALL)).toHaveLength(4);
  });

  it("says when the date is the day the ticket was closed, and who held it", () => {
    const [s] = completedServices(
      [
        ticket({
          serviceDate: null,
          updatedAt: "2026-11-11T05:00:00Z",
          engineerId: null,
          clientName: null,
          total: null,
          ticketNo: null,
        }),
      ],
      ENGINEERS,
      NOV,
    );
    expect(s).toMatchObject({
      date: "2026-11-11",
      dateIsClosedDay: true,
      engineer: "Unassigned",
      engineerKind: "unassigned",
      clientName: null,
      ticketNo: null,
      total: 0,
    });
  });

  it("is empty when nothing was completed", () => {
    expect(completedServices([], ENGINEERS, NOV)).toEqual([]);
  });
});

describe("servicesCsv", () => {
  it("writes the header and one row per visit, re-readable cell for cell", () => {
    const list = completedServices(
      [
        ticket({ ticketNo: "BSS-2611-1001", clientName: 'Nair, "Kumar"', total: 1850.5 }),
        ticket({ ticketNo: null, ticketType: "adhoc", engineerId: null, clientName: null, total: null, serviceDate: "2026-11-01" }),
      ],
      ENGINEERS,
      NOV,
    );
    const parsed = parseCsv(servicesCsv(list));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.rows).toEqual([
      [...SERVICES_CSV_HEADER],
      ["BSS-2611-1001", "2026-11-10", 'Nair, "Kumar"', "Anil Kumar", "Routine 6-month", "1850.50"],
      ["", "2026-11-01", "", "Unassigned", "Ad-hoc", "0.00"],
    ]);
  });

  it("keeps a customer or engineer name typed as a formula from running in Excel", () => {
    const list = completedServices(
      [
        ticket({
          ticketNo: "BSS-2611-1001",
          clientName: '=HYPERLINK("http://evil.example","Open")',
          // No longer an engineer: the name as stored on the ticket.
          engineerId: "e-gone",
          engineerName: "@Joby",
          total: -150,
        }),
        ticket({ ticketNo: "BSS-2611-1002", clientName: "-Meera", engineerId: VINEETH.id, total: 900 }),
      ],
      ENGINEERS,
      NOV,
    );
    const parsed = parseCsv(servicesCsv(list));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.rows.slice(1)).toEqual([
      // The ticket number, date, type and total are written as they are.
      ["BSS-2611-1002", "2026-11-10", "'-Meera", "Vineeth Nair", "Routine 6-month", "900.00"],
      ["BSS-2611-1001", "2026-11-10", `'=HYPERLINK("http://evil.example","Open")`, "'@Joby", "Routine 6-month", "-150.00"],
    ]);
  });

  it("is the header alone for no visits, without a BOM", () => {
    const csv = servicesCsv([]);
    expect(csv).toBe("ticket_no,service_date,customer,engineer,type,total");
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe("earliestServiceMonth / periodOptions", () => {
  it("is the month of the first ticket raised, or of an earlier completed visit", () => {
    expect(earliestServiceMonth([])).toBeNull();
    expect(
      earliestServiceMonth([
        ticket({ createdAt: "2026-03-10T00:00:00Z", serviceDate: "2026-03-12" }),
        ticket({ createdAt: "2026-05-01T00:00:00Z", serviceDate: "2026-01-20" }),
      ]),
    ).toBe("2026-01");
    // Raised at 00:30 IST on 1 March — still February in UTC.
    expect(
      earliestServiceMonth([
        ticket({ status: "open", createdAt: justAfterIstMidnight("2026-03-01") }),
      ]),
    ).toBe("2026-03");
  });

  it("offers All time, then every month back to the first, newest first", () => {
    const options = periodOptions("2026-08", TODAY, NOV);
    expect(options).toEqual([
      { value: "all", label: "All time" },
      { value: "2026-11", label: "November 2026 (so far)" },
      { value: "2026-10", label: "October 2026" },
      { value: "2026-09", label: "September 2026" },
      { value: "2026-08", label: "August 2026" },
    ]);
  });

  it("offers just the current month and All time with no tickets", () => {
    expect(periodOptions(null, TODAY, NOV).map((o) => o.value)).toEqual(["all", "2026-11"]);
    expect(periodOptions(null, TODAY, ALL).map((o) => o.value)).toEqual(["all", "2026-11"]);
  });

  it("caps the list, but still lists a selected older month", () => {
    const options = periodOptions("2001-01", TODAY, { kind: "month", month: "2005-06" });
    const months = options.slice(1).map((o) => o.value);
    expect(months).toHaveLength(MAX_PICKER_MONTHS + 1);
    expect(months[0]).toBe("2026-11");
    expect(months[MAX_PICKER_MONTHS - 1]).toBe(addMonths("2026-11", -(MAX_PICKER_MONTHS - 1)));
    expect(months.at(-1)).toBe("2005-06");
  });

  it("never lists a future month", () => {
    expect(periodOptions("2027-01", TODAY, NOV).map((o) => o.value)).toEqual(["all", "2026-11"]);
  });
});

describe("buildServiceReport", () => {
  const tickets = [
    ticket({ serviceDate: "2026-11-02", total: 1850 }),
    ticket({ serviceDate: "2026-10-15", engineerId: VINEETH.id }),
    ticket({ status: "scheduled", scheduledDate: "2026-11-01", engineerId: VINEETH.id, serviceDate: null }),
    ticket({ createdAt: "2026-06-01T00:00:00Z", serviceDate: "2026-06-03" }),
  ];

  it("puts the month's summary, trend, list and picker together", () => {
    const report = buildServiceReport({ tickets, engineers: ENGINEERS, period: NOV, today: TODAY });
    expect(report.label).toBe("November 2026 (so far)");
    expect(report.total).toMatchObject({ completed: 1, charges: 1850, overdue: 1, openScheduled: 1 });
    expect(report.trend?.months.at(-1)).toBe("2026-11");
    expect(report.trend?.total).toBe(3);
    expect(report.completed).toHaveLength(1);
    expect(report.options[0].value).toBe("all");
    expect(report.options.at(-1)?.value).toBe("2026-06");
  });

  it("has no trend for all time, and counts every completed visit", () => {
    const report = buildServiceReport({ tickets, engineers: ENGINEERS, period: ALL, today: TODAY });
    expect(report.label).toBe("All time");
    expect(report.trend).toBeNull();
    expect(report.total.completed).toBe(3);
    expect(report.completed).toHaveLength(3);
  });

  it("keeps the whole completed list — the page caps what it shows, not the report", () => {
    const many = Array.from({ length: COMPLETED_LIST_LIMIT + 5 }, () =>
      ticket({ serviceDate: "2026-11-05" }),
    );
    const report = buildServiceReport({ tickets: many, engineers: ENGINEERS, period: NOV, today: TODAY });
    expect(report.completed).toHaveLength(COMPLETED_LIST_LIMIT + 5);
    expect(report.total.completed).toBe(COMPLETED_LIST_LIMIT + 5);
  });
});
