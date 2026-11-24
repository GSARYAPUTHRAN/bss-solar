// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency, formatDate } from "@/lib/format";
import { COMPLETED_LIST_LIMIT, type CompletedService } from "@/lib/domain/service-report";
import { ServicesCompletedList } from "./services-completed-list";

function service(over: Partial<CompletedService> = {}): CompletedService {
  return {
    id: "30000000-0000-0000-0000-000000000001",
    ticketNo: "BSS-2611-1001",
    date: "2026-11-10",
    dateIsClosedDay: false,
    clientName: "Rajesh Babu",
    engineer: "Anil Kumar",
    engineerKind: "engineer",
    ticketType: "routine_6m",
    total: 1850,
    ...over,
  };
}

describe("ServicesCompletedList", () => {
  it("lists each visit with a link to its ticket", () => {
    render(<ServicesCompletedList services={[service()]} periodLabel="November 2026 (so far)" />);
    const link = screen.getByRole("link", { name: "BSS-2611-1001" });
    expect(link).toHaveAttribute("href", "/tickets/30000000-0000-0000-0000-000000000001");
    // Big enough to tap on a phone.
    expect(link).toHaveClass("min-h-10");

    const row = link.closest("tr") as HTMLElement;
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "BSS-2611-1001",
      formatDate("2026-11-10"),
      "Rajesh Babu",
      "Anil Kumar",
      "Routine 6-month",
      formatCurrency(1850),
    ]);
  });

  it("says when the date is the day the ticket was closed, and when there is no project", () => {
    render(
      <ServicesCompletedList
        services={[
          service({
            ticketNo: null,
            id: "abcdef12-0000",
            dateIsClosedDay: true,
            clientName: null,
            engineer: "Unassigned",
            engineerKind: "unassigned",
            ticketType: "adhoc",
          }),
        ]}
        periodLabel="All time"
      />,
    );
    // No ticket number yet: the id's start stands in, as elsewhere.
    expect(screen.getByRole("link", { name: "abcdef12" })).toBeInTheDocument();
    expect(screen.getByText("day closed")).toBeInTheDocument();
    expect(screen.getByText("No project linked")).toBeInTheDocument();
    expect(screen.getByText("Ad-hoc")).toBeInTheDocument();
  });

  it("says so when nothing was completed in the period", () => {
    render(<ServicesCompletedList services={[]} periodLabel="October 2026" />);
    expect(screen.getByText("No service visits completed in October 2026.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it(`shows at most ${COMPLETED_LIST_LIMIT} and points to the CSV for the rest`, () => {
    const many = Array.from({ length: COMPLETED_LIST_LIMIT + 7 }, (_, i) =>
      service({ id: `t${i}`, ticketNo: `BSS-${i}` }),
    );
    render(<ServicesCompletedList services={many} periodLabel="All time" />);
    expect(screen.getAllByRole("link")).toHaveLength(COMPLETED_LIST_LIMIT);
    expect(screen.getByRole("link", { name: "BSS-0" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: `BSS-${COMPLETED_LIST_LIMIT}` })).toBeNull();
    expect(
      screen.getByText(
        `Showing the latest ${COMPLETED_LIST_LIMIT} of ${COMPLETED_LIST_LIMIT + 7} visits. Download the CSV for the full list.`,
      ),
    ).toBeInTheDocument();
  });

  it("has no note when every visit is shown", () => {
    render(<ServicesCompletedList services={[service()]} periodLabel="All time" />);
    expect(screen.queryByText(/download the csv/i)).toBeNull();
  });
});
