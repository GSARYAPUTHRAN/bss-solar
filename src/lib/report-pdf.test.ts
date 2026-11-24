// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { jsPDF } from "jspdf";
import {
  buildMonthlyReport,
  reportPeriod,
  type ReportData,
  type ReportSale,
} from "./domain/reports";
import { buildReportDoc, downloadReportPdf, pdfMoney, pdfText } from "./report-pdf";

const TODAY = "2026-11-24";

// Every document's save() is recorded instead of run: under Node, jsPDF's save
// would write the file into the working directory.
const { saved } = vi.hoisted(() => ({ saved: [] as string[] }));
vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  function RecordingPdf(...args: ConstructorParameters<typeof actual.jsPDF>) {
    const doc = new actual.jsPDF(...args);
    doc.save = ((name: string) => {
      saved.push(name);
      return doc;
    }) as typeof doc.save;
    return doc;
  }
  return { ...actual, jsPDF: RecordingPdf, default: RecordingPdf };
});

function sale(i: number, overrides: Partial<ReportSale> = {}): ReportSale {
  return {
    id: `wo-${i}`,
    clientName: `Client ${i}`,
    orderDate: "2026-11-05",
    status: "approved",
    totalCost: 125000,
    capacityKw: 3,
    plan: "3kW",
    planType: "solar",
    advanceAmount: 10000,
    advancePaidOn: null,
    advanceMethod: null,
    advanceReference: null,
    receivedToDate: 10000,
    balanceDue: 115000,
    coordinatorIds: ["c-1"],
    coordinatorNames: ["Rahul Menon"],
    projectState: "active",
    financing: "self",
    loanBank: null,
    ...overrides,
  };
}

const DATA: ReportData = {
  sales: [
    sale(1),
    sale(2, { orderDate: "2026-10-05", totalCost: 62500 }),
    sale(3, { coordinatorIds: ["c-1", "c-2"], coordinatorNames: ["Rahul Menon", "Priya Suresh"] }),
  ],
  payments: [
    {
      workOrderId: "wo-1",
      paidOn: "2026-11-10",
      amount: 50000,
      purpose: "contract",
      paidByOffice: false,
      method: "upi",
      reference: null,
    },
    {
      workOrderId: "wo-1",
      paidOn: "2026-11-11",
      amount: 2500,
      purpose: "refund",
      paidByOffice: false,
      method: "bank_transfer",
      reference: null,
    },
  ],
  projects: [],
  tickets: [{ status: "completed", serviceDate: "2026-11-03", updatedAt: "2026-11-03T05:00:00Z" }],
  incentivePayments: [],
};

const SNAPSHOT = {
  activeProjects: 12,
  commissionedUnpaid: 2,
  outstandingAmount: 45000,
  incentivePending: 7000,
  openTickets: 3,
};

function report(data: ReportData = DATA, month = "2026-11") {
  return buildMonthlyReport(data, reportPeriod(month, TODAY), SNAPSHOT, TODAY);
}

/** The PDF's raw text (jsPDF does not compress by default). */
function pdfSource(doc: jsPDF): string {
  return doc.output();
}

describe("pdfText", () => {
  it("swaps what the standard fonts cannot print", () => {
    expect(pdfText("1–24 Nov 2026")).toBe("1-24 Nov 2026");
    expect(pdfText("₹1,25,000")).toBe("Rs. 1,25,000");
    expect(pdfText("▲ 12.5%")).toBe("+12.5%");
    expect(pdfText("▼ 3.0%")).toBe("-3.0%");
    expect(pdfText("Advances + contract − refunds")).toBe("Advances + contract - refunds");
    expect(pdfText("“new” — ‘x’…")).toBe('"new" - \'x\'...');
    expect(pdfText("2 cancelled · 1 refunded")).toBe("2 cancelled · 1 refunded");
    expect(pdfText("സോളാർ")).toBe("?????");
  });
});

describe("pdfMoney", () => {
  it("prints rupees as Rs. with Indian grouping and two decimals", () => {
    expect(pdfMoney(125000)).toBe("Rs. 1,25,000.00");
    expect(pdfMoney(0)).toBe("Rs. 0.00");
    expect(pdfMoney(-2500.5)).toBe("-Rs. 2,500.50");
    expect(pdfMoney(-0)).toBe("Rs. 0.00");
  });
});

describe("buildReportDoc", () => {
  it("is an A4 portrait document", () => {
    const doc = buildReportDoc(report());
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(595);
    expect(Math.round(doc.internal.pageSize.getHeight())).toBe(842);
  });

  it("prints every section with plain-font money and changes", () => {
    const text = pdfSource(buildReportDoc(report()));
    for (const heading of [
      "Headline figures",
      "Collections - 1-24 Nov 2026",
      "Financial year to date - FY 2026-27 vs FY 2025-26",
      "12-month trend",
      "By coordinator - 1-24 Nov 2026",
      "As of today \\(24 Nov 2026\\)",
      "How these numbers are counted",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("Monthly report - November 2026 \\(so far\\)");
    expect(text).toContain("Rs. 2,50,000.00"); // 1–24 Nov sales value
    expect(text).toContain("Net collected");
    expect(text).toContain("Rs. 67,500.00"); // ₹20,000 advances + ₹50,000 − ₹2,500
    expect(text).toContain("+300.0%"); // value vs 1–24 Oct (₹62,500)
    expect(text).toContain("Rs. 3,12,500.00"); // the financial year so far
    expect(text).toContain("Nov 2026 \\(so far\\)");
    expect(text).toContain("Page 1 of");
    expect(text).not.toMatch(/₹|▲|▼|–/);
  });

  it("builds an empty month without failing", () => {
    const empty = { sales: [], payments: [], projects: [], tickets: [], incentivePayments: [] };
    const text = pdfSource(buildReportDoc(report(empty, "2026-10")));
    expect(text).toContain("Monthly report - October 2026");
    expect(text).not.toContain("(so far)");
    expect(text).toContain("No sales or commissioning in this period.");
  });

  it("runs onto more pages with a long coordinator list and numbers them all", () => {
    const many = {
      ...DATA,
      sales: Array.from({ length: 80 }, (_, i) =>
        sale(i, { coordinatorIds: [`c-${i}`], coordinatorNames: [`Coordinator ${i}`] }),
      ),
    };
    const doc = buildReportDoc(report(many));
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    expect(pdfSource(doc)).toContain(`Page ${pages} of ${pages}`);
  });
});

describe("downloadReportPdf", () => {
  it("saves as bss-report-YYYY-MM.pdf", () => {
    downloadReportPdf(report(DATA, "2026-10"));
    expect(saved).toEqual(["bss-report-2026-10.pdf"]);
  });
});
