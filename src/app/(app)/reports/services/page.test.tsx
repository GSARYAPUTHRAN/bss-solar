// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import type { ServiceTicketFact } from "@/lib/domain/service-report";

/**
 * The Services report page: office only, the period from `?month=` (the
 * current IST month by default, "all" for all time), the figures from the
 * domain module, and the trend only for a month.
 */

const { requireAdmin, tickets, engineers, csvButton } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  tickets: vi.fn(),
  engineers: vi.fn(),
  csvButton: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/server/data/service-report.repository", () => ({
  serviceReportRepository: { tickets, engineers },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/reports/services-csv-button", () => ({
  ServicesCsvButton: (props: { csv: string; filename: string }) => {
    csvButton(props);
    return <button type="button">Services (CSV)</button>;
  },
}));

import ServicesReportPage from "./page";

function ticket(over: Partial<ServiceTicketFact>): ServiceTicketFact {
  return {
    id: "t1",
    ticketNo: "BSS-2611-1001",
    ticketType: "routine_6m",
    status: "completed",
    engineerId: "e-anil",
    engineerName: "Anil Kumar",
    clientName: "Rajesh Babu",
    scheduledDate: null,
    serviceDate: "2026-11-10",
    total: 1850,
    createdAt: "2026-09-01T04:30:00Z",
    updatedAt: "2026-11-10T06:00:00Z",
    ...over,
  };
}

const TICKETS: ServiceTicketFact[] = [
  ticket({ id: "t1", ticketNo: "BSS-2611-1001", total: 1850 }),
  ticket({ id: "t2", ticketNo: "BSS-2611-1002", ticketType: "adhoc", total: 1200, engineerId: "e-vineeth" }),
  ticket({ id: "t3", ticketNo: "BSS-2610-1003", serviceDate: "2026-10-15", total: 900 }),
  ticket({
    id: "t4",
    ticketNo: "BSS-2611-1004",
    status: "scheduled",
    serviceDate: null,
    scheduledDate: "2026-11-20",
    engineerId: "e-vineeth",
  }),
  ticket({
    id: "t5",
    ticketNo: "BSS-2611-1005",
    status: "in_progress",
    serviceDate: null,
    scheduledDate: "2026-11-01",
  }),
];

async function renderPage(month?: string | string[]) {
  render(await ServicesReportPage({ searchParams: Promise.resolve(month ? { month } : {}) }));
}

/** A KPI tile by its label. */
function tile(label: string): HTMLElement {
  return screen.getByText(label, { selector: "p" }).closest("[data-slot=card]") as HTMLElement;
}

function engineerRow(name: string): string[] {
  const table = screen.getByRole("table", { name: "Service visits per engineer" });
  const row = within(table).getByRole("rowheader", { name: new RegExp(`^${name}`) }).closest("tr");
  return within(row as HTMLElement).getAllByRole("cell").map((c) => c.textContent ?? "");
}

beforeEach(() => {
  // 24 Nov 2026, 10:00 in India. Only Date is faked, so nothing else waits on timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T04:30:00Z"));
  requireAdmin.mockReset().mockResolvedValue({ id: "admin", full_name: "BSS Admin", role: "admin" });
  tickets.mockReset().mockResolvedValue(TICKETS);
  engineers.mockReset().mockResolvedValue([
    { id: "e-vineeth", name: "Vineeth Nair" },
    { id: "e-anil", name: "Anil Kumar" },
    { id: "e-neethu", name: "Neethu S" },
  ]);
  csvButton.mockClear();
});

afterEach(() => vi.useRealTimers());

describe("Services report — access", () => {
  it("is office only: nothing is read before the role check passes", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(ServicesReportPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(tickets).not.toHaveBeenCalled();
    expect(engineers).not.toHaveBeenCalled();
  });
});

