// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
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
    // [people with one set, people still owed, Σ instalments paid, label, tone]
    [0, 0, 0, "Not set", "gray"],
    [1, 1, 0, "Pending", "amber"],
    [3, 3, 0, "Pending", "amber"],
    // Money moved, something still to pay — whether or not anyone is paid in full.
    [1, 1, 4000, "Partly paid", "blue"],
    [2, 2, 3000, "Partly paid", "blue"],
    [2, 1, 6000, "Partly paid", "blue"],
    [3, 2, 100, "Partly paid", "blue"],
    [1, 0, 6000, "Paid", "emerald"],
    [3, 0, 18000, "Paid", "emerald"],
  ])("with %i set, %i owed and %d paid reads %s", (count, unpaidCount, paid, label, tone) => {
    render(<SaleIncentiveBadge count={count} unpaidCount={unpaidCount} paid={paid} />);
    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain(tone);
  });

  it("says Nothing owed for an incentive agreed at zero", () => {
    render(<SaleIncentiveBadge count={1} unpaidCount={0} paid={0} total={0} />);
    expect(screen.getByText("Nothing owed")).toBeInTheDocument();
  });

  it("passes a class name through", () => {
    render(<SaleIncentiveBadge count={1} unpaidCount={1} paid={0} className="ml-2" />);
    expect(screen.getByText("Pending")).toHaveClass("ml-2");
  });
});

describe("IncentiveTotal", () => {
  it("shows the total with the state of everyone's incentives", () => {
    render(<IncentiveTotal total={12000} paid={0} count={2} unpaidCount={2} />);
    expect(screen.getByText(formatCurrency(12000))).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByText(/paid$/)).toBeNull();
  });

  it("shows how much of it is paid once an instalment is in", () => {
    render(<IncentiveTotal total={12000} paid={4000} count={1} unpaidCount={1} />);
    expect(screen.getByText(formatCurrency(12000))).toBeInTheDocument();
    expect(screen.getByText(`· ${formatCurrency(4000)} paid`)).toBeInTheDocument();
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
  });

  it("says partly paid when only some of the people have been paid", () => {
    render(<IncentiveTotal total={12000} paid={6000} count={2} unpaidCount={1} />);
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
  });

  it("says paid once nothing is owed, without repeating the amount as 'paid'", () => {
    render(<IncentiveTotal total={7500} paid={7500} count={1} unpaidCount={0} />);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getAllByText(formatCurrency(7500))).toHaveLength(1);
  });

  it("is an em dash when no incentive is set", () => {
    const { container } = render(
      <IncentiveTotal total={null} paid={0} count={0} unpaidCount={0} />,
    );
    expect(container).toHaveTextContent(/^—$/);
    expect(screen.queryByText("Not set")).toBeNull();
  });

  it("reads a zero-rupee incentive that was set as Nothing owed — never as pending", () => {
    render(<IncentiveTotal total={0} paid={0} count={1} unpaidCount={0} />);
    expect(screen.getByText(formatCurrency(0))).toBeInTheDocument();
    expect(screen.getByText("Nothing owed")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).toBeNull();
  });

  it("passes a class name through", () => {
    const { container } = render(
      <IncentiveTotal
        total={null}
        paid={0}
        count={0}
        unpaidCount={0}
        className="text-muted-foreground"
      />,
    );
    expect(container.firstElementChild).toHaveClass("text-muted-foreground");
  });
});

describe("SaleIncentiveLine", () => {
  it("reads the label, the total, what is paid and the state as one line", () => {
    render(<SaleIncentiveLine total={12000} paid={6000} count={2} unpaidCount={1} />);
    const line = screen.getByText("Incentive").parentElement;
    expect(line).toHaveTextContent(formatCurrency(12000));
    expect(line).toHaveTextContent(`${formatCurrency(6000)} paid`);
    expect(line).toHaveTextContent("Partly paid");
  });

  it("can word the line as the viewer's own", () => {
    render(
      <SaleIncentiveLine
        total={5000}
        paid={0}
        count={1}
        unpaidCount={1}
        label="Your incentive"
      />,
    );
    expect(screen.getByText("Your incentive")).toBeInTheDocument();
    expect(screen.queryByText("Incentive")).toBeNull();
  });

  it("is nothing when no incentive is set", () => {
    const { container } = render(
      <SaleIncentiveLine total={null} paid={0} count={0} unpaidCount={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// One person's incentive: the project page's rows. Lists and the board show the
// sale's total (IncentiveTotal / SaleIncentiveLine) instead.
describe("IncentiveAmount / IncentiveBadge / IncentiveLine", () => {
  it("shows one person's agreed amount and that it is pending", () => {
    render(<IncentiveAmount amount={5000} paid={0} />);
    expect(screen.getByText(formatCurrency(5000))).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows what is paid while it is part-paid", () => {
    render(<IncentiveAmount amount={6000} paid={4000} />);
    expect(screen.getByText(formatCurrency(6000))).toBeInTheDocument();
    expect(screen.getByText(`· ${formatCurrency(4000)} paid`)).toBeInTheDocument();
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
  });

  it.each([
    [null, 0, "Not set", "gray"],
    [5000, 0, "Pending", "amber"],
    [5000, 1, "Partly paid", "blue"],
    [5000, 4999.99, "Partly paid", "blue"],
    [5000, 5000, "Paid", "emerald"],
    [0, 0, "Nothing owed", "emerald"],
  ])("a badge for %s agreed and %s paid reads %s", (amount, paid, label, tone) => {
    render(<IncentiveBadge amount={amount} paid={paid} />);
    const badge = screen.getByText(label);
    expect(badge.className).toContain(tone);
  });

  it("is an em dash, or nothing on a line, when no incentive is set", () => {
    const { container, rerender } = render(<IncentiveAmount amount={null} paid={0} />);
    expect(container).toHaveTextContent(/^—$/);
    rerender(<IncentiveLine amount={null} paid={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a line reads 'Incentive', the amount and its state", () => {
    render(<IncentiveLine amount={2750} paid={0} />);
    const line = screen.getByText("Incentive").parentElement;
    expect(line).toHaveTextContent(formatCurrency(2750));
    expect(line).toHaveTextContent("Pending");
  });
});
