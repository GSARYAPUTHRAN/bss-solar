import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import {
  COLLECTIONS_CSV_HEADER,
  NO_COORDINATOR,
  REPORT_NOTES,
  SALES_CSV_HEADER,
  TREND_CSV_HEADER,
  addMonths,
  buildMonthlyReport,
  collectionLines,
  collectionsCsvRows,
  coordinatorTable,
  daysInMonth,
  earliestOrderMonth,
  formatGrowth,
  formatGrowthPlain,
  formatKw,
  fyComparison,
  fyLabel,
  fyStartOf,
  growth,
  headlineKpis,
  isMonthKey,
  monthLabel,
  monthShortLabel,
  parseReportMonth,
  periodFigures,
  prepareReportData,
  rangeLabel,
  reportFileName,
  reportMonthOptions,
  reportPeriod,
  saleLines,
  salesCsvRows,
  trendCsvRows,
  trendRows,
  type ReportData,
  type ReportIncentivePayment,
  type ReportPayment,
  type ReportProject,
  type ReportSale,
  type ReportSnapshot,
  type ReportTicket,
} from "./reports";

const TODAY = "2026-11-24";

let seq = 0;
function sale(overrides: Partial<ReportSale> = {}): ReportSale {
  seq += 1;
  return {
    id: `wo-${seq}`,
    clientName: `Client ${seq}`,
    orderDate: "2026-11-05",
    status: "approved",
    totalCost: 100000,
    capacityKw: 3,
    plan: "3kW",
    planType: "solar",
    advanceAmount: 0,
    advancePaidOn: null,
    advanceMethod: null,
    advanceReference: null,
    receivedToDate: 0,
    balanceDue: 100000,
    coordinatorIds: ["c-rahul"],
    coordinatorNames: ["Rahul Menon"],
    projectState: "active",
    financing: "self",
    loanBank: null,
    ...overrides,
  };
}

function payment(overrides: Partial<ReportPayment> = {}): ReportPayment {
  return {
    workOrderId: "wo-x",
    paidOn: "2026-11-10",
    amount: 1000,
    purpose: "contract",
    paidByOffice: false,
    method: "upi",
    reference: null,
    ...overrides,
  };
}

function project(overrides: Partial<ReportProject> = {}): ReportProject {
  return {
    workOrderId: "wo-x",
    isCompleted: true,
    completedAt: "2026-11-10T06:00:00Z",
    cancellation: null,
    cancelledOn: null,
    ...overrides,
  };
}

function ticket(overrides: Partial<ReportTicket> = {}): ReportTicket {
  return {
    status: "completed",
    serviceDate: "2026-11-12",
    updatedAt: "2026-11-12T06:00:00Z",
    ...overrides,
  };
}

function data(parts: Partial<ReportData> = {}): ReportData {
  return { sales: [], payments: [], projects: [], tickets: [], incentivePayments: [], ...parts };
}

const NOV = { from: "2026-11-01", to: "2026-11-30" };
const figures = (d: ReportData, w = NOV) => periodFigures(prepareReportData(d), w);

const SNAPSHOT: ReportSnapshot = {
  activeProjects: 12,
  commissionedUnpaid: 2,
  outstandingAmount: 45000,
  incentivePending: 7000,
  openTickets: 3,
};

// ---------------------------------------------------------------------------

describe("months", () => {
  it("knows month lengths, leap years included", () => {
    expect(daysInMonth("2026-01")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2100-02")).toBe(28);
    expect(daysInMonth("2000-02")).toBe(29);
    expect(daysInMonth("2026-04")).toBe(30);
  });

  it("moves across year ends both ways", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-11", -12)).toBe("2025-11");
    expect(addMonths("2026-03", -15)).toBe("2024-12");
    expect(addMonths("2026-03", 0)).toBe("2026-03");
  });

  it("validates YYYY-MM strictly", () => {
    expect(isMonthKey("2026-11")).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "", null, undefined]) {
      expect(isMonthKey(bad)).toBe(false);
    }
  });

  it("names months long and short", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(monthShortLabel("2026-09")).toBe("Sep 2026");
  });

  it("prints spans of days", () => {
    expect(rangeLabel("2026-11-01", "2026-11-24")).toBe("1–24 Nov 2026");
    expect(rangeLabel("2026-04-01", "2026-11-24")).toBe("1 Apr – 24 Nov 2026");
    expect(rangeLabel("2025-04-01", "2026-03-31")).toBe("1 Apr 2025 – 31 Mar 2026");
    expect(rangeLabel("2026-11-01", "2026-11-01")).toBe("1 Nov 2026");
  });
});

describe("parseReportMonth", () => {
  it("takes a real month up to the current one", () => {
    expect(parseReportMonth("2026-10", TODAY)).toBe("2026-10");
    expect(parseReportMonth("2026-11", TODAY)).toBe("2026-11");
    expect(parseReportMonth("2019-02", TODAY)).toBe("2019-02");
    expect(parseReportMonth(["2026-09", "2026-01"], TODAY)).toBe("2026-09");
  });

  it.each([undefined, "", "nope", "2026-13", "2026-1", "2026-11-01", "2026-12", "2031-01", "1999-12"])(
    "falls back to the current month for %j",
    (value) => {
      expect(parseReportMonth(value, TODAY)).toBe("2026-11");
    },
  );

  it("uses the India date it is given (the first of a month is already that month)", () => {
    expect(parseReportMonth(undefined, "2026-12-01")).toBe("2026-12");
  });
});

