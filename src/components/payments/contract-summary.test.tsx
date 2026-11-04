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

/** The value shown under a label. */
function valueOf(label: string): HTMLElement {
  const value = screen.getByText(label).nextElementSibling;
  if (!value) throw new Error(`no value for ${label}`);
  return value as HTMLElement;
}

describe("ContractSummary — a refund", () => {
  // ₹3,00,000 sold; ₹3,10,000 collected (advance 40,000 + 1,50,000 + 1,20,000);
  // ₹10,000 went back: net ₹3,00,000.
  const REFUNDED = {
    total_cost: 300000,
    advance_amount: 40000,
    payments_total: 270000,
    refunded_total: 10000,
  };

  it("splits collected, refunded and net received, so the money out is visible", () => {
    render(<ContractSummary source={REFUNDED} isCompleted />);
    expect(valueOf("Collected")).toHaveTextContent(formatCurrency(310000));
    expect(valueOf("Refunded")).toHaveTextContent(`−${formatCurrency(10000)}`);
    expect(valueOf("Refunded").firstElementChild).toHaveClass("text-red-700");
    expect(valueOf("Net received")).toHaveTextContent(formatCurrency(300000));
    expect(valueOf("Balance due")).toHaveTextContent(formatCurrency(0));
    expect(screen.getByText("Paid in full")).toBeInTheDocument();
    // "Total received" is the old, gross label: replaced, not repeated.
    expect(screen.queryByText("Total received")).not.toBeInTheDocument();
  });

  it("puts the refunded money back on the balance of a commissioned sale", () => {
    render(
      <ContractSummary
        source={{ ...REFUNDED, refunded_total: 25000 }}
        isCompleted
      />,
    );
    expect(valueOf("Net received")).toHaveTextContent(formatCurrency(285000));
    expect(valueOf("Balance due")).toHaveTextContent(formatCurrency(15000));
    expect(screen.getByText(/Payment pending/)).toBeInTheDocument();
    expect(screen.getByText(/95% collected/)).toBeInTheDocument();
  });

  it("keeps the plain label when nothing was refunded", () => {
    render(<ContractSummary source={OWING} />);
    expect(screen.getByText("Total received")).toBeInTheDocument();
    expect(screen.queryByText("Refunded")).not.toBeInTheDocument();
    expect(screen.queryByText("Net received")).not.toBeInTheDocument();
    expect(screen.queryByText("Written off")).not.toBeInTheDocument();
  });
});

describe("ContractSummary — a write-off", () => {
  // ₹1,75,000 sold; ₹1,74,200 collected; ₹800 written off.
  const SHORT = { total_cost: 175000, advance_amount: 15000, payments_total: 159200 };

  it('reads "Settled — ₹800 written off" when it clears the balance', () => {
    render(<ContractSummary source={{ ...SHORT, written_off_total: 800 }} isCompleted />);
    expect(screen.getByText(`Settled — ${formatCurrency(800)} written off`)).toBeInTheDocument();
    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(valueOf("Written off")).toHaveTextContent(formatCurrency(800));
    expect(valueOf("Total received")).toHaveTextContent(formatCurrency(174200));
    expect(valueOf("Balance due")).toHaveTextContent(formatCurrency(0));
    // Not "100% collected": ₹800 was not.
    expect(screen.queryByText(/% collected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment pending/)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar").firstElementChild).toHaveClass("bg-emerald-500");
  });

  it("shows a part write-off as a figure, with the rest still due", () => {
    render(<ContractSummary source={{ ...SHORT, written_off_total: 300 }} isCompleted />);
    expect(screen.queryByText(/Settled/)).not.toBeInTheDocument();
    expect(valueOf("Written off")).toHaveTextContent(formatCurrency(300));
    expect(valueOf("Balance due")).toHaveTextContent(formatCurrency(500));
    expect(screen.getByText(/Payment pending/)).toBeInTheDocument();
  });

  it("is a closed sale's history, not a settlement, once cancelled", () => {
    render(
      <ContractSummary
        source={{ ...SHORT, written_off_total: 800 }}
        isCompleted
        cancellation="cancelled"
      />,
    );
    expect(screen.queryByText(/Settled/)).not.toBeInTheDocument();
    expect(screen.getByText("Nothing due — cancelled")).toBeInTheDocument();
  });
});

describe("ContractSummary — KSEB fees", () => {
  it("shows what the customer paid and what the office paid, each apart from the contract", () => {
    render(
      <ContractSummary source={OWING} ksebFeesCollected={4720} ksebFeesByOffice={5720} />,
    );
    expect(valueOf("KSEB fees collected")).toHaveTextContent(formatCurrency(4720));
    expect(valueOf("KSEB fees paid by office")).toHaveTextContent(formatCurrency(5720));
    // The contract balance does not move.
    expect(valueOf("Balance due")).toHaveTextContent(formatCurrency(100000));
  });

  it("shows only the line there is something for", () => {
    const { rerender } = render(<ContractSummary source={OWING} ksebFeesByOffice={5720} />);
    expect(screen.queryByText("KSEB fees collected")).not.toBeInTheDocument();
    expect(screen.getByText("KSEB fees paid by office")).toBeInTheDocument();

    rerender(<ContractSummary source={OWING} ksebFeesCollected={4720} />);
    expect(screen.getByText("KSEB fees collected")).toBeInTheDocument();
    expect(screen.queryByText("KSEB fees paid by office")).not.toBeInTheDocument();
  });
});
