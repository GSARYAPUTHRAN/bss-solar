// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkOrder } from "@/lib/types";

vi.mock("@/components/work-orders/use-desktop", () => ({ useIsDesktop: () => false }));

import { WorkOrderForm } from "./work-order-form";

const DIRECTORY = [
  { id: "admin-id", full_name: "BSS Admin", role: "admin" as const },
  { id: "rahul-id", full_name: "Rahul Menon", role: "coordinator" as const },
  { id: "priya-id", full_name: "Priya Suresh", role: "coordinator" as const },
];

const RAHUL = { id: "rahul-id", full_name: "Rahul Menon", role: "coordinator" as const };
const ADMIN = { id: "admin-id", full_name: "BSS Admin", role: "admin" as const };

const SOLAR = {
  id: "wo-1",
  client_name: "Anand Kumar",
  plan_type: "solar",
  plant_capacity: "3kW",
  order_date: "2026-09-01",
  total_cost: 195000,
  advance_amount: 20000,
  financing_type: "self",
  coordinators: [{ id: "rahul-id", full_name: "Rahul Menon", sort_order: 1, incentive: null }],
  project: null,
} as unknown as WorkOrder;

function renderForm(props: Partial<React.ComponentProps<typeof WorkOrderForm>> = {}) {
  return render(
    <WorkOrderForm
      action={() => {}}
      cancelHref="/work-orders"
      submitLabel="Create Work Order"
      loadingText="Creating…"
      {...props}
    />,
  );
}

describe("WorkOrderForm — a new work order", () => {
  it("lets a coordinator add partners, starting as themself", () => {
    renderForm({ team: { directory: DIRECTORY, viewer: RAHUL } });
    expect(screen.getByRole("group", { name: "Coordinators" })).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add partner" })).toBeInTheDocument();
    expect(screen.getByText(/Sold together\? Add your partners/)).toBeInTheDocument();
    expect(
      document.querySelector('input[name="coordinator_ids"]'),
    ).toHaveAttribute("value", "rahul-id");
  });

  it("lets the office log it for anyone, starting as itself", () => {
    renderForm({ team: { directory: DIRECTORY, viewer: ADMIN } });
    expect(screen.getByText("BSS Admin (me)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add coordinator" })).toBeInTheDocument();
    expect(screen.getByText(/the first is the coordinator who logged it/)).toBeInTheDocument();
  });

  it("starts as a solar plant, with a plan to choose", () => {
    renderForm({ team: { directory: DIRECTORY, viewer: RAHUL } });
    expect(screen.getByRole("radio", { name: "Solar plant" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Custom plan" })).not.toBeChecked();
    expect(screen.getByLabelText(/plant capacity/i)).toHaveAttribute("name", "plant_capacity");
    expect(screen.getByLabelText(/client name/i)).toBeRequired();
    expect(screen.getByLabelText(/total cost/i)).toBeRequired();
    expect(screen.getByLabelText(/order date/i)).toBeInTheDocument();
  });
});

describe("WorkOrderForm — editing", () => {
  it("has no coordinators to pick: changing the team is its own action", () => {
    renderForm({ workOrder: SOLAR, submitLabel: "Save Changes" });
    expect(screen.queryByRole("group", { name: "Coordinators" })).not.toBeInTheDocument();
    expect(document.querySelector('input[name="coordinator_ids"]')).toBeNull();
    expect(document.querySelector('input[name="id"]')).toHaveAttribute("value", "wo-1");
  });

  it("lets the plan change while the order has no project", () => {
    renderForm({ workOrder: SOLAR });
    expect(screen.getByRole("radio", { name: "Solar plant" })).toBeChecked();
    expect(screen.getByLabelText(/plant capacity/i)).toHaveValue("3kW");
  });

  it("fixes the plan once a project exists, and says so", () => {
    renderForm({
      workOrder: {
        ...SOLAR,
        plan_type: "custom",
        plant_capacity: "Inverter + panel",
        project: {
          id: "proj-1",
          current_stage: "plant_commissioning",
          is_completed: false,
          cancellation: null,
        },
      },
    });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Custom plan — fixed once the project has started\./),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/what was sold/i)).toHaveValue("Inverter + panel");
    expect(document.querySelector('input[name="plan_type"]')).toHaveAttribute("value", "custom");
  });

  it("shows the money read-only to a coordinator once the office has reviewed the order", () => {
    renderForm({ workOrder: SOLAR, contractTermsLocked: true });
    expect(screen.getByLabelText(/total cost/i)).toHaveAttribute("readonly");
    expect(document.querySelector('input[name="total_cost"]')).toBeNull();
  });
});
