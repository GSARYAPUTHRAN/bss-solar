// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import type { ProjectListRow } from "@/lib/types";
import { ProjectBoardCard } from "./project-board-card";

const PROJECT: ProjectListRow = {
  id: "20000000-0000-0000-0000-000000000001",
  coordinator_id: "10000000-0000-0000-0000-000000000001",
  work_order_id: null,
  current_stage: "panel_installation",
  is_completed: false,
  created_at: "2026-09-01T04:30:00Z",
  started_at: "2026-09-01T04:30:00Z",
  completed_at: null,
  client_name: "Anand Kumar",
  client_phone: null,
  address: null,
  plant_capacity: "3kW",
  plant_capacity_kw: 3,
  total_cost: 195000,
  advance_amount: 20000,
  coordinator_name: "Rahul",
  milestones_done: 4,
  milestones_total: 8,
  consumer_number: null,
  kseb_section: null,
  financing_type: "self",
  loan_bank_name: null,
  payment_pending: false,
  feasibility_date: null,
  feasibility_periods: null,
  feasibility_renewals: null,
  feasibility_valid_until: null,
  feasibility_days_left: null,
  feasibility_extension_cost: 0,
  coordinator_incentive: 5000,
  incentive_paid_on: null,
  payments_total: 0,
  payment_count: 0,
  last_payment_on: null,
  amount_received: 20000,
  balance_due: 175000,
};

describe("ProjectBoardCard", () => {
  it("shows the coordinator incentive and whether it is paid", () => {
    render(<ProjectBoardCard project={PROJECT} showCoordinator={false} />);
    const line = screen.getByText("Incentive").parentElement;
    expect(line).toHaveTextContent(formatCurrency(5000));
    expect(line).toHaveTextContent("Pending");
  });

  it("leaves the incentive out when none is set", () => {
    render(
      <ProjectBoardCard
        project={{ ...PROJECT, coordinator_incentive: null }}
        showCoordinator={false}
      />,
    );
    expect(screen.queryByText("Incentive")).toBeNull();
  });
});
