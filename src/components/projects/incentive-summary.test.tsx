// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoordinatorIncentiveSummary, OfficeIncentiveTile } from "./incentive-summary";

describe("CoordinatorIncentiveSummary", () => {
  it("shows the totals in whole rupees so lakh-scale figures fit three across a phone", () => {
    render(
      <CoordinatorIncentiveSummary
        summary={{ projects: 30, pendingProjects: 12, total: 125000, paid: 50000, pending: 75000 }}
      />,
    );
    expect(screen.getByText("₹1,25,000")).toBeInTheDocument();
    expect(screen.getByText("₹50,000")).toBeInTheDocument();
    // Still the drill-down into the pending projects.
    expect(screen.getByRole("link", { name: /pending\s*₹75,000/i })).toHaveAttribute(
      "href",
      "/projects?view=list&incentive=pending",
    );
  });

  it("rounds paise to the nearest rupee", () => {
    render(
      <CoordinatorIncentiveSummary
        summary={{ projects: 1, pendingProjects: 1, total: 2750.5, paid: 0, pending: 2750.5 }}
      />,
    );
    expect(screen.getAllByText("₹2,751")).toHaveLength(2);
  });
});

describe("CoordinatorIncentiveSummary — drill-down", () => {
  it("counts a single project in the singular and has nothing to open when nothing is pending", () => {
    render(
      <CoordinatorIncentiveSummary
        summary={{ projects: 1, pendingProjects: 0, total: 5000, paid: 5000, pending: 0 }}
      />,
    );
    expect(screen.getByText("1 project")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("OfficeIncentiveTile", () => {
  it("shows what is still owed to everyone, linking to the pending list", () => {
    render(
      <OfficeIncentiveTile
        summary={{ projects: 9, pendingProjects: 4, total: 90000, paid: 50000, pending: 40000 }}
      />,
    );
    const tile = screen.getByRole("link", { name: /incentives pending/i });
    expect(tile).toHaveAttribute("href", "/projects?view=list&incentive=pending");
    expect(tile).toHaveTextContent("₹40,000");
    expect(tile).toHaveTextContent("All coordinators · 4 projects awaiting payment");
  });

  it("narrows to the coordinator the list is filtered to", () => {
    render(
      <OfficeIncentiveTile
        summary={{ projects: 2, pendingProjects: 1, total: 9000, paid: 4000, pending: 5000 }}
        coordinatorId="00000000-0000-0000-0000-000000000003"
        coordinatorName="Priya Suresh"
      />,
    );
    const tile = screen.getByRole("link", { name: /incentives pending/i });
    expect(tile).toHaveAttribute(
      "href",
      "/projects?view=list&incentive=pending&coordinator=00000000-0000-0000-0000-000000000003",
    );
    expect(tile).toHaveTextContent("Priya Suresh · 1 project awaiting payment");
  });
});

