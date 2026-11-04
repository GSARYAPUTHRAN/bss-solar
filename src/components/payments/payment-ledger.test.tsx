// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PaymentLedger, entryName, stageLabel } from "./payment-ledger";
import { ContractSummary } from "./contract-summary";
import { formatCurrency } from "@/lib/format";
import type { Payment } from "@/lib/types";

function payment(overrides: Partial<Payment> & Pick<Payment, "id">): Payment {
  return {
    work_order_id: "wo-1",
    amount: 10000,
    paid_on: "2026-09-01",
    method: "upi",
    purpose: "contract",
    paid_by_office: false,
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

  it("names a refund and a write-off for what they are, not as a stage", () => {
    expect(stageLabel({ stage: null, purpose: "refund" })).toBe("Refund");
    expect(stageLabel({ stage: null, purpose: "write_off" })).toBe("Write-off");
  });
});

describe("entryName", () => {
  it("is the lower-case noun a screen reader or a sentence wants", () => {
    expect(entryName({ stage: 2, purpose: "contract" })).toBe("stage 2 payment");
    expect(entryName({ stage: 1, purpose: "kseb_fees" })).toBe("kseb fee 1 payment");
    expect(entryName({ stage: null, purpose: "refund" })).toBe("refund");
    expect(entryName({ stage: null, purpose: "write_off" })).toBe("write-off");
  });
});

describe("PaymentLedger — refunds, write-offs and KSEB fees", () => {
  const MIXED: Payment[] = [
    payment({ id: "a", amount: 150000, paid_on: "2026-09-01", reference: "UTR 1001" }),
    payment({
      id: "r",
      amount: 10000,
      paid_on: "2026-09-10",
      purpose: "refund",
      reference: "UTR 9021",
      notes: "Excess collected, returned",
    }),
    payment({
      id: "w",
      amount: 800,
      paid_on: "2026-09-12",
      purpose: "write_off",
      method: "other",
      notes: "Customer was ₹800 short at handover",
    }),
    payment({
      id: "k1",
      amount: 4720,
      paid_on: "2026-09-02",
      purpose: "kseb_fees",
      reference: "UPI 66",
    }),
    payment({
      id: "k2",
      amount: 5720,
      paid_on: "2026-09-03",
      purpose: "kseb_fees",
      paid_by_office: true,
      method: "cash",
    }),
  ];

  function tableRow(label: string): HTMLElement {
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const row = rows.find((r) => within(r).getAllByRole("cell")[0].textContent === label);
    if (!row) throw new Error(`no row ${label}`);
    return row;
  }

  it("numbers only the collections: a refund and a write-off are not stages", () => {
    render(<PaymentLedger payments={MIXED} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "Stage 1",
      "KSEB fee 1",
      "KSEB fee 2",
      "Refund",
      "Write-off",
    ]);
  });

  it("shows a refund as money out: red, with a minus sign", () => {
    render(<PaymentLedger payments={MIXED} />);
    const amount = within(tableRow("Refund")).getByText(`−${formatCurrency(10000)}`);
    expect(amount).toHaveClass("text-red-700");
    // Money in carries no sign and no red.
    const stage = within(tableRow("Stage 1")).getByText(formatCurrency(150000));
    expect(stage.className).not.toMatch(/red/);
    expect(stage.textContent?.startsWith("−")).toBe(false);
  });

  it("shows a write-off by its reason, with no method (no money moved)", () => {
    render(<PaymentLedger payments={MIXED} compact />);
    const row = tableRow("Write-off");
    expect(within(row).getByText("Written off — Customer was ₹800 short at handover")).toBeInTheDocument();
    expect(within(row).getByText(formatCurrency(800))).toHaveClass("text-muted-foreground");
    const cells = within(row).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("Other");
  });

  it("tags a KSEB fee the office paid, and leaves the customer's untagged", () => {
    render(<PaymentLedger payments={MIXED} />);
    expect(within(tableRow("KSEB fee 2")).getByText("Paid by office")).toBeInTheDocument();
    expect(within(tableRow("KSEB fee 1")).queryByText("Paid by office")).not.toBeInTheDocument();
    // Both are KSEB fees, at a glance.
    expect(within(tableRow("KSEB fee 1")).getByText("KSEB fees")).toBeInTheDocument();
    expect(within(tableRow("KSEB fee 2")).getByText("KSEB fees")).toBeInTheDocument();
  });

  it("tells a refund and a write-off apart by their badge as well", () => {
    render(<PaymentLedger payments={MIXED} />);
    expect(within(tableRow("Refund")).getAllByText("Refund")).toHaveLength(2);
    expect(within(tableRow("Write-off")).getAllByText("Write-off")).toHaveLength(2);
  });

  it("reads the same on a phone", () => {
    render(<PaymentLedger payments={MIXED} />);
    const cards = within(screen.getByRole("list", { name: "Payments" })).getAllByRole("listitem");
    const refund = cards.find((c) => within(c).queryByText("Refund", { selector: "p" }));
    const writeOff = cards.find((c) => within(c).queryByText("Write-off", { selector: "p" }));
    expect(refund).toBeDefined();
    expect(within(refund!).getByText(`−${formatCurrency(10000)}`)).toHaveClass("text-red-700");
    expect(
      within(writeOff!).getByText("Written off — Customer was ₹800 short at handover"),
    ).toBeInTheDocument();
    expect(within(cards[2]).getByText("Paid by office")).toBeInTheDocument();
  });

  it("gives the actions callback a refund and a write-off to render", () => {
    render(
      <PaymentLedger
        payments={MIXED}
        renderActions={(p) => <button type="button">Edit {entryName(p)}</button>}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Edit refund" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit write-off" })).toHaveLength(2);
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
