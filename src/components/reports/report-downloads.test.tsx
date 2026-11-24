// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  buildMonthlyReport,
  reportPeriod,
  type ReportData,
} from "@/lib/domain/reports";
import { ReportDownloads } from "./report-downloads";

const { downloadCsv, downloadReportPdf, toast } = vi.hoisted(() => ({
  downloadCsv: vi.fn(),
  downloadReportPdf: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("./download-file", () => ({ downloadCsv }));
vi.mock("@/lib/report-pdf", () => ({ downloadReportPdf }));
vi.mock("sonner", () => ({ toast }));

const DATA: ReportData = {
  sales: [
    {
      id: "wo-1",
      clientName: "Anand Kumar",
      orderDate: "2026-11-03",
      status: "approved",
      totalCost: 250000,
      capacityKw: 5,
      plan: "5kW",
      planType: "solar",
      advanceAmount: 25000,
      advancePaidOn: null,
      advanceMethod: "upi",
      advanceReference: null,
      receivedToDate: 25000,
      balanceDue: 225000,
      coordinatorIds: ["c-1"],
      coordinatorNames: ["Rahul Menon"],
      projectState: "active",
      financing: "self",
      loanBank: null,
    },
  ],
  payments: [],
  projects: [],
  tickets: [],
  incentivePayments: [],
};

const REPORT = buildMonthlyReport(
  DATA,
  reportPeriod("2026-11", "2026-11-24"),
  { activeProjects: 1, commissionedUnpaid: 0, outstandingAmount: 0, incentivePending: 0, openTickets: 0 },
  "2026-11-24",
);

beforeEach(() => {
  downloadCsv.mockClear();
  downloadReportPdf.mockReset();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("ReportDownloads", () => {
  it("downloads the sales CSV with the month in its name", async () => {
    render(<ReportDownloads report={REPORT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sales (CSV)" }));
    const [name, rows] = downloadCsv.mock.calls[0];
    expect(name).toBe("bss-sales-2026-11.csv");
    expect(rows[0][0]).toBe("order_date");
    expect(rows[1]).toContain("Anand Kumar");
  });

  it("downloads the collections CSV", async () => {
    render(<ReportDownloads report={REPORT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Collections (CSV)" }));
    const [name, rows] = downloadCsv.mock.calls[0];
    expect(name).toBe("bss-collections-2026-11.csv");
    expect(rows[1]).toEqual(["2026-11-03", "Anand Kumar", "advance", "UPI", "25000.00", ""]);
  });

  it("downloads the 12-month trend CSV", async () => {
    render(<ReportDownloads report={REPORT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "12-month trend (CSV)" }));
    const [name, rows] = downloadCsv.mock.calls[0];
    expect(name).toBe("bss-trend-2026-11.csv");
    expect(rows).toHaveLength(13);
    expect(rows[12][0]).toBe("2026-11");
  });

  it("builds the PDF only when asked, from the same report", async () => {
    render(<ReportDownloads report={REPORT} />);
    expect(downloadReportPdf).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(downloadReportPdf).toHaveBeenCalledWith(REPORT));
    expect(toast.success).toHaveBeenCalledWith("Report PDF downloaded");
  });

  it("says so when the PDF cannot be made, and can be tried again", async () => {
    downloadReportPdf.mockImplementation(() => {
      throw new Error("boom");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ReportDownloads report={REPORT} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not create the PDF. Please try again."),
    );
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
    error.mockRestore();
  });

  it("makes every button a 40px tap target on a phone", () => {
    render(<ReportDownloads report={REPORT} />);
    for (const button of screen.getAllByRole("button")) expect(button.className).toContain("h-10");
  });
});