describe("Services report — the current month by default", () => {
  it("heads the page with the month so far and picks it", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "Services · November 2026 (so far)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveTextContent(
      "November 2026 (so far)",
    );
  });

  it("shows the month's completed visits, by type, and the charges billed", async () => {
    await renderPage();
    expect(tile("Completed")).toHaveTextContent("2");
    expect(tile("Routine 6-month")).toHaveTextContent("1");
    expect(tile("Ad-hoc")).toHaveTextContent("1");
    expect(tile("Service charges billed")).toHaveTextContent(formatCurrency(3050));
  });

  it("shows what is open now, whatever the month", async () => {
    await renderPage("2026-10");
    expect(tile("Open + scheduled")).toHaveTextContent("1");
    expect(tile("In progress")).toHaveTextContent("1");
    expect(tile("Overdue")).toHaveTextContent("2");
  });

  it("has a row per engineer — one with no visits too — and a total", async () => {
    await renderPage();
    expect(engineerRow("Anil Kumar").slice(0, 4)).toEqual(["1", "1", "0", formatCurrency(1850)]);
    expect(engineerRow("Vineeth Nair").slice(0, 4)).toEqual(["1", "0", "1", formatCurrency(1200)]);
    expect(engineerRow("Neethu S")[0]).toBe("0");
    expect(engineerRow("Total").slice(0, 4)).toEqual(["2", "1", "1", formatCurrency(3050)]);
  });

  it("shows the 12-month trend ending at the month", async () => {
    await renderPage();
    expect(screen.getByText("Completed per month")).toBeInTheDocument();
    expect(screen.getByText("The 12 months to November 2026.")).toBeInTheDocument();
    const months = within(screen.getByRole("table", { name: "Visits completed per month" }))
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(months.at(-1)).toBe("November 2026 (so far)");
    expect(months.at(-2)).toBe("October 2026");
  });

  it("lists the month's completed visits with links to them", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "BSS-2611-1001" })).toHaveAttribute("href", "/tickets/t1");
    expect(screen.getByRole("link", { name: "BSS-2611-1002" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "BSS-2610-1003" })).toBeNull();
  });

  it("hands the month's visits to the CSV download, named for the month", async () => {
    await renderPage();
    const [{ csv, filename }] = csvButton.mock.calls.at(-1) as [{ csv: string; filename: string }];
    expect(filename).toBe("bss-services-2026-11.csv");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("ticket_no,service_date,customer,engineer,type,total");
    expect(lines).toHaveLength(3);
    expect(csv).toContain("BSS-2611-1001,2026-11-10,Rajesh Babu,Anil Kumar,Routine 6-month,1850.00");
  });

  it("explains how the numbers are counted", async () => {
    await renderPage();
    expect(screen.getByText("How these numbers are counted")).toBeInTheDocument();
  });
});

describe("Services report — another period", () => {
  it("reports a past month in full, without 'so far'", async () => {
    await renderPage("2026-10");
    expect(screen.getByRole("heading", { name: "Services · October 2026" })).toBeInTheDocument();
    expect(tile("Completed")).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "BSS-2610-1003" })).toBeInTheDocument();
    expect(csvButton).toHaveBeenLastCalledWith(
      expect.objectContaining({ filename: "bss-services-2026-10.csv" }),
    );
  });

  it("reports all time without a trend", async () => {
    await renderPage("all");
    expect(screen.getByRole("heading", { name: "Services · All time" })).toBeInTheDocument();
    expect(tile("Completed")).toHaveTextContent("3");
    expect(screen.queryByText("Completed per month")).toBeNull();
    expect(csvButton).toHaveBeenLastCalledWith(
      expect.objectContaining({ filename: "bss-services-all.csv" }),
    );
  });

  it("falls back to the current month for a bad or future month", async () => {
    for (const month of ["2026-13", "2027-01", "garbage"]) {
      const { unmount } = render(
        await ServicesReportPage({ searchParams: Promise.resolve({ month }) }),
      );
      expect(
        screen.getByRole("heading", { name: "Services · November 2026 (so far)" }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("takes the first ?month= when the URL repeats it", async () => {
    await renderPage(["2026-10", "all"]);
    expect(screen.getByRole("heading", { name: "Services · October 2026" })).toBeInTheDocument();
  });

  it("uses the India date: 00:30 IST on 1 December is December", async () => {
    vi.setSystemTime(new Date("2026-11-30T19:00:00Z"));
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "Services · December 2026 (so far)" }),
    ).toBeInTheDocument();
  });
});

describe("Services report — no data yet", () => {
  it("shows zeros, every engineer and an empty list rather than an error", async () => {
    tickets.mockResolvedValue([]);
    await renderPage();
    expect(tile("Completed")).toHaveTextContent("0");
    expect(tile("Service charges billed")).toHaveTextContent(formatCurrency(0));
    expect(engineerRow("Neethu S")[0]).toBe("0");
    expect(
      screen.getByText("No service visits completed in November 2026 (so far)."),
    ).toBeInTheDocument();
  });
});
