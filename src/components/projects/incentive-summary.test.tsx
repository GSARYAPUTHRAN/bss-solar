// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoordinatorIncentiveSummary } from "./incentive-summary";

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
