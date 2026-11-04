// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/app/(app)/payments/actions", () => ({
  recordPayment: vi.fn(),
  updatePayment: vi.fn(),
  deletePayment: vi.fn(),
  writeOffBalance: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/data/payments.repository", () => ({
  paymentsRepository: { listForWorkOrder: vi.fn() },
}));
vi.mock("@/server/data/work-orders.repository", () => ({
  workOrdersRepository: { advanceDetails: vi.fn() },
}));

import { paymentsRepository } from "@/server/data/payments.repository";
import { workOrdersRepository } from "@/server/data/work-orders.repository";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Payment } from "@/lib/types";
import { ProjectPaymentsSection } from "./project-payments-section";

function entry(overrides: Partial<Payment> & Pick<Payment, "id" | "amount">): Payment {
  return {
    work_order_id: "wo1",
    paid_on: "2026-09-20",
    method: "bank_transfer",
    purpose: "contract",
    paid_by_office: false,
    reference: null,
    notes: null,
    recorded_by: "admin-1",
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

const STAGE_1 = entry({ id: "pay-1", amount: 100000, reference: "UTR 1" });

const PROPS = {
  workOrderId: "wo1",
  projectId: "p1",
  totalCost: 195000,
  advanceAmount: 20000,
  isCompleted: true,
  viewer: { canRecord: true, canEdit: true, canDelete: false },
};

const NO_DETAILS = { advance_method: null, advance_paid_on: null, advance_reference: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([STAGE_1]);
  vi.mocked(workOrdersRepository.advanceDetails).mockResolvedValue(NO_DETAILS);
});

describe("ProjectPaymentsSection", () => {
  it("a commissioned project with money outstanding is a pending payment", async () => {
    render(await ProjectPaymentsSection(PROPS));
    expect(screen.getAllByText(/payment pending/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/project refunded/i)).not.toBeInTheDocument();
  });

  it("a refunded project's balance is no longer receivable — shown, never alarming", async () => {
    render(await ProjectPaymentsSection({ ...PROPS, cancellation: "refunded" }));

    expect(screen.getByText(/not collected — project refunded/i)).toBeInTheDocument();
    expect(screen.getByText("Nothing due — refunded")).toBeInTheDocument();
    expect(screen.queryByText(/payment pending/i)).not.toBeInTheDocument();
    // The ledger itself is history: still listed.
    expect(screen.getAllByText("UTR 1").length).toBeGreaterThan(0);
  });
});

describe("ProjectPaymentsSection — the advance", () => {
  it("heads the ledger with how and when the advance was paid", async () => {
    vi.mocked(workOrdersRepository.advanceDetails).mockResolvedValue({
      advance_method: "upi",
      advance_paid_on: "2025-02-04",
      advance_reference: "UPI 4410021199",
    });
    render(await ProjectPaymentsSection(PROPS));
    expect(
      screen.getByText(
        `Advance ${formatCurrency(20000)} · UPI · ${formatDate("2025-02-04")} · UPI 4410021199`,
      ),
    ).toBeInTheDocument();
    expect(workOrdersRepository.advanceDetails).toHaveBeenCalledWith("wo1");
  });

  it("uses the details the page already has, without asking again", async () => {
    render(
      await ProjectPaymentsSection({
        ...PROPS,
        advance: { advance_method: "cash", advance_paid_on: null, advance_reference: null },
      }),
    );
    expect(screen.getByText(`Advance ${formatCurrency(20000)} · Cash`)).toBeInTheDocument();
    expect(workOrdersRepository.advanceDetails).not.toHaveBeenCalled();
  });

  it("shows just the amount when nothing was recorded about it", async () => {
    render(await ProjectPaymentsSection(PROPS));
    expect(screen.getByText(`Advance ${formatCurrency(20000)}`)).toBeInTheDocument();
  });

  it("shows nothing for a sale with no advance and no details", async () => {
    render(await ProjectPaymentsSection({ ...PROPS, advanceAmount: 0 }));
    expect(screen.queryByText(/^Advance ₹/)).not.toBeInTheDocument();
  });
});

describe("ProjectPaymentsSection — refunds, write-offs and KSEB fees", () => {
  const REFUND = entry({
    id: "pay-r",
    amount: 10000,
    purpose: "refund",
    paid_on: "2026-09-25",
    notes: "Excess collected, returned",
  });
  const WRITE_OFF = entry({
    id: "pay-w",
    amount: 800,
    purpose: "write_off",
    paid_on: "2026-09-26",
    method: "other",
    notes: "Customer was short at handover",
  });
  const OFFICE_FEE = entry({
    id: "pay-k",
    amount: 5720,
    purpose: "kseb_fees",
    paid_by_office: true,
    paid_on: "2026-09-02",
    method: "cash",
  });
  const CUSTOMER_FEE = entry({
    id: "pay-c",
    amount: 4720,
    purpose: "kseb_fees",
    paid_on: "2026-09-03",
  });

  it("reads the net received and the balance after a refund on a completed project", async () => {
    // 20,000 + 1,75,000 collected, 10,000 refunded: net 1,85,000, 10,000 due.
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      entry({ id: "pay-1", amount: 175000 }),
      REFUND,
    ]);
    render(await ProjectPaymentsSection(PROPS));

    const value = (label: string) => screen.getByText(label).nextElementSibling;
    expect(value("Collected")).toHaveTextContent(formatCurrency(195000));
    expect(value("Refunded")).toHaveTextContent(`−${formatCurrency(10000)}`);
    expect(value("Net received")).toHaveTextContent(formatCurrency(185000));
    expect(value("Balance due")).toHaveTextContent(formatCurrency(10000));
    // The refund brought the money back due: the sale is a pending payment again.
    expect(screen.getAllByText(/payment pending/i).length).toBeGreaterThan(0);
  });

  it("settles a shortfall the office wrote off, and says so", async () => {
    // 1,75,000 sold, 15,000 + 1,59,200 collected, 800 written off.
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      entry({ id: "pay-1", amount: 159200 }),
      WRITE_OFF,
    ]);
    render(
      await ProjectPaymentsSection({ ...PROPS, totalCost: 175000, advanceAmount: 15000 }),
    );

    expect(screen.getByText(`Settled — ${formatCurrency(800)} written off`)).toBeInTheDocument();
    expect(screen.getByText("Written off").nextElementSibling).toHaveTextContent(
      formatCurrency(800),
    );
    expect(screen.getByText("Balance due").nextElementSibling).toHaveTextContent(
      formatCurrency(0),
    );
    expect(screen.queryByText(/payment pending/i)).not.toBeInTheDocument();
    // The reason is in the ledger, with the entry.
    expect(
      screen.getAllByText("Written off — Customer was short at handover").length,
    ).toBeGreaterThan(0);
    // Nothing left to write off: the dialog is not offered.
    expect(screen.queryByRole("button", { name: /write off balance/i })).not.toBeInTheDocument();
  });

  it("keeps KSEB fees apart from the contract, the office's from the customer's", async () => {
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      STAGE_1,
      OFFICE_FEE,
      CUSTOMER_FEE,
    ]);
    render(await ProjectPaymentsSection(PROPS));

    expect(screen.getByText("KSEB fees collected").nextElementSibling).toHaveTextContent(
      formatCurrency(4720),
    );
    expect(screen.getByText("KSEB fees paid by office").nextElementSibling).toHaveTextContent(
      formatCurrency(5720),
    );
    // Neither is in what the customer owes: 1,95,000 − 20,000 − 1,00,000.
    expect(screen.getByText("Balance due").nextElementSibling).toHaveTextContent(
      formatCurrency(75000),
    );
    // The office-paid one wears its tag, in the table and in the cards.
    expect(screen.getAllByText("Paid by office")).toHaveLength(2);
  });

  it("names each entry for what it is, so the right one is edited", async () => {
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      STAGE_1,
      REFUND,
      entry({ id: "pay-g", amount: 1000, purpose: "write_off", notes: "Waived" }),
    ]);
    render(await ProjectPaymentsSection(PROPS));
    expect(screen.getAllByRole("button", { name: "Edit stage 1 payment" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit refund" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit write-off" })).toHaveLength(2);
  });
});

