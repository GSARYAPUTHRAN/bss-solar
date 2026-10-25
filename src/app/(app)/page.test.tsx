// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardMetrics } from "@/server/data";

/**
 * The office dashboard: the KPI tiles read from `dashboard_metrics()` (cancelled
 * and refunded projects are out of the pipeline and get a tile of their own) and
 * the "recent" tables must not claim a total they do not hold.
 */

const METRICS: DashboardMetrics = {
  totalWorkOrders: 33,
  pendingApprovals: 2,
  activeProjects: 14,
  commissioned: 9,
  openTickets: 3,
  approvedPipeline: 4250000,
  commissionedUnpaid: 2,
  outstandingAmount: 120000,
  feasibilityExpiring: 1,
  feasibilityExtensionCost: 3000,
  incentivePending: 17500,
  cancelledProjects: 3,
  refundedProjects: 2,
};

const { dashboard, projectsTable, workOrdersTable } = vi.hoisted(() => ({
  dashboard: vi.fn(),
  projectsTable: vi.fn(),
  workOrdersTable: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: async () => ({ id: "admin", full_name: "BSS Admin", role: "admin" }),
}));
vi.mock("@/server/data", () => ({
  metricsRepository: { dashboard },
  profilesRepository: { coordinators: async () => [] },
  projectsRepository: { recent: async () => [{ id: "p1" }, { id: "p2" }] },
  workOrdersRepository: { recent: async () => [{ id: "w1" }] },
}));
vi.mock("@/components/work-orders-table", () => ({
  WorkOrdersTable: (props: { noun?: string }) => {
    workOrdersTable(props);
    return <div>work orders table</div>;
  },
}));
vi.mock("@/components/projects-table", () => ({
  ProjectsTable: (props: { noun?: string; projects: unknown[] }) => {
    projectsTable(props);
    return <div>projects table</div>;
  },
}));

import DashboardPage from "./page";

async function renderDashboard(metrics: Partial<DashboardMetrics> = {}) {
  dashboard.mockResolvedValue({ ...METRICS, ...metrics });
  render(await DashboardPage());
}

/** A KPI tile: its link (when it has one) or its card. */
function tile(label: RegExp): HTMLElement {
  const heading = screen.getByText(label, { selector: "p" });
  return heading.closest("a") ?? (heading.closest("[data-slot=card]") as HTMLElement);
}

beforeEach(() => {
  dashboard.mockReset();
  projectsTable.mockClear();
  workOrdersTable.mockClear();
});

describe("Dashboard — pipeline tiles", () => {
  it("counts the live projects only and says so", async () => {
    await renderDashboard();
    const active = tile(/^active projects$/i);
    expect(active).toHaveTextContent("14");
    expect(active).toHaveTextContent(/excludes cancelled and refunded/i);
  });

  it("says the approved pipeline leaves out cancelled and refunded projects", async () => {
    await renderDashboard();
    expect(tile(/^approved pipeline$/i)).toHaveTextContent(
      /excludes cancelled and refunded projects/i,
    );
  });

  it("has a tile for the projects that left the pipeline, linking to the closed list", async () => {
    await renderDashboard();
    const closed = tile(/^cancelled \/ refunded$/i);
    expect(closed).toHaveAttribute("href", "/projects?view=list&status=closed");
    expect(closed).toHaveTextContent("5");
    expect(closed).toHaveTextContent("3 cancelled · 2 refunded");
  });

  it("shows zero, not nothing, when no project has left the pipeline", async () => {
    await renderDashboard({ cancelledProjects: 0, refundedProjects: 0 });
    const closed = tile(/^cancelled \/ refunded$/i);
    expect(closed).toHaveTextContent("0");
    expect(closed).toHaveTextContent("0 cancelled · 0 refunded");
  });

  it("keeps the existing attention tiles and their links", async () => {
    await renderDashboard();
    expect(tile(/^commissioned · unpaid$/i)).toHaveAttribute(
      "href",
      "/projects?view=list&status=payment_pending",
    );
    expect(tile(/^incentives pending$/i)).toHaveAttribute(
      "href",
      "/projects?view=list&incentive=pending",
    );
  });
});

describe("Dashboard — recent tables", () => {
  it("never calls the latest work orders the total", async () => {
    await renderDashboard();
    expect(workOrdersTable).toHaveBeenCalledWith(
      expect.objectContaining({ noun: "latest work orders", viewerId: "admin", isAdmin: true }),
    );
  });

  it("never calls the latest projects the total", async () => {
    await renderDashboard();
    await userEvent.setup().click(screen.getByRole("tab", { name: /recent projects/i }));
    expect(projectsTable).toHaveBeenCalledWith(
      expect.objectContaining({ noun: "latest projects", viewerId: "admin", isAdmin: true }),
    );
  });

  it("links to the full lists with the real totals", async () => {
    await renderDashboard();
    expect(screen.getByRole("link", { name: /view all 33 work orders/i })).toHaveAttribute(
      "href",
      "/work-orders",
    );

    await userEvent.setup().click(screen.getByRole("tab", { name: /recent projects/i }));
    // Live, commissioned, cancelled and refunded: every project there is.
    expect(screen.getByRole("link", { name: /view all 28 projects/i })).toHaveAttribute(
      "href",
      "/projects",
    );
  });
});
