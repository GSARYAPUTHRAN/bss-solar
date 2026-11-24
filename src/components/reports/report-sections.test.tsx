// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatCurrency } from "@/lib/format";
import {
  REPORT_NOTES,
  reportPeriod,
  type CollectionFigures,
  type TrendRow,
} from "@/lib/domain/reports";
import {
  CollectionsSection,
  CoordinatorsSection,
  FinancialYearSection,
  ReportNote,
  SnapshotSection,
  TrendSection,
} from "./report-sections";

const PERIOD = reportPeriod("2026-11", "2026-11-24");

const COLLECTIONS: CollectionFigures = {
  advances: { amount: 20000, count: 2 },
  contract: { amount: 50000, count: 1 },
  refunds: { amount: 2500, count: 1 },
  net: 67500,
  ksebCollected: { amount: 4720, count: 1 },
  ksebByOffice: { amount: 5720, count: 1 },
  writeOffs: { amount: 800, count: 1 },
};

/** A table row by its first cell. */
function row(table: HTMLElement, first: string): HTMLElement {
  const cell = within(table).getByText(first, { selector: "td" });
  return cell.closest("tr") as HTMLElement;
}

describe("CollectionsSection", () => {
  it("adds advances and contract payments less refunds, and keeps KSEB and write-offs apart", () => {
    render(<CollectionsSection collections={COLLECTIONS} period={PERIOD} />);
    const table = screen.getByRole("table", { name: "Collections" });
    expect(row(table, "Advances")).toHaveTextContent(`2${formatCurrency(20000)}`);
    expect(row(table, "Refunds")).toHaveTextContent(`− ${formatCurrency(2500)}`);
    expect(row(table, "Net collected")).toHaveTextContent(formatCurrency(67500));
    expect(within(table).getByText(/kept apart — not in net collected/i)).toBeInTheDocument();
    expect(row(table, "KSEB fees paid by the office")).toHaveTextContent(formatCurrency(5720));
    expect(row(table, "Write-offs (not money)")).toHaveTextContent(formatCurrency(800));
    expect(screen.getByText("Money in and out, 1–24 Nov 2026.")).toBeInTheDocument();
  });
});

describe("FinancialYearSection", () => {
  it("sets the year so far beside the same span last year", () => {
    render(
      <FinancialYearSection
        period={PERIOD}
        rows={[
          { label: "Sales value", format: "money", better: "up", value: 400000, base: 200000, change: { kind: "change", pct: 100 } },
          { label: "Sales booked", format: "count", better: "up", value: 0, base: 0, change: null },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Financial year to date" });
    expect(within(table).getByRole("columnheader", { name: "FY 2026–27" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "FY 2025–26" })).toBeInTheDocument();
    expect(row(table, "Sales value")).toHaveTextContent(
      `${formatCurrency(400000)}${formatCurrency(200000)}▲ up 100.0%`,
    );
    expect(row(table, "Sales booked")).toHaveTextContent("00—");
    expect(
      screen.getByText("1 Apr – 24 Nov 2026, against 1 Apr – 24 Nov 2025 (FY 2025–26)."),
    ).toBeInTheDocument();
  });
});

function trendRow(month: string, overrides: Partial<TrendRow> = {}): TrendRow {
  return {
    month,
    label: month,
    soFar: false,
    salesCount: 1,
    salesValue: 100000,
    capacityKw: 3,
    netCollected: 50000,
    commissioned: 0,
    servicesCompleted: 2,
    valueMoM: null,
    barPct: 50,
    ...overrides,
  };
}

describe("TrendSection", () => {
  it("has a row per month with a bar as wide as its share of the biggest month", () => {
    render(
      <TrendSection
        rows={[
          trendRow("2026-10", { label: "Oct 2026", barPct: 100, salesValue: 200000 }),
          trendRow("2026-11", { label: "Nov 2026 (so far)", soFar: true, barPct: 25, valueMoM: { kind: "change", pct: -75 } }),
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "12-month trend" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const bars = [...table.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(bars.map((b) => b.style.width)).toEqual(["100%", "25%"]);
    expect(rows[1]).toHaveTextContent("Nov 2026 (so far)");
    expect(rows[1]).toHaveTextContent("▼ down 75.0%");
    expect(rows[0]).toHaveTextContent("3 kW");
    // The bar is decoration: the value is printed beside it.
    expect(bars[0].parentElement).toHaveAttribute("aria-hidden");
  });
});

describe("CoordinatorsSection", () => {
  it("lists each coordinator and a total row equal to the headline", () => {
    render(
      <CoordinatorsSection
        period={PERIOD}
        table={{
          rows: [
            { id: "c-1", name: "Priya Suresh", sales: 2, shared: 1, valueShare: 200000, kwShare: 4.67, commissioned: 1 },
            { id: null, name: "No coordinator", sales: 1, shared: 0, valueShare: 50000, kwShare: 0, commissioned: 0 },
          ],
          totals: { sales: 3, shared: 1, value: 250000, kw: 4.67, commissioned: 1 },
        }}
      />,
    );
    const table = screen.getByRole("table", { name: "By coordinator" });
    expect(row(table, "Priya Suresh")).toHaveTextContent(`21${formatCurrency(200000)}4.67 kW1`);
    expect(row(table, "Total")).toHaveTextContent(`31${formatCurrency(250000)}4.67 kW1`);
    expect(row(table, "No coordinator")).toBeInTheDocument();
  });

  it("says so when nothing happened in the period", () => {
    render(
      <CoordinatorsSection
        period={PERIOD}
        table={{ rows: [], totals: { sales: 0, shared: 0, value: 0, kw: 0, commissioned: 0 } }}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/no sales booked and no plants commissioned/i)).toBeInTheDocument();
  });
});

describe("SnapshotSection", () => {
  it("shows today's figures, each linking to its list", () => {
    render(
      <SnapshotSection
        snapshot={{
          activeProjects: 12,
          commissionedUnpaid: 2,
          outstandingAmount: 45000,
          incentivePending: 7000,
          openTickets: 3,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "As of today" })).toBeInTheDocument();
    const link = (name: RegExp) => screen.getByRole("link", { name });
    expect(link(/active projects/i)).toHaveAttribute("href", "/projects");
    expect(link(/commissioned · balance due/i)).toHaveAttribute(
      "href",
      "/projects?view=list&status=payment_pending",
    );
    expect(link(/commissioned · balance due/i)).toHaveTextContent(
      `${formatCurrency(45000)} still to collect`,
    );
    expect(link(/incentives pending/i)).toHaveTextContent(formatCurrency(7000));
    expect(link(/open service tickets/i)).toHaveAttribute("href", "/tickets");
  });
});

describe("ReportNote", () => {
  it("is folded until opened, then explains every figure", async () => {
    render(<ReportNote />);
    const summary = screen.getByText("How these numbers are counted");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    await userEvent.setup().click(summary);
    expect(details.open).toBe(true);
    for (const note of REPORT_NOTES) expect(within(details).getByText(note.term)).toBeInTheDocument();
  });
});
