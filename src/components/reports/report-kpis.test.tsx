// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import { reportPeriod, type Kpi } from "@/lib/domain/reports";
import { ReportKpis } from "./report-kpis";
import { GrowthText } from "./growth-text";

const PERIOD = reportPeriod("2026-11", "2026-11-24");

function kpi(overrides: Partial<Kpi>): Kpi {
  return {
    key: "salesValue",
    label: "Sales value",
    format: "money",
    value: 300000,
    previous: 200000,
    lastYear: 0,
    vsPrevious: { kind: "change", pct: 50 },
    vsLastYear: { kind: "new" },
    better: "up",
    hint: null,
    ...overrides,
  };
}

function card(key: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-kpi="${key}"]`);
  if (!el) throw new Error(`no card ${key}`);
  return el;
}

describe("ReportKpis", () => {
  it("shows each figure with its change against both comparison windows", () => {
    render(<ReportKpis kpis={[kpi({})]} period={PERIOD} />);
    const c = card("salesValue");
    expect(c).toHaveTextContent("Sales value");
    // The big figure is in whole rupees, so it fits the card; the comparisons keep paise.
    expect(c).toHaveTextContent(formatCurrencyWhole(300000));
    const prev = c.querySelector<HTMLElement>('[data-compare="previous"]')!;
    const ly = c.querySelector<HTMLElement>('[data-compare="lastYear"]')!;
    // The arrow is spoken as a word ("up").
    expect(prev).toHaveTextContent(`▲ up 50.0% vs 1–24 Oct 2026 (${formatCurrency(200000)})`);
    expect(ly).toHaveTextContent(`new vs 1–24 Nov 2025 (${formatCurrency(0)})`);
  });

  it("titles the section with the window", () => {
    render(<ReportKpis kpis={[kpi({})]} period={PERIOD} />);
    expect(screen.getByRole("heading", { name: /headline · 1–24 nov 2026/i })).toBeInTheDocument();
  });

  it("prints counts and kW, and the hint when there is one", () => {
    render(
      <ReportKpis
        kpis={[
          kpi({ key: "salesCount", label: "Sales booked", format: "count", value: 14, previous: 12, hint: "3 pending approval" }),
          kpi({ key: "capacity", label: "Capacity sold", format: "kw", value: 42.5, previous: 40 }),
        ]}
        period={PERIOD}
      />,
    );
    expect(card("salesCount")).toHaveTextContent("14");
    expect(card("salesCount")).toHaveTextContent("3 pending approval");
    expect(card("capacity")).toHaveTextContent("42.5 kW");
  });

  it("colours more cancellations as bad news", () => {
    render(
      <ReportKpis
        kpis={[
          kpi({
            key: "cancelledRefunded",
            label: "Cancelled / refunded",
            format: "count",
            value: 3,
            previous: 1,
            vsPrevious: { kind: "change", pct: 200 },
            better: "down",
          }),
        ]}
        period={PERIOD}
      />,
    );
    const prev = card("cancelledRefunded").querySelector('[data-compare="previous"] span')!;
    expect(prev.className).toContain("text-red-700");
  });

  it("shows the previous month's label in full for a past month", () => {
    render(<ReportKpis kpis={[kpi({})]} period={reportPeriod("2026-10", "2026-11-24")} />);
    expect(card("salesValue")).toHaveTextContent("vs Sep 2026");
    expect(card("salesValue")).toHaveTextContent("vs Oct 2025");
  });
});

describe("GrowthText", () => {
  it("reads arrows as words to screen readers", () => {
    render(
      <p>
        <GrowthText growth={{ kind: "change", pct: -3 }} />
      </p>,
    );
    const p = screen.getByText(/3\.0%/).closest("p")!;
    expect(p).toHaveTextContent("▼ down 3.0%");
    expect(within(p).getByText("▼", { exact: false })).toHaveAttribute("aria-hidden");
  });

  it("prints a dash when there is nothing to compare, and no arrow for 0%", () => {
    const { container } = render(
      <div>
        <GrowthText growth={null} />
        <GrowthText growth={{ kind: "change", pct: 0 }} />
      </div>,
    );
    expect(container).toHaveTextContent("—no change to compare0.0%");
  });
});
