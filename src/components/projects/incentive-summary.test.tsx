// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoordinatorIncentiveSummary, OfficeIncentiveSummary } from "./incentive-summary";

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

  it("shows earned (agreed), paid and pending as the three tiles, paid being instalments", () => {
    render(
      <CoordinatorIncentiveSummary
        summary={{ projects: 2, pendingProjects: 1, total: 9000, paid: 6500, pending: 2500 }}
      />,
    );
    const tiles = screen.getByRole("region", { name: "Your incentives" });
    expect(tiles).toHaveTextContent(/earned\s*₹9,000/i);
    expect(tiles).toHaveTextContent(/paid\s*₹6,500/i);
    expect(tiles).toHaveTextContent(/pending\s*₹2,500/i);
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

describe("OfficeIncentiveSummary", () => {
  it("shows what was agreed, what is paid and what is still owed to everyone, linking to the pending list", () => {
    render(
      <OfficeIncentiveSummary
        summary={{ projects: 9, pendingProjects: 4, total: 90000, paid: 50000, pending: 40000 }}
      />,
    );
    const tiles = screen.getByRole("region", { name: "Coordinator incentives" });
    expect(tiles).toHaveTextContent(/incentives agreed\s*₹90,000/i);
    expect(tiles).toHaveTextContent(/incentives paid\s*₹50,000/i);
    const pending = screen.getByRole("link", { name: /incentives pending/i });
    expect(pending).toHaveAttribute("href", "/projects?view=list&incentive=pending");
    expect(pending).toHaveTextContent("₹40,000");
    expect(pending).toHaveTextContent("4 projects awaiting payment");
    expect(tiles).toHaveTextContent("All coordinators · 9 projects");
  });

  it("narrows to the coordinator the list is filtered to", () => {
    render(
      <OfficeIncentiveSummary
        summary={{ projects: 2, pendingProjects: 1, total: 9000, paid: 4000, pending: 5000 }}
        coordinatorId="00000000-0000-0000-0000-000000000003"
        coordinatorName="Priya Suresh"
      />,
    );
    const pending = screen.getByRole("link", { name: /incentives pending/i });
    expect(pending).toHaveAttribute(
      "href",
      "/projects?view=list&incentive=pending&coordinator=00000000-0000-0000-0000-000000000003",
    );
    expect(pending).toHaveTextContent("1 project awaiting payment");
    expect(screen.getByText("Priya Suresh · 2 projects")).toBeInTheDocument();
  });

  it("has nothing to open when nothing is owed", () => {
    render(
      <OfficeIncentiveSummary
        summary={{ projects: 3, pendingProjects: 0, total: 9000, paid: 9000, pending: 0 }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Incentives pending").parentElement).toHaveTextContent("₹0");
  });
});
