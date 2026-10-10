// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import type { ProjectListRow } from "@/lib/types";
import { ProjectsTable } from "./projects-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/loading/loading-context", () => ({ useLoading: () => ({ trackStart: vi.fn() }) }));

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

/** The client cell: on a phone the only column shown, carrying the summary. */
function clientCell(client: string): HTMLElement {
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes(client));
  if (!row) throw new Error(`no row for ${client}`);
  return within(row).getAllByRole("cell")[0];
}

describe("ProjectsTable — phone summary", () => {
  it("shows each project's coordinator incentive and its state", () => {
    render(
      <ProjectsTable
        projects={[
          PROJECT,
          {
            ...PROJECT,
            id: "20000000-0000-0000-0000-000000000002",
            client_name: "Meera Nair",
            coordinator_incentive: 8000,
            incentive_paid_on: "2026-05-20",
          },
          {
            ...PROJECT,
            id: "20000000-0000-0000-0000-000000000003",
            client_name: "Sreeja Pillai",
            coordinator_incentive: null,
          },
        ]}
        coordinators={[]}
        isAdmin={false}
      />,
    );

    const pending = clientCell("Anand Kumar");
    expect(within(pending).getByText("Incentive")).toBeInTheDocument();
    expect(within(pending).getByText(formatCurrency(5000))).toBeInTheDocument();
    expect(within(pending).getByText("Pending")).toBeInTheDocument();

    const paid = clientCell("Meera Nair");
    expect(within(paid).getByText(formatCurrency(8000))).toBeInTheDocument();
    expect(within(paid).getByText(/^Paid /)).toBeInTheDocument();

    // No incentive set: no empty "Incentive —" line on the card.
    expect(within(clientCell("Sreeja Pillai")).queryByText("Incentive")).toBeNull();
  });
});
