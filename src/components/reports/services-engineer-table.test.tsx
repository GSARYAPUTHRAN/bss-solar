// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import {
  emptyCounts,
  summarizeByEngineer,
  type EngineerServiceRow,
  type ServiceTicketFact,
} from "@/lib/domain/service-report";
import { ServicesEngineerTable } from "./services-engineer-table";

const TODAY = "2026-11-24";
const NOV = { kind: "month", month: "2026-11" } as const;

function ticket(over: Partial<ServiceTicketFact>): ServiceTicketFact {
  return {
    id: Math.random().toString(36).slice(2),
    ticketNo: null,
    ticketType: "routine_6m",
    status: "completed",
    engineerId: "e-anil",
    engineerName: "Anil Kumar",
    clientName: null,
    scheduledDate: null,
    serviceDate: "2026-11-10",
    total: 1000,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-10T00:00:00Z",
    ...over,
  };
}

const ENGINEERS = [
  { id: "e-anil", name: "Anil Kumar" },
  { id: "e-vineeth", name: "Vineeth Nair" },
  { id: "e-new", name: "Neethu S" },
];

const SUMMARY = summarizeByEngineer(
  [
    ticket({ total: 1850 }),
    ticket({ ticketType: "adhoc", total: 1200.5 }),
    ticket({ engineerId: "e-vineeth", status: "in_progress", serviceDate: null }),
    ticket({ engineerId: "e-vineeth", status: "scheduled", scheduledDate: "2026-11-01", serviceDate: null }),
    ticket({ engineerId: null, status: "open", serviceDate: null }),
    ticket({ engineerId: "e-old", engineerName: "Suresh P", total: 500 }),
    ticket({ status: "cancelled", updatedAt: "2026-11-12T00:00:00Z" }),
  ],
  ENGINEERS,
  NOV,
  TODAY,
);

function renderTable(rows: EngineerServiceRow[] = SUMMARY.rows, total = SUMMARY.total) {
  render(<ServicesEngineerTable rows={rows} total={total} />);
}

/** A row's cells (after its name), by column heading. */
function rowOf(name: string): Record<string, string> {
  const header = screen.getByRole("rowheader", { name: new RegExp(`^${name}`) });
  const row = header.closest("tr") as HTMLElement;
  const headings = screen
    .getAllByRole("columnheader")
    .map((h) => (h.textContent ?? "").replace("(now)", "").trim());
  const cells = within(row).getAllByRole("cell").map((c) => c.textContent ?? "");
  return Object.fromEntries(headings.slice(1).map((h, i) => [h, cells[i]]));
}

describe("ServicesEngineerTable", () => {
  it("has the period columns, then the now columns", () => {
    renderTable();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Engineer",
      "Completed",
      "Routine",
      "Ad-hoc",
      "Charges billed",
      "Open / scheduled(now)",
      "In progress(now)",
      "Overdue(now)",
      "Cancelled",
    ]);
  });

  it("shows each engineer's figures", () => {
    renderTable();
    expect(rowOf("Anil Kumar")).toEqual({
      Completed: "2",
      Routine: "1",
      "Ad-hoc": "1",
      "Charges billed": formatCurrency(3050.5),
      "Open / scheduled": "0",
      "In progress": "0",
      Overdue: "0",
      Cancelled: "1",
    });
    expect(rowOf("Vineeth Nair")).toMatchObject({
      Completed: "0",
      "Open / scheduled": "1",
      "In progress": "1",
      Overdue: "1",
    });
  });

  it("lists an engineer with nothing yet, as zeros", () => {
    renderTable();
    expect(rowOf("Neethu S")).toMatchObject({ Completed: "0", "Charges billed": formatCurrency(0) });
  });

  it("names a former engineer as such, and puts Unassigned last before the total", () => {
    renderTable();
    expect(screen.getByRole("rowheader", { name: /suresh p/i })).toHaveTextContent(
      "Suresh P(no longer an engineer)",
    );
    const names = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(names.at(-2)).toBe("Unassigned");
    expect(names.at(-1)).toBe("Total");
    expect(rowOf("Unassigned")).toMatchObject({ "Open / scheduled": "1", Completed: "0" });
  });

  it("totals every row", () => {
    renderTable();
    expect(rowOf("Total")).toEqual({
      Completed: "3",
      Routine: "2",
      "Ad-hoc": "1",
      "Charges billed": formatCurrency(3550.5),
      "Open / scheduled": "2",
      "In progress": "1",
      Overdue: "1",
      Cancelled: "1",
    });
  });

  it("flags overdue work", () => {
    renderTable();
    const vineeth = screen.getByRole("rowheader", { name: "Vineeth Nair" }).closest("tr") as HTMLElement;
    const overdue = within(vineeth).getAllByRole("cell")[6];
    expect(overdue).toHaveTextContent("1");
    expect(overdue).toHaveClass("text-destructive");
  });

  it("says so when there are no service engineers", () => {
    renderTable([], emptyCounts());
    expect(screen.getByText("No service engineers yet.")).toBeInTheDocument();
    expect(rowOf("Total")).toMatchObject({ Completed: "0" });
  });

  it("scrolls sideways inside its card on a phone, never the page", () => {
    renderTable();
    const container = screen.getByRole("table").parentElement as HTMLElement;
    expect(container).toHaveClass("overflow-x-auto");
    // The names stay in view while the figures scroll.
    expect(screen.getByRole("rowheader", { name: "Anil Kumar" })).toHaveClass("sticky");
  });
});
