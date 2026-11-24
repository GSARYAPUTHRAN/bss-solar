import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Services report's reads: every ticket and every engineer, a page of 1,000
 * at a time in a fixed order (PostgREST answers at most 1,000 rows), mapped to
 * the domain's shapes. A failed read throws rather than showing a report with
 * tickets missing.
 */

// The query chain, recorded: each call (from/select/eq/order/range) is kept and
// the chain resolves with whatever `pages` hands out next.
const db = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  pages: [] as { data: unknown; error: { code?: string; message: string } | null }[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      db.calls.push(["from", table]);
      const chain: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (resolve: (r: unknown) => unknown) =>
                resolve(db.pages.shift() ?? { data: [], error: null });
            }
            return (...args: unknown[]) => {
              db.calls.push([String(prop), ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  }),
}));

import {
  PAGE_SIZE,
  fetchAllPages,
  serviceReportRepository,
  toTicketFact,
} from "./service-report.repository";

const ROW = {
  id: "30000000-0000-0000-0000-000000000001",
  ticket_no: "BSS-2606-1001",
  ticket_type: "routine_6m",
  status: "completed",
  assigned_to: "e-anil",
  scheduled_date: "2026-11-05",
  service_date: "2026-11-05",
  total: "1850.00",
  created_at: "2026-11-01T04:30:00+00:00",
  updated_at: "2026-11-05T06:00:00+00:00",
  project: { work_order: { client_name: "Rajesh Babu" } },
  assignee: { full_name: "Anil Kumar" },
} as const;

function calls(name: string) {
  return db.calls.filter(([call]) => call === name);
}

beforeEach(() => {
  db.calls = [];
  db.pages = [];
});

describe("serviceReportRepository.tickets", () => {
  it("maps a ticket with its customer and engineer", async () => {
    db.pages = [{ data: [ROW], error: null }];
    expect(await serviceReportRepository.tickets()).toEqual([
      {
        id: ROW.id,
        ticketNo: "BSS-2606-1001",
        ticketType: "routine_6m",
        status: "completed",
        engineerId: "e-anil",
        engineerName: "Anil Kumar",
        clientName: "Rajesh Babu",
        scheduledDate: "2026-11-05",
        serviceDate: "2026-11-05",
        total: 1850,
        createdAt: ROW.created_at,
        updatedAt: ROW.updated_at,
      },
    ]);
    expect(calls("from")).toEqual([["from", "service_tickets"]]);
  });

  it("selects only what the report reads, including updated_at and the embeds", async () => {
    await serviceReportRepository.tickets();
    const [[, columns]] = calls("select") as [string, string][];
    for (const column of ["ticket_type", "status", "assigned_to", "service_date", "updated_at", "total"]) {
      expect(columns).toContain(column);
    }
    expect(columns).toContain("client_name");
    expect(columns).toContain("assignee:profiles!service_tickets_assigned_to_fkey(full_name)");
    expect(columns).not.toContain("*");
  });

  it("pages through more than 1,000 tickets in a fixed order", async () => {
    const row = (i: number) => ({ ...ROW, id: `t${i}` });
    db.pages = [
      { data: Array.from({ length: PAGE_SIZE }, (_, i) => row(i)), error: null },
      { data: Array.from({ length: PAGE_SIZE }, (_, i) => row(PAGE_SIZE + i)), error: null },
      { data: [row(2 * PAGE_SIZE)], error: null },
    ];
    const tickets = await serviceReportRepository.tickets();
    expect(tickets).toHaveLength(2 * PAGE_SIZE + 1);
    expect(new Set(tickets.map((t) => t.id)).size).toBe(2 * PAGE_SIZE + 1);
    expect(calls("range")).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
      ["range", 2000, 2999],
    ]);
    // A unique order, so no ticket repeats or goes missing between pages.
    expect(calls("order")).toEqual([
      ["order", "id", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["order", "id", { ascending: true }],
    ]);
  });

  it("stops at a range past the end when the tickets fill the last page exactly", async () => {
    db.pages = [
      { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ ...ROW, id: `t${i}` })), error: null },
      { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } },
    ];
    expect(await serviceReportRepository.tickets()).toHaveLength(PAGE_SIZE);
  });

  it("is empty with no tickets", async () => {
    db.pages = [{ data: [], error: null }];
    expect(await serviceReportRepository.tickets()).toEqual([]);
    expect(calls("range")).toHaveLength(1);
  });

  it("throws on a failed read instead of reporting from part of the tickets", async () => {
    db.pages = [
      { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ ...ROW, id: `t${i}` })), error: null },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ];
    await expect(serviceReportRepository.tickets()).rejects.toThrow(
      "Could not load service tickets: permission denied",
    );
  });
});

describe("toTicketFact", () => {
  it("reads both embed shapes PostgREST may return", () => {
    const asArrays = toTicketFact({
      ...ROW,
      project: [{ work_order: [{ client_name: "Meera Nair" }] }],
      assignee: [{ full_name: "Vineeth Nair" }],
    });
    expect(asArrays).toMatchObject({ clientName: "Meera Nair", engineerName: "Vineeth Nair" });
  });

  it("keeps nulls: no project, nobody assigned, no total", () => {
    expect(
      toTicketFact({
        ...ROW,
        assigned_to: null,
        project: null,
        assignee: null,
        total: null,
        service_date: null,
        scheduled_date: null,
        ticket_no: null,
      }),
    ).toMatchObject({
      ticketNo: null,
      engineerId: null,
      engineerName: null,
      clientName: null,
      scheduledDate: null,
      serviceDate: null,
      total: null,
    });
  });

  it("reads a numeric total sent as a number or a string, and drops garbage", () => {
    expect(toTicketFact({ ...ROW, total: 1200.5 }).total).toBe(1200.5);
    expect(toTicketFact({ ...ROW, total: "0.10" }).total).toBe(0.1);
    expect(toTicketFact({ ...ROW, total: "abc" }).total).toBeNull();
    expect(toTicketFact({ ...ROW, total: "" }).total).toBeNull();
  });
});

describe("serviceReportRepository.engineers", () => {
  it("reads every service engineer, paged and in a fixed order", async () => {
    db.pages = [
      {
        data: [
          { id: "e-anil", full_name: "Anil Kumar" },
          { id: "e-vineeth", full_name: "Vineeth Nair" },
        ],
        error: null,
      },
    ];
    expect(await serviceReportRepository.engineers()).toEqual([
      { id: "e-anil", name: "Anil Kumar" },
      { id: "e-vineeth", name: "Vineeth Nair" },
    ]);
    expect(calls("from")).toEqual([["from", "profiles"]]);
    expect(calls("eq")).toEqual([["eq", "role", "service_engineer"]]);
    expect(calls("order")).toEqual([["order", "id", { ascending: true }]]);
    expect(calls("range")).toEqual([["range", 0, 999]]);
  });

  it("throws when the engineers cannot be read", async () => {
    db.pages = [{ data: null, error: { message: "boom" } }];
    await expect(serviceReportRepository.engineers()).rejects.toThrow(
      "Could not load service engineers: boom",
    );
  });
});

describe("fetchAllPages", () => {
  it("fails a range error on the first page — only a later page can run past the end", async () => {
    await expect(
      fetchAllPages("things", async () => ({
        data: null,
        error: { code: "PGRST103", message: "Requested range not satisfiable" },
      })),
    ).rejects.toThrow("Could not load things");
  });

  it("reads a null page as empty", async () => {
    expect(await fetchAllPages("things", async () => ({ data: null, error: null }))).toEqual([]);
  });
});
