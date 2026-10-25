// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import type { ProjectListRow } from "@/lib/types";
import { ProjectBoardCard } from "./project-board-card";
import {
  PENDING_INCENTIVE,
  PRIYA,
  RAHUL,
  projectListRow,
  sharedSale,
} from "./project-list-row.fixture";

/** The card as the office sees it unless a test says otherwise. */
function card(project: ProjectListRow, props: Partial<ComponentProps<typeof ProjectBoardCard>> = {}) {
  return <ProjectBoardCard project={project} showCoordinator viewerId={RAHUL} {...props} />;
}

describe("ProjectBoardCard — incentive", () => {
  it("shows the incentive total and whether it is paid", () => {
    render(card(projectListRow({ ...PENDING_INCENTIVE })));
    const line = screen.getByText("Incentive").parentElement;
    expect(line).toHaveTextContent(formatCurrency(5000));
    expect(line).toHaveTextContent("Pending");
  });

  it("words it as the coordinator's own for a coordinator", () => {
    render(card(projectListRow({ ...PENDING_INCENTIVE }), { showCoordinator: false }));
    expect(screen.getByText("Your incentive").parentElement).toHaveTextContent(
      formatCurrency(5000),
    );
    expect(screen.queryByText("Incentive")).toBeNull();
  });

  it("says Partly paid on a shared sale where only some have been paid", () => {
    render(
      card(
        sharedSale({
          incentive_total: 12000,
          incentive_unpaid: 6000,
          incentive_count: 2,
          incentive_unpaid_count: 1,
        }),
      ),
    );
    const line = screen.getByText("Incentive").parentElement;
    expect(line).toHaveTextContent(formatCurrency(12000));
    expect(line).toHaveTextContent("Partly paid");
  });

  it("leaves the incentive out when none is set", () => {
    render(card(projectListRow()));
    expect(screen.queryByText("Incentive")).toBeNull();
    expect(screen.queryByText("Your incentive")).toBeNull();
  });

  it("does not read the deprecated single-incentive columns", () => {
    render(card(projectListRow({ coordinator_incentive: 7000, incentive_paid_on: "2026-05-20" })));
    expect(screen.queryByText("Incentive")).toBeNull();
  });
});

describe("ProjectBoardCard — who is on the sale", () => {
  it("names everyone for the office", () => {
    render(card(sharedSale()));
    expect(screen.getByText("Rahul Menon & Priya Suresh")).toBeInTheDocument();
  });

  it("names the partners for a coordinator", () => {
    render(card(sharedSale(), { showCoordinator: false, viewerId: PRIYA }));
    expect(screen.getByText("with Rahul Menon")).toBeInTheDocument();
    expect(screen.queryByText(/Priya/)).toBeNull();
  });

  it("says nothing to a coordinator about a sale of their own", () => {
    render(card(projectListRow(), { showCoordinator: false }));
    expect(screen.queryByText(/Rahul/)).toBeNull();
    expect(screen.queryByText(/^with /)).toBeNull();
  });
});

describe("ProjectBoardCard — status", () => {
  it("badges a cancelled or refunded project", () => {
    const { rerender } = render(card(projectListRow({ cancellation: "cancelled" })));
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    rerender(card(projectListRow({ cancellation: "refunded" })));
    expect(screen.getByText("Refunded")).toBeInTheDocument();
  });

  it("badges nothing for a live solar project", () => {
    render(card(projectListRow()));
    expect(screen.queryByText("Cancelled")).toBeNull();
    expect(screen.queryByText("Refunded")).toBeNull();
    expect(screen.queryByText("Custom plan")).toBeNull();
  });

  it("badges a custom plan and shows what was sold", () => {
    render(
      card(
        projectListRow({
          plan_type: "custom",
          plant_capacity: "Inverter + panel",
          milestones_done: 0,
          milestones_total: 1,
        }),
      ),
    );
    expect(screen.getByText("Custom plan")).toBeInTheDocument();
    expect(screen.getByText(/Inverter \+ panel/)).toBeInTheDocument();
    expect(screen.getByText("0/1 milestone")).toBeInTheDocument();
  });

  it("marks a commissioned plant, and a custom plan as handed over", () => {
    const { rerender } = render(card(projectListRow({ is_completed: true })));
    expect(screen.getByLabelText("Commissioned")).toBeInTheDocument();
    rerender(card(projectListRow({ is_completed: true, plan_type: "custom" })));
    expect(screen.getByLabelText("Handed over")).toBeInTheDocument();
  });

  it("does not tick a commissioned project that was then refunded", () => {
    render(card(projectListRow({ is_completed: true, cancellation: "refunded" })));
    expect(screen.queryByLabelText("Commissioned")).toBeNull();
    expect(screen.getByText("Refunded")).toBeInTheDocument();
  });

  it("flags a payment pending on a commissioned plant", () => {
    render(card(projectListRow({ is_completed: true, payment_pending: true })));
    expect(screen.getByText(/Payment pending/)).toBeInTheDocument();
  });

  it("never flags a payment pending on a refunded project", () => {
    render(
      card(
        projectListRow({ is_completed: true, payment_pending: true, cancellation: "refunded" }),
      ),
    );
    expect(screen.queryByText(/Payment pending/)).toBeNull();
  });

  it("links to the project", () => {
    render(card(projectListRow()));
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/projects/20000000-0000-0000-0000-000000000001",
    );
  });
});
