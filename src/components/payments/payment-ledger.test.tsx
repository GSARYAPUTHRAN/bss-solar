// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PaymentLedger, stageLabel } from "./payment-ledger";
import { ContractSummary } from "./contract-summary";
import type { Payment } from "@/lib/types";

function payment(overrides: Partial<Payment> & Pick<Payment, "id">): Payment {
  return {
    work_order_id: "wo-1",
    amount: 10000,
    paid_on: "2026-09-01",
    method: "upi",
    purpose: "contract",
    reference: null,
    notes: null,
    recorded_by: "admin-1",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    recorder: { id: "admin-1", full_name: "BSS Admin" },
    ...overrides,
  };
}

// Deliberately out of order: stages follow the date received, not insertion.
const LEDGER: Payment[] = [
  payment({ id: "c", amount: 40000, paid_on: "2026-09-20", reference: "CHQ 3003" }),
  payment({ id: "a", amount: 100000, paid_on: "2026-09-01", reference: "UTR 1001" }),
  payment({
    id: "k",
    amount: 5900,
    paid_on: "2026-09-05",
    purpose: "kseb_fees",
    method: "cash",
  }),
  payment({ id: "b", amount: 60000, paid_on: "2026-09-10", notes: "Subsidy credit" }),
];

describe("stageLabel", () => {
  it("numbers contract instalments and KSEB fees separately", () => {
    expect(stageLabel({ stage: 2, purpose: "contract" })).toBe("Stage 2");
    expect(stageLabel({ stage: 1, purpose: "kseb_fees" })).toBe("KSEB fee 1");
  });
});

describe("PaymentLedger", () => {
  it("lists entries in collection order with per-purpose stage numbers", () => {
    render(<PaymentLedger payments={LEDGER} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "Stage 1",
      "KSEB fee 1",
      "Stage 2",
      "Stage 3",
    ]);
    expect(within(rows[0]).getByText("₹1,00,000.00")).toBeInTheDocument();
    expect(within(rows[0]).getByText("UTR 1001")).toBeInTheDocument();
    expect(within(rows[1]).getByText("KSEB fees")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Subsidy credit")).toBeInTheDocument();
    expect(within(rows[3]).getByText("BSS Admin")).toBeInTheDocument();
  });

  it("renders the same entries as cards for phones", () => {
    render(<PaymentLedger payments={LEDGER} />);
    const cards = within(screen.getByRole("list", { name: "Payments" })).getAllByRole(
      "listitem",
    );
    expect(cards).toHaveLength(4);
    expect(within(cards[3]).getByText("Stage 3")).toBeInTheDocument();
    expect(within(cards[3]).getByText("₹40,000.00")).toBeInTheDocument();
  });

  it("adds per-row actions only when asked", () => {
    const { rerender } = render(<PaymentLedger payments={LEDGER} />);
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();

    rerender(
      <PaymentLedger
        payments={LEDGER}
        renderActions={(p) => <button type="button">Edit {stageLabel(p)}</button>}
      />,
    );
    // Once in the table, once in the cards.
    expect(screen.getAllByRole("button", { name: "Edit Stage 2" })).toHaveLength(2);
  });

  it("drops the recorder and notes when compact", () => {
    render(<PaymentLedger payments={LEDGER} compact />);
    expect(screen.queryByText("Recorded by")).not.toBeInTheDocument();
    expect(screen.queryByText("Subsidy credit")).not.toBeInTheDocument();
  });
});

describe("ContractSummary", () => {
  it("shows collection progress and the balance due", () => {
    render(
      <ContractSummary
        source={{ total_cost: 300000, advance_amount: 50000, payments_total: 200000 }}
        ksebFeesCollected={5900}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "83");
    expect(screen.getByText("83% collected")).toBeInTheDocument();
    expect(screen.getByText("Balance due").nextSibling).toHaveTextContent("₹50,000.00");
    expect(screen.getByText("KSEB fees collected")).toBeInTheDocument();
  });

  it("hides the KSEB line when nothing was collected through BSS", () => {
    render(
      <ContractSummary
        source={{ total_cost: 100000, advance_amount: 100000, payments_total: 0 }}
      />,
    );
    expect(screen.getByText("Paid in full")).toBeInTheDocument();
    expect(screen.queryByText("KSEB fees collected")).not.toBeInTheDocument();
  });
});
