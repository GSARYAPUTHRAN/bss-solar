// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import type { ReportData, ReportSale } from "@/lib/domain/reports";
import type { DashboardMetrics } from "@/server/data";

/**
 * The monthly report page: office only, the month from `?month=` (anything
 * invalid is the current month in India), the report's range read once, and
 * every section rendered from the same figures.
 */

const { requireAdmin, load, dashboard, dashboardOrThrow } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  load: vi.fn(),
  // The lenient read, zeros on failure: the dashboard's, never the report's.
  dashboard: vi.fn(),
  dashboardOrThrow: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/server/data", () => ({ metricsRepository: { dashboard, dashboardOrThrow } }));
vi.mock("@/server/data/reports.repository", () => ({ reportsRepository: { load } }));
vi.mock("@/lib/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format")>()),
  todayISO: () => "2026-11-24",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/reports",
}));

import MonthlyReportPage from "./page";

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

/** What the lenient `dashboard()` gives when the read fails. */
const ZEROS = Object.fromEntries(Object.keys(METRICS).map((key) => [key, 0])) as unknown as DashboardMetrics;

function sale(id: string, orderDate: string, totalCost: number, names: string[]): ReportSale {
  return {
    id,
    clientName: `Client ${id}`,
    orderDate,
    status: "approved",
    totalCost,
    capacityKw: 5,
    plan: "5kW",
    planType: "solar",
    advanceAmount: 0,
    advancePaidOn: null,
    advanceMethod: null,
    advanceReference: null,
    receivedToDate: 0,
    balanceDue: totalCost,
    coordinatorIds: names.map((n) => `id-${n}`),
    coordinatorNames: names,
    projectState: "active",
    financing: "self",
    loanBank: null,
  };
}

const DATA: ReportData = {
  sales: [
    sale("a", "2026-08-14", 100000, ["Sneha Das"]),
    sale("b", "2026-10-05", 200000, ["Rahul Menon"]),
    sale("c", "2026-11-03", 300000, ["Rahul Menon", "Priya Suresh"]),
  ],
  payments: [],
  projects: [],
  tickets: [],
  incentivePayments: [],
};

async function renderPage(month?: string | string[]) {
  const searchParams = Promise.resolve(month === undefined ? {} : { month });
  render(await MonthlyReportPage({ searchParams }));
}

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ id: "admin", role: "admin", full_name: "BSS Admin" });
  load.mockReset().mockResolvedValue(DATA);
  dashboard.mockReset().mockResolvedValue(ZEROS);
  dashboardOrThrow.mockReset().mockResolvedValue(METRICS);
});

describe("Reports page — access and the month", () => {
  it("is office only: nothing is read when the gate turns the user away", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(renderPage("2026-10")).rejects.toThrow("NEXT_REDIRECT");
    expect(load).not.toHaveBeenCalled();
    expect(dashboardOrThrow).not.toHaveBeenCalled();
    expect(dashboard).not.toHaveBeenCalled();
  });

  it("defaults to the current month in India, read from the last financial year on", async () => {
    await renderPage();
    expect(load).toHaveBeenCalledWith({ from: "2025-04-01", to: "2026-11-24" });
    expect(screen.getByTestId("report-comparing")).toHaveTextContent(
      "November 2026 so far (1–24 Nov 2026), compared day for day with 1–24 Oct 2026 and 1–24 Nov 2025.",
    );
  });

  it.each(["2026-13", "garbage", "2027-01"])("treats ?month=%s as the current month", async (month) => {
    await renderPage(month);
    expect(load).toHaveBeenCalledWith({ from: "2025-04-01", to: "2026-11-24" });
  });

  it("reports a past month whole", async () => {
    await renderPage("2026-10");
    expect(load).toHaveBeenCalledWith({ from: "2025-04-01", to: "2026-10-31" });
    expect(screen.getByTestId("report-comparing")).toHaveTextContent(
      "October 2026, compared with Sep 2026 and Oct 2025.",
    );
  });

  it("offers the months from the first sale to now", async () => {
    // Radix Select measures and scrolls; jsdom has neither.
    Element.prototype.scrollIntoView ??= vi.fn();
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.releasePointerCapture ??= vi.fn();
    await renderPage("2026-10");
    const picker = screen.getByRole("combobox", { name: "Month" });
    expect(picker).toHaveTextContent("October 2026");
    await userEvent.setup().click(picker);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "November 2026 (so far)",
      "October 2026",
      "September 2026",
      "August 2026",
    ]);
  });

  it("lets a read failure reach the error page instead of showing zeros", async () => {
    load.mockRejectedValue(new Error("Could not read sales for the report: timeout"));
    await expect(renderPage()).rejects.toThrow("Could not read sales for the report");
  });

  it("lets a failed 'As of today' read reach the error page too, never a snapshot of zeros", async () => {
    dashboardOrThrow.mockRejectedValue(
      new Error("Could not read the business figures: statement timeout"),
    );
    await expect(renderPage()).rejects.toThrow("Could not read the business figures");
    // The dashboard's lenient read (zeros on failure) is not what the report uses.
    expect(dashboard).not.toHaveBeenCalled();
  });
});

describe("Reports page — sections", () => {
  it("shows the headline figures for the month", async () => {
    await renderPage();
    const value = document.querySelector<HTMLElement>('[data-kpi="salesValue"]')!;
    // The headline is in whole rupees; the comparisons keep the paise.
    expect(value).toHaveTextContent(formatCurrencyWhole(300000));
    expect(value).not.toHaveTextContent(formatCurrency(300000));
    // 1–24 Oct had ₹2,00,000.
    expect(value).toHaveTextContent("▲ up 50.0% vs 1–24 Oct 2026");
  });

  it("splits a shared sale between its coordinators, with the total equal to the headline", async () => {
    await renderPage();
    const table = screen.getByRole("table", { name: "By coordinator" });
    const rows = within(table).getAllByRole("row");
    expect(rows.map((r) => r.querySelector("td")?.textContent).filter(Boolean)).toEqual([
      "Priya Suresh",
      "Rahul Menon",
      "Total",
    ]);
    expect(rows.at(-1)).toHaveTextContent(formatCurrency(300000));
  });

  it("has the collections, financial year, trend, snapshot and note", async () => {
    await renderPage();
    expect(screen.getByRole("table", { name: "Collections" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Financial year to date" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "12-month trend" })).getAllByRole("row")).toHaveLength(13);
    expect(screen.getByRole("link", { name: /active projects/i })).toHaveTextContent("14");
    expect(screen.getByRole("link", { name: /incentives pending/i })).toHaveTextContent(
      formatCurrency(17500),
    );
    expect(screen.getByText("How these numbers are counted")).toBeInTheDocument();
  });

  it("offers the PDF and the three CSVs", async () => {
    await renderPage();
    for (const name of ["Download PDF", "Sales (CSV)", "Collections (CSV)", "12-month trend (CSV)"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});