describe("financial year", () => {
  it("runs April to March", () => {
    expect(fyStartOf("2026-04-01")).toBe("2026-04-01");
    expect(fyStartOf("2026-03-31")).toBe("2025-04-01");
    expect(fyStartOf("2026-11-24")).toBe("2026-04-01");
    expect(fyStartOf("2027-01-15")).toBe("2026-04-01");
  });

  it("is named by its two years", () => {
    expect(fyLabel("2026-04-01")).toBe("FY 2026–27");
    expect(fyLabel("2099-04-01")).toBe("FY 2099–00");
  });
});

describe("reportPeriod", () => {
  it("cuts the current month and every comparison to the same days", () => {
    const p = reportPeriod("2026-11", TODAY);
    expect(p.soFar).toBe(true);
    expect(p.current).toEqual({ from: "2026-11-01", to: "2026-11-24", label: "1–24 Nov 2026" });
    expect(p.previous).toEqual({ from: "2026-10-01", to: "2026-10-24", label: "1–24 Oct 2026" });
    expect(p.lastYear).toEqual({ from: "2025-11-01", to: "2025-11-24", label: "1–24 Nov 2025" });
  });

  it("compares a past month whole with whole", () => {
    const p = reportPeriod("2026-10", TODAY);
    expect(p.soFar).toBe(false);
    expect(p.current).toEqual({ from: "2026-10-01", to: "2026-10-31", label: "Oct 2026" });
    expect(p.previous).toEqual({ from: "2026-09-01", to: "2026-09-30", label: "Sep 2026" });
    expect(p.lastYear).toEqual({ from: "2025-10-01", to: "2025-10-31", label: "Oct 2025" });
  });

  it("clamps the previous month to its length (31 March vs February)", () => {
    const p = reportPeriod("2026-03", "2026-03-31");
    expect(p.current.to).toBe("2026-03-31");
    expect(p.current.label).toBe("1–31 Mar 2026");
    expect(p.previous).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("handles leap days: 29 Feb against 28 Feb last year", () => {
    const p = reportPeriod("2028-02", "2028-02-29");
    expect(p.current.to).toBe("2028-02-29");
    expect(p.lastYear).toMatchObject({ from: "2027-02-01", to: "2027-02-28" });
    expect(p.previous).toMatchObject({ from: "2028-01-01", to: "2028-01-29" });
    expect(p.fyBase).toMatchObject({ from: "2026-04-01", to: "2027-02-28" });
  });

  it("compares a whole leap February with the whole February before", () => {
    const p = reportPeriod("2028-02", "2028-05-24");
    expect(p.current).toMatchObject({ from: "2028-02-01", to: "2028-02-29", label: "Feb 2028" });
    expect(p.lastYear).toMatchObject({ from: "2027-02-01", to: "2027-02-28", label: "Feb 2027" });
  });

  it("crosses the year end for January", () => {
    const p = reportPeriod("2027-01", "2027-01-10");
    expect(p.previous).toMatchObject({ from: "2026-12-01", to: "2026-12-10" });
    expect(p.lastYear).toMatchObject({ from: "2026-01-01", to: "2026-01-10" });
  });

  it("puts the financial year to the end of the window, against the same span a year back", () => {
    const p = reportPeriod("2026-11", TODAY);
    expect(p.fy).toEqual({ from: "2026-04-01", to: "2026-11-24", label: "1 Apr – 24 Nov 2026" });
    expect(p.fyBase).toEqual({ from: "2025-04-01", to: "2025-11-24", label: "1 Apr – 24 Nov 2025" });
    expect(p.fyName).toBe("FY 2026–27");
    expect(p.fyBaseName).toBe("FY 2025–26");
  });

  it("takes January to March into the year that began the April before", () => {
    const p = reportPeriod("2026-03", TODAY);
    expect(p.fy).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
    expect(p.fyBase).toMatchObject({ from: "2024-04-01", to: "2025-03-31" });
    expect(p.fyName).toBe("FY 2025–26");
  });

  it("reads from the earlier of the last financial year and the trend's first base month", () => {
    expect(reportPeriod("2026-11", TODAY).range).toEqual({ from: "2025-04-01", to: "2026-11-24" });
    expect(reportPeriod("2026-04", TODAY).range).toEqual({ from: "2025-04-01", to: "2026-04-30" });
    expect(reportPeriod("2026-03", TODAY).range).toEqual({ from: "2024-04-01", to: "2026-03-31" });
  });

  it("is a one-day window on the 1st", () => {
    const p = reportPeriod("2026-12", "2026-12-01");
    expect(p.current).toEqual({ from: "2026-12-01", to: "2026-12-01", label: "1 Dec 2026" });
    expect(p.previous).toMatchObject({ from: "2026-11-01", to: "2026-11-01" });
  });
});

describe("month options", () => {
  it("lists the earliest sale's month to now, newest first, the current one marked", () => {
    const options = reportMonthOptions("2026-08", TODAY, "2026-11");
    expect(options).toEqual([
      { value: "2026-11", label: "November 2026 (so far)" },
      { value: "2026-10", label: "October 2026" },
      { value: "2026-09", label: "September 2026" },
      { value: "2026-08", label: "August 2026" },
    ]);
  });

  it("is just the current month with no sales", () => {
    expect(reportMonthOptions(null, TODAY, "2026-11")).toEqual([
      { value: "2026-11", label: "November 2026 (so far)" },
    ]);
  });

  it("never lists months before 2000, whatever a mistyped order date says", () => {
    const options = reportMonthOptions("1926-11", "2000-02-10", "2000-02");
    expect(options.map((o) => o.value)).toEqual(["2000-02", "2000-01"]);
  });

  it("reaches back to a selected month older than any sale", () => {
    const options = reportMonthOptions("2026-10", TODAY, "2026-08");
    expect(options.map((o) => o.value)).toEqual(["2026-11", "2026-10", "2026-09", "2026-08"]);
  });

  it("finds the earliest order month (and none for no sales)", () => {
    expect(
      earliestOrderMonth([{ orderDate: "2026-03-02" }, { orderDate: "2025-12-31" }, { orderDate: "" }]),
    ).toBe("2025-12");
    expect(earliestOrderMonth([])).toBeNull();
  });
});

describe("growth", () => {
  it("is the change on the base, to one decimal", () => {
    expect(growth(120, 100)).toEqual({ kind: "change", pct: 20 });
    expect(growth(80, 100)).toEqual({ kind: "change", pct: -20 });
    expect(growth(1, 3)).toEqual({ kind: "change", pct: -66.7 });
    expect(growth(2, 3)).toEqual({ kind: "change", pct: -33.3 });
    expect(growth(100, 100)).toEqual({ kind: "change", pct: 0 });
  });

  it("rounds halves away from zero", () => {
    expect(growth(100.25, 100)).toEqual({ kind: "change", pct: 0.3 });
    expect(growth(99.75, 100)).toEqual({ kind: "change", pct: -0.3 });
  });

  it("is 'new' from nothing, and nothing to say when both are zero", () => {
    expect(growth(5, 0)).toEqual({ kind: "new" });
    expect(growth(0, 0)).toBeNull();
    expect(growth(-500, 0)).toBeNull();
  });

  it("falls to −100% when everything stops", () => {
    expect(growth(0, 40)).toEqual({ kind: "change", pct: -100 });
  });

  it("reads a negative base the right way round", () => {
    // Refunds outweighed receipts last month (−1,000); this month +1,000.
    expect(growth(1000, -1000)).toEqual({ kind: "change", pct: 200 });
    expect(growth(-2000, -1000)).toEqual({ kind: "change", pct: -100 });
  });

  it("formats with arrows on screen and plain signs for the PDF", () => {
    expect(formatGrowth({ kind: "change", pct: 12.5 })).toBe("▲ 12.5%");
    expect(formatGrowth({ kind: "change", pct: -3 })).toBe("▼ 3.0%");
    expect(formatGrowth({ kind: "change", pct: 0 })).toBe("0.0%");
    expect(formatGrowth({ kind: "new" })).toBe("new");
    expect(formatGrowth(null)).toBe("—");
    expect(formatGrowthPlain({ kind: "change", pct: 12.5 })).toBe("+12.5%");
    expect(formatGrowthPlain({ kind: "change", pct: -3 })).toBe("-3.0%");
    expect(formatGrowthPlain({ kind: "change", pct: 0 })).toBe("0.0%");
    expect(formatGrowthPlain({ kind: "new" })).toBe("new");
    expect(formatGrowthPlain(null)).toBe("-");
  });
});

describe("periodFigures — empty", () => {
  it("is all zeros with no data", () => {
    const f = figures(data());
    expect(f.sales).toEqual({
      count: 0,
      value: 0,
      kw: 0,
      average: 0,
      pendingApproval: 0,
      cancelledSince: 0,
      refundedSince: 0,
    });
    expect(f.collections.net).toBe(0);
    expect(f.collections.advances).toEqual({ amount: 0, count: 0 });
    expect(f.commissioned).toBe(0);
    expect(f.cancelled + f.refunded).toBe(0);
    expect(f.servicesCompleted).toBe(0);
    expect(f.incentivesPaid).toBe(0);
  });
});

describe("periodFigures — sales booked", () => {
  it("counts pending and approved by order date, never rejected", () => {
    const f = figures(
      data({
        sales: [
          sale({ status: "approved", totalCost: 300000, capacityKw: 5 }),
          sale({ status: "pending", totalCost: 100000, capacityKw: 2.5 }),
          sale({ status: "rejected", totalCost: 999999, capacityKw: 99 }),
        ],
      }),
    );
    expect(f.sales.count).toBe(2);
    expect(f.sales.value).toBe(400000);
    expect(f.sales.kw).toBe(7.5);
    expect(f.sales.average).toBe(200000);
    expect(f.sales.pendingApproval).toBe(1);
  });

  it("includes the first and last day of the month, and nothing either side", () => {
    const f = figures(
      data({
        sales: [
          sale({ orderDate: "2026-10-31" }),
          sale({ orderDate: "2026-11-01" }),
          sale({ orderDate: "2026-11-30" }),
          sale({ orderDate: "2026-12-01" }),
        ],
      }),
    );
    expect(f.sales.count).toBe(2);
  });

  it("ignores a custom plan's missing kW but counts its value", () => {
    const f = figures(
      data({
        sales: [
          sale({ capacityKw: 3.3 }),
          sale({ capacityKw: null, planType: "custom", plan: "Inverter + panel", totalCost: 40000 }),
        ],
      }),
    );
    expect(f.sales.kw).toBe(3.3);
    expect(f.sales.value).toBe(140000);
    expect(f.sales.count).toBe(2);
  });

  it("keeps cancelled and refunded sales in the month they were booked, and says how many", () => {
    const f = figures(
      data({
        sales: [
          sale({ projectState: "cancelled" }),
          sale({ projectState: "refunded" }),
          sale({ projectState: "refunded" }),
          sale({ projectState: "commissioned" }),
        ],
      }),
    );
    expect(f.sales.count).toBe(4);
    expect(f.sales.cancelledSince).toBe(1);
    expect(f.sales.refundedSince).toBe(2);
  });

  it("sums money without floating-point dust", () => {
    const f = figures(
      data({ sales: [sale({ totalCost: 0.1, capacityKw: 0.1 }), sale({ totalCost: 0.2, capacityKw: 0.2 })] }),
    );
    expect(f.sales.value).toBe(0.3);
    expect(f.sales.kw).toBe(0.3);
    expect(f.sales.average).toBe(0.15);
  });
});

describe("periodFigures — collections", () => {
  it("adds advances and contract payments, less refunds, by their own dates", () => {
    const f = figures(
      data({
        sales: [
          // Booked in October, advance paid in November: counts in November.
          sale({ orderDate: "2026-10-20", advanceAmount: 20000, advancePaidOn: "2026-11-02" }),
          // No advance date recorded: the order date counts.
          sale({ orderDate: "2026-11-03", advanceAmount: 15000 }),
          // Advance paid in October: not November's.
          sale({ orderDate: "2026-11-04", advanceAmount: 9000, advancePaidOn: "2026-10-30" }),
        ],
        payments: [
          payment({ purpose: "contract", amount: 50000 }),
          payment({ purpose: "contract", amount: 25000.5, paidOn: "2026-11-30" }),
          payment({ purpose: "refund", amount: 10000 }),
          payment({ purpose: "contract", amount: 77777, paidOn: "2026-12-01" }),
        ],
      }),
    );
    expect(f.collections.advances).toEqual({ amount: 35000, count: 2 });
    expect(f.collections.contract).toEqual({ amount: 75000.5, count: 2 });
    expect(f.collections.refunds).toEqual({ amount: 10000, count: 1 });
    expect(f.collections.net).toBe(100000.5);
  });

  it("never counts a rejected order's advance, or a zero one", () => {
    const f = figures(
      data({
        sales: [
          sale({ status: "rejected", advanceAmount: 50000 }),
          sale({ advanceAmount: 0 }),
          sale({ status: "pending", advanceAmount: 5000 }),
        ],
      }),
    );
    expect(f.collections.advances).toEqual({ amount: 5000, count: 1 });
  });

  it("keeps KSEB fees and write-offs out of net collected", () => {
    const f = figures(
      data({
        payments: [
          payment({ purpose: "kseb_fees", amount: 4720 }),
          payment({ purpose: "kseb_fees", amount: 5720, paidByOffice: true }),
          payment({ purpose: "write_off", amount: 800 }),
          payment({ purpose: "contract", amount: 1000 }),
        ],
      }),
    );
    expect(f.collections.ksebCollected).toEqual({ amount: 4720, count: 1 });
    expect(f.collections.ksebByOffice).toEqual({ amount: 5720, count: 1 });
    expect(f.collections.writeOffs).toEqual({ amount: 800, count: 1 });
    expect(f.collections.net).toBe(1000);
  });

  it("goes negative when refunds outweigh receipts", () => {
    const f = figures(data({ payments: [payment({ purpose: "refund", amount: 3000 })] }));
    expect(f.collections.net).toBe(-3000);
  });
});

describe("periodFigures — commissioning, cancellations, services, incentives", () => {
  it("counts commissioning by its India day, cancelled ones and unknown dates left out", () => {
    const f = figures(
      data({
        projects: [
          project({ completedAt: "2026-11-10T06:00:00Z" }),
          // 31 Oct 19:00 UTC is 1 Nov 00:30 in India: November's.
          project({ completedAt: "2026-10-31T19:00:00Z" }),
          // 30 Nov 19:00 UTC is 1 Dec in India: not November's.
          project({ completedAt: "2026-11-30T19:00:00Z" }),
          // Commissioned, then refunded: no longer counted.
          project({ cancellation: "refunded", cancelledOn: "2026-12-05" }),
          // Imported with no commissioning date.
          project({ completedAt: null }),
          // Not commissioned.
          project({ isCompleted: false, completedAt: null }),
        ],
      }),
    );
    expect(f.commissioned).toBe(2);
  });

  it("counts cancellations and refunds by the day they were marked, by kind", () => {
    const f = figures(
      data({
        projects: [
          project({ isCompleted: false, completedAt: null, cancellation: "cancelled", cancelledOn: "2026-11-02" }),
          project({ cancellation: "refunded", cancelledOn: "2026-11-30" }),
          project({ cancellation: "refunded", cancelledOn: "2026-11-15" }),
          project({ cancellation: "cancelled", cancelledOn: "2026-10-31" }),
          project({ cancellation: "cancelled", cancelledOn: null }),
        ],
      }),
    );
    expect(f.cancelled).toBe(1);
    expect(f.refunded).toBe(2);
  });

  it("counts completed visits by visit date, else the India day of the last update", () => {
    const f = figures(
      data({
        tickets: [
          ticket({ serviceDate: "2026-11-01" }),
          // The visit date wins over a later update.
          ticket({ serviceDate: "2026-10-30", updatedAt: "2026-11-05T06:00:00Z" }),
          ticket({ serviceDate: null, updatedAt: "2026-10-31T20:00:00Z" }), // 1 Nov IST
          ticket({ serviceDate: null, updatedAt: "2026-11-30T18:29:59Z" }), // 30 Nov 23:59 IST
          ticket({ serviceDate: null, updatedAt: "2026-11-30T18:30:00Z" }), // 1 Dec IST
          ticket({ status: "cancelled", serviceDate: "2026-11-10" }),
          ticket({ status: "in_progress", serviceDate: "2026-11-10" }),
        ],
      }),
    );
    expect(f.servicesCompleted).toBe(3);
  });

  it("adds the incentive instalments paid in the window", () => {
    const instalments: ReportIncentivePayment[] = [
      { amount: 2000, paidOn: "2026-11-01" },
      { amount: 1500.5, paidOn: "2026-11-30" },
      { amount: 9999, paidOn: "2026-10-31" },
    ];
    expect(figures(data({ incentivePayments: instalments })).incentivesPaid).toBe(3500.5);
  });
});

describe("headlineKpis", () => {
  const d = data({
    sales: [
      sale({ orderDate: "2026-11-03", totalCost: 200000, status: "pending" }),
      sale({ orderDate: "2026-11-04", totalCost: 100000 }),
      sale({ orderDate: "2026-10-03", totalCost: 100000 }),
    ],
    projects: [project({ cancellation: "cancelled", cancelledOn: "2026-11-02" })],
  });
  const p = prepareReportData(d);
  const kpis = headlineKpis(
    periodFigures(p, NOV),
    periodFigures(p, { from: "2026-10-01", to: "2026-10-31" }),
    periodFigures(p, { from: "2025-11-01", to: "2025-11-30" }),
  );
  const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));

  it("compares each figure with the month before and last year", () => {
    expect(byKey.salesCount).toMatchObject({
      value: 2,
      previous: 1,
      lastYear: 0,
      vsPrevious: { kind: "change", pct: 100 },
      vsLastYear: { kind: "new" },
    });
    expect(byKey.salesValue).toMatchObject({ value: 300000, vsPrevious: { kind: "change", pct: 200 } });
  });

  it("says — when there is nothing on either side", () => {
    expect(byKey.servicesCompleted.vsPrevious).toBeNull();
    expect(byKey.servicesCompleted.vsLastYear).toBeNull();
  });

  it("treats fewer cancellations as the good direction", () => {
    expect(byKey.cancelledRefunded).toMatchObject({ value: 1, better: "down" });
    expect(byKey.cancelledRefunded.hint).toBe("1 cancelled · 0 refunded");
  });

  it("tells how many sales still wait for approval", () => {
    expect(byKey.salesCount.hint).toBe("1 pending approval");
  });

  it("has every headline figure once, in order", () => {
    expect(kpis.map((k) => k.key)).toEqual([
      "salesCount",
      "salesValue",
      "capacity",
      "averageValue",
      "netCollected",
      "commissioned",
      "servicesCompleted",
      "incentivesPaid",
      "cancelledRefunded",
    ]);
  });
});

