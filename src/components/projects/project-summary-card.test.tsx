// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { paymentSummary } from "@/lib/domain/payment";
import { formatCurrency } from "@/lib/format";
import type { SaleCoordinator } from "@/lib/types";
import type { ProjectDetail } from "@/server/data/projects.repository";
import { ProjectSummaryCard, type SummaryIncentive } from "./project-summary-card";

const TEAM: SaleCoordinator[] = [
  { id: "c1", full_name: "Ravi Kumar", sort_order: 1, incentive: null },
  { id: "c2", full_name: "Abhijith Nair", sort_order: 2, incentive: null },
];

function project(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    work_order_id: "wo1",
    current_stage: "material_dispatch",
    is_completed: false,
    started_at: "2026-08-01T05:00:00Z",
    completed_at: null,
    created_at: "2026-08-01T05:00:00Z",
    updated_at: "2026-08-01T05:00:00Z",
    feasibility_date: null,
    cancellation: null,
    cancelled_on: null,
    cancelled_by: null,
    cancellation_remarks: null,
    cancelled_by_name: null,
    coordinators: TEAM,
    milestones: [],
    work_order: {
      id: "wo1",
      coordinator_id: "c1",
      client_name: "Anand Kumar",
      client_phone: "9876543210",
      address: "Kochi",
      plant_capacity: "3kW",
      plan_type: "solar",
      plant_capacity_kw: 3,
      advance_amount: 20000,
      total_cost: 195000,
      order_date: "2026-08-01",
      status: "approved",
      consumer_number: null,
      notes: null,
      kseb_section: null,
      financing_type: "self",
      loan_bank_name: null,
      created_at: "2026-08-01T05:00:00Z",
      updated_at: "2026-08-01T05:00:00Z",
    },
    ...over,
  };
}

const SOURCE = { total_cost: 195000, advance_amount: 20000, payments_total: 100000 };

function renderCard(
  p: ProjectDetail,
  extra: { incentive?: SummaryIncentive; changeCoordinatorsHref?: string } = {},
) {
  return render(
    <ProjectSummaryCard
      project={p}
      payment={paymentSummary(SOURCE)}
      paymentSource={SOURCE}
      progress={{ done: 3, total: 9 }}
      {...extra}
    />,
  );
}

/** The <dd> paired with a <dt> label. */
function valueOf(label: string | RegExp): HTMLElement {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
}

describe("ProjectSummaryCard", () => {
  it("shows a live solar project: in progress, its stage, its capacity", () => {
    renderCard(project());
    expect(valueOf("Status")).toHaveTextContent("In Progress");
    expect(valueOf("Current stage")).toHaveTextContent("Material Dispatch");
    expect(valueOf("Progress")).toHaveTextContent("3/9");
    expect(valueOf("Capacity")).toHaveTextContent("3kW");
    expect(screen.queryByText("Plan", { selector: "dt" })).not.toBeInTheDocument();
  });

  it("lists everyone on the sale, first first", () => {
    renderCard(project());
    const names = Array.from(valueOf("Coordinators").querySelectorAll("[data-slot='badge']")).map(
      (b) => b.textContent,
    );
    expect(names).toEqual(["Ravi Kumar", "Abhijith Nair"]);
  });

  it("the office can go and change them; nobody else gets the link", () => {
    renderCard(project(), { changeCoordinatorsHref: "/work-orders/wo1#coordinators" });
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute(
      "href",
      "/work-orders/wo1#coordinators",
    );
  });

  it("has no Change link without a destination", () => {
    renderCard(project());
    expect(screen.queryByRole("link", { name: "Change" })).not.toBeInTheDocument();
  });

  it("a custom plan shows what was sold under 'Plan', its single step as Handover, and handed over when done", () => {
    const custom = project({ current_stage: "plant_commissioning", is_completed: true });
    custom.work_order = {
      ...custom.work_order!,
      plan_type: "custom",
      plant_capacity: "Inverter + panel",
      plant_capacity_kw: null,
    };
    renderCard(custom);

    expect(valueOf("Plan")).toHaveTextContent("Inverter + panel");
    expect(screen.queryByText("Capacity", { selector: "dt" })).not.toBeInTheDocument();
    expect(valueOf("Current stage")).toHaveTextContent("Handover");
    expect(valueOf("Status")).toHaveTextContent("Handed over");
  });

  it("a commissioned solar plant reads Commissioned", () => {
    renderCard(project({ is_completed: true, current_stage: "plant_commissioning" }));
    expect(valueOf("Status")).toHaveTextContent("Commissioned");
  });

  it("a refunded project says so, keeps the stage it reached, and owes nothing", () => {
    renderCard(project({ cancellation: "refunded", cancelled_on: "2026-10-01" }));
    expect(valueOf("Status")).toHaveTextContent("Refunded");
    expect(valueOf("Current stage")).toHaveTextContent("Material Dispatch");
    expect(valueOf("Payment")).toHaveTextContent("Nothing due — refunded");
  });

  describe("incentive", () => {
    it("none is shown unless the page says the viewer may see one", () => {
      renderCard(project());
      expect(screen.queryByText(/incentive/i)).not.toBeInTheDocument();
    });

    it("a coordinator sees their own, labelled as such", () => {
      renderCard(project(), { incentive: { view: "own", amount: 2750, paidOn: null } });
      const row = valueOf("Your incentive");
      expect(row).toHaveTextContent(formatCurrency(2750));
      expect(row).toHaveTextContent("Pending");
    });

    it("a coordinator with none set sees a dash", () => {
      renderCard(project(), { incentive: { view: "own", amount: null, paidOn: null } });
      expect(valueOf("Your incentive")).toHaveTextContent("—");
    });

    it("the office sees the whole sale's total and how far along it is", () => {
      renderCard(project(), { incentive: { view: "sale", total: 5500, count: 2, unpaidCount: 1 } });
      const row = valueOf("Incentives");
      expect(row).toHaveTextContent(formatCurrency(5500));
      expect(row).toHaveTextContent("Partly paid");
      expect(screen.queryByText("Your incentive")).not.toBeInTheDocument();
    });
  });
});
