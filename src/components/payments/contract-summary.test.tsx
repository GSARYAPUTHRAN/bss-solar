// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { formatCurrency } from "@/lib/format";
import { ContractSummary } from "./contract-summary";

// ₹2,00,000 agreed; ₹1,00,000 received (₹50,000 advance + ₹50,000 ledger).
const OWING = { total_cost: 200000, advance_amount: 50000, payments_total: 50000 };
const SETTLED = { total_cost: 200000, advance_amount: 50000, payments_total: 150000 };

/** The text of the "Balance due" row. */
function balance(): HTMLElement {
  const row = screen.getByText("Balance due").parentElement;
  if (!row) throw new Error("no balance row");
  return row;
}

describe("ContractSummary — a live project", () => {
  it("shows the balance due plainly while the plant is in progress", () => {
    render(<ContractSummary source={OWING} isCompleted={false} />);
    expect(balance()).toHaveTextContent(formatCurrency(100000));
    expect(balance()).not.toHaveTextContent(/not collected|project/);
    expect(screen.getByText(/50% collected/)).toBeInTheDocument();
  });

  it("raises the alarm for a commissioned plant that is not paid for", () => {
    render(<ContractSummary source={OWING} isCompleted />);
    expect(screen.getByText(/Payment pending/)).toBeInTheDocument();
    expect(within(balance()).getByText(formatCurrency(100000))).toHaveClass("text-red-700");
    expect(screen.getByRole("progressbar").firstElementChild).toHaveClass("bg-red-500");
  });

  it("is the same with an explicit null cancellation", () => {
    render(<ContractSummary source={OWING} isCompleted cancellation={null} />);
    expect(screen.getByText(/Payment pending/)).toBeInTheDocument();
  });
});

describe("ContractSummary — a cancelled or refunded project", () => {
  it.each(["cancelled", "refunded"] as const)(
    "reads the balance as not collected, never as money due (%s)",
    (cancellation) => {
      render(<ContractSummary source={OWING} isCompleted cancellation={cancellation} />);
      expect(
        screen.getByText(
          `${formatCurrency(100000)} not collected — project ${cancellation}`,
        ),
      ).toBeInTheDocument();
    },
  );

  it("is muted, not red, even on a commissioned project with a balance", () => {
    render(<ContractSummary source={OWING} isCompleted cancellation="refunded" />);
    const value = screen.getByText(/not collected — project refunded/);
    expect(value).toHaveClass("text-muted-foreground");
    expect(value.className).not.toMatch(/red/);
    expect(screen.getByRole("progressbar").firstElementChild?.className).not.toMatch(
      /red|amber|emerald/,
    );
  });

  it("raises no payment-pending warning", () => {
    render(<ContractSummary source={OWING} isCompleted cancellation="cancelled" />);
    expect(screen.queryByText(/Payment pending/)).toBeNull();
    expect(screen.getByText("Nothing due — cancelled")).toBeInTheDocument();
  });

  it("still reports what was collected, as history", () => {
    render(<ContractSummary source={OWING} isCompleted cancellation="refunded" />);
    expect(screen.getByText(/50% collected/)).toBeInTheDocument();
    expect(screen.getByText("Total received").parentElement).toHaveTextContent(
      formatCurrency(100000),
    );
  });

  it("does not claim anything went uncollected when the contract was paid in full", () => {
    render(<ContractSummary source={SETTLED} cancellation="refunded" />);
    expect(balance()).toHaveTextContent(`${formatCurrency(0)} — project refunded`);
    expect(balance()).not.toHaveTextContent("not collected");
  });
});