describe("fyComparison", () => {
  it("compares the year so far with the same span last year", () => {
    const d = data({
      sales: [
        sale({ orderDate: "2026-04-01", totalCost: 300000 }),
        sale({ orderDate: "2026-11-24", totalCost: 100000 }),
        // After the window end: not in this FY to date.
        sale({ orderDate: "2026-11-25", totalCost: 100000 }),
        sale({ orderDate: "2025-06-01", totalCost: 200000 }),
        // Last FY, but after the same span: not in the base.
        sale({ orderDate: "2025-12-01", totalCost: 900000 }),
        // The FY before that.
        sale({ orderDate: "2025-03-31", totalCost: 900000 }),
      ],
    });
    const p = prepareReportData(d);
    const period = reportPeriod("2026-11", TODAY);
    const rows = fyComparison(periodFigures(p, period.fy), periodFigures(p, period.fyBase));
    const value = rows.find((r) => r.label === "Sales value");
    expect(value).toMatchObject({ value: 400000, base: 200000, change: { kind: "change", pct: 100 } });
    expect(rows.find((r) => r.label === "Sales booked")).toMatchObject({ value: 2, base: 1 });
    expect(rows.map((r) => r.label)).not.toContain("Cancelled / refunded");
  });
});

describe("trendRows", () => {
  it("is twelve months ending at the selected one, oldest first", () => {
    const rows = trendRows(prepareReportData(data()), reportPeriod("2026-11", TODAY));
    expect(rows).toHaveLength(12);
    expect(rows[0].month).toBe("2025-12");
    expect(rows[11].month).toBe("2026-11");
    expect(rows[11].label).toBe("Nov 2026 (so far)");
    expect(rows[11].soFar).toBe(true);
    expect(rows[10].label).toBe("Oct 2026");
    expect(rows.every((r) => r.barPct === 0 && r.valueMoM === null)).toBe(true);
  });

  it("does not mark a past month 'so far'", () => {
    const rows = trendRows(prepareReportData(data()), reportPeriod("2026-02", TODAY));
    expect(rows[11]).toMatchObject({ month: "2026-02", soFar: false, label: "Feb 2026" });
    expect(rows[0].month).toBe("2025-03");
  });

  it("counts each month and its change on the month before (the first row on the month before it)", () => {
    const d = data({
      sales: [
        sale({ orderDate: "2025-11-15", totalCost: 50000 }), // base of the first row
        sale({ orderDate: "2025-12-15", totalCost: 100000 }),
        sale({ orderDate: "2026-01-15", totalCost: 150000, capacityKw: 5 }),
        sale({ orderDate: "2026-10-10", totalCost: 200000 }),
        sale({ orderDate: "2026-10-28", totalCost: 200000 }),
        sale({ orderDate: "2026-11-20", totalCost: 100000 }),
      ],
      payments: [payment({ paidOn: "2026-01-20", amount: 7000 })],
    });
    const rows = trendRows(prepareReportData(d), reportPeriod("2026-11", TODAY));
    const dec = rows[0];
    const jan = rows[1];
    const nov = rows[11];
    expect(dec).toMatchObject({ salesCount: 1, salesValue: 100000, valueMoM: { kind: "change", pct: 100 } });
    expect(jan).toMatchObject({ salesValue: 150000, capacityKw: 5, netCollected: 7000 });
    expect(jan.valueMoM).toEqual({ kind: "change", pct: 50 });
    // So far (1–24 Nov) against 1–24 Oct (one ₹2,00,000 sale), not all of October.
    expect(nov.valueMoM).toEqual({ kind: "change", pct: -50 });
    expect(rows[10].salesValue).toBe(400000);
    expect(rows[10].barPct).toBe(100);
    expect(nov.barPct).toBe(25);
    expect(rows[2].valueMoM).toEqual({ kind: "change", pct: -100 });
    expect(rows[3].valueMoM).toBeNull();
  });
});

