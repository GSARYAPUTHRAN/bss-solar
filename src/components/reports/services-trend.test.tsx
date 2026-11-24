// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { completedTrend, type ServiceTicketFact } from "@/lib/domain/service-report";
import { ServicesTrend } from "./services-trend";

const TODAY = "2026-11-24";

function done(serviceDate: string, engineerId: string | null = "e-anil"): ServiceTicketFact {
  return {
    id: `${serviceDate}-${engineerId}-${Math.random()}`,
    ticketNo: null,
    ticketType: "adhoc",
    status: "completed",
    engineerId,
    engineerName: null,
    clientName: null,
    scheduledDate: null,
    serviceDate,
    total: 0,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const ENGINEERS = [
  { id: "e-anil", name: "Anil Kumar" },
  { id: "e-vineeth", name: "Vineeth Nair" },
];

const TREND = completedTrend(
  [
    done("2026-11-02"),
    done("2026-11-03"),
    done("2026-11-04", "e-vineeth"),
    done("2026-10-10"),
    done("2025-12-31", null),
  ],
  ENGINEERS,
  "2026-11",
);

function table(name: string) {
  return screen.getByRole("table", { name });
}

describe("ServicesTrend — per month", () => {
  it("lists the 12 months, oldest first, the current one so far", () => {
    render(<ServicesTrend trend={TREND} today={TODAY} />);
    const months = within(table("Visits completed per month"))
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("December 2025");
    expect(months[11]).toBe("November 2026 (so far)");
  });

  it("shows each month's total with a bar against the busiest month", () => {
    render(<ServicesTrend trend={TREND} today={TODAY} />);
    const monthTable = table("Visits completed per month");
    const row = (month: string) =>
      within(monthTable).getByRole("rowheader", { name: month }).closest("tr") as HTMLElement;
    expect(within(row("November 2026 (so far)")).getAllByRole("cell")[0]).toHaveTextContent("3");
    expect(within(row("October 2026")).getAllByRole("cell")[0]).toHaveTextContent("1");

    const bars = screen.getAllByTestId("trend-bar");
    expect(bars).toHaveLength(12);
    expect(bars[11]).toHaveStyle({ width: "100%" });
    expect(bars[10].style.width).toMatch(/^33\.33/);
    expect(bars[5]).toHaveStyle({ width: "0%" });
  });

  it("draws empty bars, not broken ones, when nothing was completed", () => {
    const empty = completedTrend([], ENGINEERS, "2026-11");
    render(<ServicesTrend trend={empty} today={TODAY} />);
    for (const bar of screen.getAllByTestId("trend-bar")) {
      expect(bar).toHaveStyle({ width: "0%" });
    }
  });
});

describe("ServicesTrend — by engineer", () => {
  it("has a row per engineer with a count per month and a total", () => {
    render(<ServicesTrend trend={TREND} today={TODAY} />);
    const matrix = table("Visits completed per month, by engineer");
    const anil = within(matrix).getByRole("rowheader", { name: "Anil Kumar" }).closest("tr") as HTMLElement;
    const cells = within(anil).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "1", "2", "3"]);
  });

  it("heads each month short, with the full name on hover", () => {
    render(<ServicesTrend trend={TREND} today={TODAY} />);
    const matrix = table("Visits completed per month, by engineer");
    const headings = within(matrix).getAllByRole("columnheader");
    expect(headings[1]).toHaveTextContent("Dec2025");
    expect(headings[1]).toHaveAttribute("title", "December 2025");
    expect(headings[12]).toHaveAttribute("title", "November 2026 (so far)");
    expect(headings[13]).toHaveTextContent("Total");
  });

  it("includes Unassigned visits and totals every month", () => {
    render(<ServicesTrend trend={TREND} today={TODAY} />);
    const matrix = table("Visits completed per month, by engineer");
    const names = within(matrix).getAllByRole("rowheader").map((h) => h.textContent);
    expect(names).toEqual(["Anil Kumar", "Vineeth Nair", "Unassigned", "Total"]);
    const total = within(matrix).getByRole("rowheader", { name: "Total" }).closest("tr") as HTMLElement;
    expect(within(total).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "1", "3", "5",
    ]);
  });
});
