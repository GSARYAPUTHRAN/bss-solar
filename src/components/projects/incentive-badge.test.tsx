// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  IncentiveAmount,
  IncentiveBadge,
  IncentiveLine,
  IncentiveTotal,
  SaleIncentiveBadge,
  SaleIncentiveLine,
} from "./incentive-badge";

describe("SaleIncentiveBadge", () => {
  it.each([
    [0, 0, "Not set", "gray"],
    [1, 1, "Pending", "amber"],
    [3, 3, "Pending", "amber"],
    [2, 1, "Partly paid", "blue"],
    [3, 2, "Partly paid", "blue"],
    [1, 0, "Paid", "emerald"],
    [3, 0, "Paid", "emerald"],
  ])("with %i set and %i unpaid reads %s", (count, unpaidCount, label, tone) => {
    render(<SaleIncentiveBadge count={count} unpaidCount={unpaidCount} />);
    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain(tone);
  });

  it("passes a class name through", () => {
    render(<SaleIncentiveBadge count={1} unpaidCount={1} className="ml-2" />);
    expect(screen.getByText("Pending")).toHaveClass("ml-2");
  });
});

describe("IncentiveTotal", () => {
  it("shows the total with the state of everyone's incentives", () => {
    render(<IncentiveTotal total={12000} count={2} unpaidCount={2} />);
    expect(screen.getByText(formatCurrency(12000))).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("says partly paid when some of the people have been paid", () => {
    render(<IncentiveTotal total={12000} count={2} unpaidCount={1} />);
    expect(screen.getByText(formatCurrency(12000))).toBeInTheDocument();
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
  });

  it("says paid once every incentive is", () => {
    render(<IncentiveTotal total={7500} count={1} unpaidCount={0} />);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("is an em dash when no incentive is set", () => {
    const { container } = render(<IncentiveTotal total={null} count={0} unpaidCount={0} />);
    expect(container).toHaveTextContent(/^—$/);
    expect(screen.queryByText("Not set")).toBeNull();
  });

  it("still shows a zero-rupee incentive that was set", () => {
    render(<IncentiveTotal total={0} count={1} unpaidCount={1} />);
    expect(screen.getByText(formatCurrency(0))).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("passes a class name through", () => {
    const { container } = render(
      <IncentiveTotal total={null} count={0} unpaidCount={0} className="text-muted-foreground" />,
    );
    expect(container.firstElementChild).toHaveClass("text-muted-foreground");
  });
});

describe("SaleIncentiveLine", () => {
  it("reads the label, the total and the state as one line", () => {
    render(<SaleIncentiveLine total={12000} count={2} unpaidCount={1} />);
    const line = screen.getByText("Incentive").parentElement;
    expect(line).toHaveTextContent(formatCurrency(12000));
    expect(line).toHaveTextContent("Partly paid");
  });

  it("can word the line as the viewer's own", () => {
    render(<SaleIncentiveLine total={5000} count={1} unpaidCount={1} label="Your incentive" />);
    expect(screen.getByText("Your incentive")).toBeInTheDocument();
    expect(screen.queryByText("Incentive")).toBeNull();
  });

  it("is nothing when no incentive is set", () => {
    const { container } = render(<SaleIncentiveLine total={null} count={0} unpaidCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// One person's incentive: the project page's per-coordinator rows. Lists and the
// board show the sale's total (IncentiveTotal / SaleIncentiveLine) instead.
describe("IncentiveAmount / IncentiveBadge / IncentiveLine", () => {
  it("shows one person's incentive and whether it is paid", () => {
    render(<IncentiveAmount incentive={5000} paidOn={null} />);
    expect(screen.getByText(formatCurrency(5000))).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows the paid date", () => {
    render(<IncentiveBadge incentive={5000} paidOn="2026-10-01" />);
    expect(screen.getByText(`Paid ${formatDate("2026-10-01")}`)).toBeInTheDocument();
  });

  it("is an em dash, or nothing on a line, when no incentive is set", () => {
    const { container, rerender } = render(<IncentiveAmount incentive={null} paidOn={null} />);
    expect(container).toHaveTextContent(/^—$/);
    rerender(<IncentiveLine incentive={null} paidOn={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