describe("coordinatorTable", () => {
  /** Σ of figures as printed (to two decimals), in whole hundredths: no float dust either way. */
  const hundredths = (values: number[]) => values.reduce((sum, v) => sum + Math.round(v * 100), 0);

  it("splits a shared sale's value and kW evenly, and the rows add up exactly to the headline", () => {
    const d = data({
      sales: [
        sale({
          totalCost: 100000,
          capacityKw: 5,
          coordinatorIds: ["c-rahul", "c-priya", "c-arun"],
          coordinatorNames: ["Rahul Menon", "Priya Suresh", "Arun Krishnan"],
        }),
        sale({ totalCost: 100000, capacityKw: 3, coordinatorIds: ["c-priya"], coordinatorNames: ["Priya Suresh"] }),
        sale({ totalCost: 50000, capacityKw: null, coordinatorIds: ["c-rahul"], coordinatorNames: ["Rahul Menon"] }),
        sale({ status: "rejected", totalCost: 999999, coordinatorIds: ["c-sneha"], coordinatorNames: ["Sneha Das"] }),
      ],
    });
    const p = prepareReportData(d);
    const table = coordinatorTable(p, NOV);
    expect(table.rows.map((r) => r.name)).toEqual(["Priya Suresh", "Rahul Menon", "Arun Krishnan"]);
    // ₹1,00,000 and 5 kW three ways: the odd paisa and hundredths go to the first named (Rahul, then Priya).
    expect(table.rows[0]).toMatchObject({ sales: 2, shared: 1, valueShare: 133333.33, kwShare: 4.67 });
    expect(table.rows[1]).toMatchObject({ sales: 2, shared: 1, valueShare: 83333.34, kwShare: 1.67 });
    expect(table.rows[2]).toMatchObject({ sales: 1, shared: 1, valueShare: 33333.33, kwShare: 1.66 });

    const headline = periodFigures(p, NOV);
    expect(table.totals).toEqual({ sales: 3, shared: 1, value: 250000, kw: 8, commissioned: 0 });
    expect(table.totals.value).toBe(headline.sales.value);
    expect(table.totals.kw).toBe(headline.sales.kw);
    expect(table.totals.sales).toBe(headline.sales.count);
    expect(hundredths(table.rows.map((r) => r.valueShare))).toBe(hundredths([table.totals.value]));
    expect(hundredths(table.rows.map((r) => r.kwShare))).toBe(hundredths([table.totals.kw]));
  });

  it("gives each sale's odd paisa to the person named first on that sale, and still adds up", () => {
    const pair = (ids: string[]) => ({
      coordinatorIds: ids.map((id) => `c-${id}`),
      coordinatorNames: ids.map((id) => id[0].toUpperCase() + id.slice(1)),
    });
    const d = data({
      sales: [
        sale({ totalCost: 100000.01, capacityKw: 2.25, ...pair(["arun", "rahul"]) }),
        sale({ totalCost: 100000.01, capacityKw: 2.25, ...pair(["rahul", "arun"]) }),
        // Seven three-way sales: seven odd paise and hundredths of a kW, all Priya's.
        ...Array.from({ length: 7 }, () =>
          sale({ totalCost: 100000, capacityKw: 1, ...pair(["priya", "sneha", "joby"]) }),
        ),
      ],
    });
    const p = prepareReportData(d);
    const table = coordinatorTable(p, NOV);
    const byName = Object.fromEntries(table.rows.map((r) => [r.name, r]));
    expect(byName.Arun).toMatchObject({ valueShare: 100000.01, kwShare: 2.25 });
    expect(byName.Rahul).toMatchObject({ valueShare: 100000.01, kwShare: 2.25 });
    expect(byName.Priya).toMatchObject({ valueShare: 233333.38, kwShare: 2.38 });
    expect(byName.Sneha).toMatchObject({ valueShare: 233333.31, kwShare: 2.31 });
    expect(byName.Joby).toMatchObject({ valueShare: 233333.31, kwShare: 2.31 });

    const headline = periodFigures(p, NOV);
    expect(table.totals.value).toBe(headline.sales.value);
    expect(table.totals.kw).toBe(headline.sales.kw);
    expect(hundredths(table.rows.map((r) => r.valueShare))).toBe(hundredths([headline.sales.value]));
    expect(hundredths(table.rows.map((r) => r.kwShare))).toBe(hundredths([headline.sales.kw]));
  });

  it("credits commissioning to everyone on the sale, whatever month it was sold", () => {
    const old = sale({
      orderDate: "2025-02-01",
      coordinatorIds: ["c-rahul", "c-sneha"],
      coordinatorNames: ["Rahul Menon", "Sneha Das"],
    });
    const d = data({
      sales: [old],
      projects: [project({ workOrderId: old.id, completedAt: "2026-11-03T06:00:00Z" })],
    });
    const table = coordinatorTable(prepareReportData(d), NOV);
    expect(table.rows).toEqual([
      expect.objectContaining({ name: "Rahul Menon", sales: 0, valueShare: 0, commissioned: 1 }),
      expect.objectContaining({ name: "Sneha Das", sales: 0, valueShare: 0, commissioned: 1 }),
    ]);
    expect(table.totals.commissioned).toBe(1);
  });

  it("keeps sales with nobody on them in a row of their own, so totals still add up", () => {
    const d = data({
      sales: [sale({ coordinatorIds: [], coordinatorNames: [], totalCost: 70000 }), sale({ totalCost: 10000 })],
      projects: [project({ workOrderId: "missing-sale" })],
    });
    const table = coordinatorTable(prepareReportData(d), NOV);
    const none = table.rows.find((r) => r.id === null);
    expect(none).toMatchObject({ name: NO_COORDINATOR, sales: 1, valueShare: 70000, commissioned: 1 });
    expect(table.totals.value).toBe(80000);
  });

  it("names a coordinator 'Unknown' when the names fall short", () => {
    const d = data({ sales: [sale({ coordinatorIds: ["c-1", "c-2"], coordinatorNames: ["Asha"] })] });
    expect(coordinatorTable(prepareReportData(d), NOV).rows.map((r) => r.name).sort()).toEqual([
      "Asha",
      "Unknown",
    ]);
  });

  it("is empty with nothing in the window", () => {
    expect(coordinatorTable(prepareReportData(data()), NOV)).toEqual({
      rows: [],
      totals: { sales: 0, shared: 0, value: 0, kw: 0, commissioned: 0 },
    });
  });
});

