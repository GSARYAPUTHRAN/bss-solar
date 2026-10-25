// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import { ProjectTicketsSection, type ProjectTicket } from "./project-tickets-section";

const TICKETS: ProjectTicket[] = [
  {
    id: "t1",
    ticket_no: "BSS-2610-1001",
    ticket_type: "routine_6m",
    status: "completed",
    scheduled_date: "2026-10-02",
    total: 1500,
  },
  {
    id: "t2",
    ticket_no: null,
    ticket_type: "adhoc",
    status: "open",
    scheduled_date: null,
    total: null,
  },
];

describe("ProjectTicketsSection — office", () => {
  it("links each ticket, shows what it cost and offers a new one", () => {
    render(<ProjectTicketsSection projectId="p1" tickets={TICKETS} />);

    expect(screen.getByText("Service Tickets")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bss-2610-1001/i })).toHaveAttribute(
      "href",
      "/tickets/t1",
    );
    expect(screen.getByText(formatCurrency(1500))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new ticket/i })).toHaveAttribute(
      "href",
      "/tickets/new?project_id=p1",
    );
  });

  it("invites the first ticket when there are none", () => {
    render(<ProjectTicketsSection projectId="p1" tickets={[]} />);
    expect(screen.getByText("No service tickets yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new ticket/i })).toBeInTheDocument();
  });
});

describe("ProjectTicketsSection — read-only service history (the sale's coordinators)", () => {
  it("lists number, type, date and status — with nothing to open, raise or price", () => {
    render(<ProjectTicketsSection projectId="p1" tickets={TICKETS} readOnly />);

    expect(screen.getByText("Service History")).toBeInTheDocument();
    expect(screen.getByText("BSS-2610-1001")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();

    // /tickets is closed to coordinators: no links into it, no "New Ticket".
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new ticket/i })).not.toBeInTheDocument();
    // The service charge is the office's business.
    expect(screen.queryByText(formatCurrency(1500))).not.toBeInTheDocument();
  });

  it("says there have been no visits yet", () => {
    render(<ProjectTicketsSection projectId="p1" tickets={[]} readOnly />);
    expect(screen.getByText("No service visits yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