describe("ProjectPaymentsSection — who may do what", () => {
  it("offers the office both Record payment and Write off balance while money is due", async () => {
    render(await ProjectPaymentsSection(PROPS));
    expect(screen.getByRole("button", { name: /record payment/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /write off balance/i })).toBeInTheDocument();
  });

  it("offers a coordinator neither: the ledger is read-only for them", async () => {
    render(
      await ProjectPaymentsSection({
        ...PROPS,
        viewer: { canRecord: false, canEdit: false, canDelete: false },
      }),
    );
    expect(screen.queryByRole("button", { name: /record payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /write off/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("UTR 1").length).toBeGreaterThan(0);
  });

  it("offers no write-off once the contract is settled", async () => {
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      entry({ id: "pay-1", amount: 175000 }),
    ]);
    render(await ProjectPaymentsSection(PROPS));
    expect(screen.getByRole("button", { name: /record payment/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /write off balance/i })).not.toBeInTheDocument();
  });

  it("offers no write-off on a cancelled or refunded sale: its balance is not receivable", async () => {
    render(await ProjectPaymentsSection({ ...PROPS, cancellation: "cancelled" }));
    expect(screen.getByRole("button", { name: /record payment/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /write off balance/i })).not.toBeInTheDocument();
  });

  it("gives only the SuperAdmin a delete, worded for what is deleted", async () => {
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      STAGE_1,
      entry({ id: "pay-r", amount: 10000, purpose: "refund", paid_on: "2026-09-25" }),
    ]);
    const { rerender } = render(await ProjectPaymentsSection(PROPS));
    expect(screen.queryByRole("button", { name: /^delete/i })).not.toBeInTheDocument();

    rerender(
      await ProjectPaymentsSection({
        ...PROPS,
        viewer: { canRecord: true, canEdit: true, canDelete: true },
      }),
    );
    expect(screen.getAllByRole("button", { name: "Delete stage 1 payment" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete refund" })).toHaveLength(2);
  });
});

describe("ProjectPaymentsSection — the ledger", () => {
  it("lists a refund as a negative line and a write-off by its reason, among the instalments", async () => {
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      STAGE_1,
      entry({ id: "pay-r", amount: 10000, purpose: "refund", paid_on: "2026-09-25" }),
    ]);
    render(await ProjectPaymentsSection(PROPS));
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "Stage 1",
      "Refund",
    ]);
    expect(within(rows[1]).getByText(`−${formatCurrency(10000)}`)).toBeInTheDocument();
    expect(screen.getByText(/1 instalment after the advance/)).toBeInTheDocument();
  });
});