describe("line items and CSVs", () => {
  const booked = sale({
    clientName: "Anand, \"Kumar\"",
    orderDate: "2026-11-03",
    totalCost: 250000.5,
    capacityKw: 5.25,
    advanceAmount: 25000,
    advancePaidOn: "2026-11-02",
    advanceMethod: "upi",
    advanceReference: "UPI 123",
    receivedToDate: 75000,
    balanceDue: 175000.5,
    coordinatorIds: ["c-rahul", "c-priya"],
    coordinatorNames: ["Rahul Menon", "Priya Suresh"],
    projectState: "commissioned",
    financing: "loan",
    loanBank: "SBI",
  });
  const custom = sale({
    clientName: "Beena",
    orderDate: "2026-11-01",
    capacityKw: null,
    plan: "1 panel",
    planType: "custom",
    status: "pending",
    projectState: "none",
    // No date or method recorded for this advance: it counts on the order date.
    advanceAmount: 5000,
  });
  const d = data({
    sales: [booked, custom, sale({ status: "rejected" }), sale({ orderDate: "2026-10-01" })],
    payments: [
      payment({ workOrderId: booked.id, purpose: "write_off", amount: 500, paidOn: "2026-11-05", method: "other" }),
      payment({ workOrderId: booked.id, purpose: "contract", amount: 50000, paidOn: "2026-11-05", reference: "CHQ 9" , method: "cheque"}),
      payment({ workOrderId: booked.id, purpose: "kseb_fees", amount: 4720, paidOn: "2026-11-04", paidByOffice: true, method: "cash" }),
      payment({ workOrderId: "gone", purpose: "refund", amount: 100, paidOn: "2026-11-06" }),
    ],
  });
  const p = prepareReportData(d);

  it("lists the sales booked, oldest first, with their state today", () => {
    const lines = saleLines(p, NOV);
    expect(lines.map((l) => l.clientName)).toEqual(["Beena", "Anand, \"Kumar\""]);
    expect(lines[1]).toMatchObject({
      coordinators: "Rahul Menon, Priya Suresh",
      financing: "Bank loan (SBI)",
      projectState: "commissioned",
    });
    expect(lines[0]).toMatchObject({ financing: "Self-financed", capacityKw: null, status: "pending" });
  });

  it("lists every money movement by date, the advance first on a tie", () => {
    const lines = collectionLines(p, NOV);
    expect(lines.map((l) => [l.date, l.kind])).toEqual([
      ["2026-11-01", "advance"],
      ["2026-11-02", "advance"],
      ["2026-11-04", "KSEB fee paid by office"],
      ["2026-11-05", "contract payment"],
      ["2026-11-05", "write-off"],
      ["2026-11-06", "refund"],
    ]);
    expect(lines[1]).toMatchObject({ method: "UPI", reference: "UPI 123", amount: 25000 });
    expect(lines[0]).toMatchObject({ method: "", reference: "" });
    expect(lines[5].clientName).toBe("Unknown sale");
  });

  it("writes the sales CSV with the agreed columns, plain numbers and ISO dates", () => {
    const rows = salesCsvRows(saleLines(p, NOV));
    expect(rows[0]).toEqual([...SALES_CSV_HEADER]);
    expect(rows[0]).toEqual([
      "order_date",
      "client_name",
      "coordinators",
      "plan",
      "capacity_kw",
      "total_cost",
      "advance",
      "received_to_date",
      "balance_due",
      "status",
      "project_state",
      "financing",
    ]);
    expect(rows[2]).toEqual([
      "2026-11-03",
      "Anand, \"Kumar\"",
      "Rahul Menon, Priya Suresh",
      "3kW",
      "5.25",
      "250000.50",
      "25000.00",
      "75000.00",
      "175000.50",
      "approved",
      "commissioned",
      "Bank loan (SBI)",
    ]);
    expect(rows[1][4]).toBe("");
  });

  it("round-trips through RFC-4180 quoting (commas and quotes in names)", () => {
    const text = toCsv(salesCsvRows(saleLines(p, NOV)));
    const parsed = parseCsv(text);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.rows[2][1]).toBe("Anand, \"Kumar\"");
    expect(text).toContain('"Anand, ""Kumar"""');
  });

  it("keeps free text typed as a formula from running in Excel, and numbers as numbers", () => {
    const risky = sale({
      clientName: '=HYPERLINK("http://evil.example","Open")',
      orderDate: "2026-11-07",
      coordinatorNames: ["-Rahul", "Priya Suresh"],
      coordinatorIds: ["c-1", "c-2"],
      plan: "+1 inverter",
      // Paid more than the total: a negative balance due is still a number.
      balanceDue: -500,
      financing: "loan",
      loanBank: "@SBI",
    });
    const pr = prepareReportData(
      data({
        sales: [risky],
        payments: [
          payment({ workOrderId: risky.id, reference: "@SUM(A1:A9)", amount: 1500 }),
          payment({ workOrderId: risky.id, reference: "\t=1+1", paidOn: "2026-11-11", purpose: "refund" }),
        ],
      }),
    );

    const sales = salesCsvRows(saleLines(pr, NOV));
    expect(sales[1]).toEqual([
      "2026-11-07",
      `'=HYPERLINK("http://evil.example","Open")`,
      "'-Rahul, Priya Suresh",
      "'+1 inverter",
      "3",
      "100000.00",
      "0.00",
      "0.00",
      "-500.00",
      "approved",
      "active",
      // The bank sits inside the label, so the cell does not start with it.
      "Bank loan (@SBI)",
    ]);

    const collections = collectionsCsvRows(collectionLines(pr, NOV));
    expect(collections.slice(1)).toEqual([
      ["2026-11-10", `'=HYPERLINK("http://evil.example","Open")`, "contract payment", "UPI", "1500.00", "'@SUM(A1:A9)"],
      ["2026-11-11", `'=HYPERLINK("http://evil.example","Open")`, "refund", "UPI", "1000.00", "'\t=1+1"],
    ]);

    // Through RFC-4180 quoting the apostrophe stays at the very start of the cell.
    const parsed = parseCsv(toCsv(sales));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.rows[1][1]).toBe(`'=HYPERLINK("http://evil.example","Open")`);
  });

  it("escapes a financing text that is printed as stored", () => {
    // A financing type the labels do not know is written as stored.
    const odd = sale({ financing: "=cmd" as ReportSale["financing"] });
    expect(salesCsvRows(saleLines(prepareReportData(data({ sales: [odd] })), NOV))[1][11]).toBe("'=cmd");
  });

  it("writes the collections CSV", () => {
    const rows = collectionsCsvRows(collectionLines(p, NOV));
    expect(rows[0]).toEqual(["date", "client_name", "kind", "method", "amount", "reference"]);
    expect(rows[0]).toEqual([...COLLECTIONS_CSV_HEADER]);
    expect(rows[4]).toEqual(["2026-11-05", "Anand, \"Kumar\"", "contract payment", "Cheque", "50000.00", "CHQ 9"]);
    expect(rows).toHaveLength(7);
  });

  it("writes the trend CSV with the month-on-month change as a number", () => {
    const rows = trendCsvRows([
      {
        month: "2026-11",
        label: "Nov 2026 (so far)",
        soFar: true,
        salesCount: 2,
        salesValue: 350000.5,
        capacityKw: 5.25,
        netCollected: -100,
        commissioned: 1,
        servicesCompleted: 4,
        valueMoM: { kind: "change", pct: -12.5 },
        barPct: 80,
      },
      {
        month: "2026-10",
        label: "Oct 2026",
        soFar: false,
        salesCount: 0,
        salesValue: 0,
        capacityKw: 0,
        netCollected: 0,
        commissioned: 0,
        servicesCompleted: 0,
        valueMoM: { kind: "new" },
        barPct: 0,
      },
    ]);
    expect(rows[0]).toEqual([...TREND_CSV_HEADER]);
    expect(rows[1]).toEqual(["2026-11", "yes", "2", "350000.50", "5.25", "-100.00", "1", "4", "-12.5"]);
    expect(rows[2]).toEqual(["2026-10", "no", "0", "0.00", "0", "0.00", "0", "0", "new"]);
  });

  it("names the files by month", () => {
    expect(reportFileName("pdf", "2026-11")).toBe("bss-report-2026-11.pdf");
    expect(reportFileName("sales", "2026-11")).toBe("bss-sales-2026-11.csv");
    expect(reportFileName("collections", "2026-11")).toBe("bss-collections-2026-11.csv");
    expect(reportFileName("trend", "2026-11")).toBe("bss-trend-2026-11.csv");
  });
});

describe("buildMonthlyReport", () => {
  it("puts the whole report together for the current month", () => {
    const d = data({
      sales: [sale({ orderDate: "2026-11-02", totalCost: 120000 }), sale({ orderDate: "2026-10-02" })],
    });
    const period = reportPeriod("2026-11", TODAY);
    const report = buildMonthlyReport(d, period, SNAPSHOT, TODAY);
    expect(report.monthLabel).toBe("November 2026");
    expect(report.generatedOn).toBe(TODAY);
    expect(report.current.sales.value).toBe(120000);
    expect(report.previous.sales.count).toBe(1);
    expect(report.kpis[0]).toMatchObject({ key: "salesCount", value: 1, previous: 1 });
    expect(report.trend).toHaveLength(12);
    expect(report.sales).toHaveLength(1);
    expect(report.snapshot).toEqual(SNAPSHOT);
    expect(report.coordinators.totals.value).toBe(120000);
    // Plain data: it is handed to client components as is.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("is a report of zeros for an empty business", () => {
    const report = buildMonthlyReport(data(), reportPeriod("2026-11", TODAY), SNAPSHOT, TODAY);
    expect(report.kpis.every((k) => k.value === 0 && k.vsPrevious === null)).toBe(true);
    expect(report.sales).toEqual([]);
    expect(report.collections).toEqual([]);
    expect(report.coordinators.rows).toEqual([]);
  });
});

describe("formatKw and the notes", () => {
  it("prints kW with Indian grouping and up to two decimals", () => {
    expect(formatKw(5)).toBe("5 kW");
    expect(formatKw(12.345)).toBe("12.35 kW");
    expect(formatKw(1250.5)).toBe("1,250.5 kW");
  });

  it("explains every headline figure and the unknown commissioning dates", () => {
    const terms = REPORT_NOTES.map((n) => n.term);
    for (const term of ["Sales booked", "Net collected", "Commissioned", "Service visits done", "Comparisons", "Financial year", "By coordinator"]) {
      expect(terms).toContain(term);
    }
    expect(REPORT_NOTES.find((n) => n.term === "Commissioned")?.text).toMatch(/not counted in any month/);
  });
});
