// @vitest-environment jsdom
// The per-row delete of a ledger entry, shared by the project's payments section
// and the work order's own ledger. Amounts are compared through formatCurrency
// so the assertions do not depend on the ICU build's rupee formatting.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ deletePayment: vi.fn() }));
vi.mock("@/app/(app)/payments/actions", () => actions);

import { formatCurrency, formatDate } from "@/lib/format";
import type { StagedPayment } from "./payment-ledger";
import { LedgerEntryDelete, ledgerDeleteDescription } from "./ledger-entry-delete";

function staged(overrides: Partial<StagedPayment> & Pick<StagedPayment, "id" | "amount">): StagedPayment {
  return {
    work_order_id: "wo-1",
    paid_on: "2026-09-20",
    method: "bank_transfer",
    purpose: "contract",
    paid_by_office: false,
    reference: null,
    notes: null,
    recorded_by: "admin-1",
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
    stage: 1,
    ...overrides,
  };
}

const STAGE_2 = staged({ id: "pay-2", amount: 50000, stage: 2 });
const REFUND = staged({ id: "ref-1", amount: 10000, purpose: "refund", stage: null });
const WRITE_OFF = staged({ id: "wo-off", amount: 800, purpose: "write_off", stage: null });
const KSEB = staged({ id: "k-1", amount: 4720, purpose: "kseb_fees", stage: 1 });
const KSEB_BY_OFFICE = { ...KSEB, id: "k-2", paid_by_office: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ledgerDeleteDescription", () => {
  const on = formatDate("2026-09-20");

  it("says a payment's balance goes back up", () => {
    expect(ledgerDeleteDescription(STAGE_2)).toBe(
      `Stage 2 · ${formatCurrency(50000)} received ${on}. It is removed from the ledger for good and the balance due goes back up. This cannot be undone.`,
    );
  });

  it("says a refund's net received goes back up", () => {
    expect(ledgerDeleteDescription(REFUND)).toBe(
      `Refund · ${formatCurrency(10000)} paid back ${on}. It is removed from the ledger for good: the net received goes back up and the balance due falls by the same amount. This cannot be undone.`,
    );
  });

  it("says a write-off's amount becomes due again", () => {
    expect(ledgerDeleteDescription(WRITE_OFF)).toBe(
      `Write-off · ${formatCurrency(800)} written off ${on}. It is removed from the ledger for good and the ${formatCurrency(800)} becomes due again. This cannot be undone.`,
    );
  });

  it("says a KSEB fee leaves the contract alone, and who paid it", () => {
    expect(ledgerDeleteDescription(KSEB)).toBe(
      `KSEB fee 1 · ${formatCurrency(4720)} received ${on}. It is removed from the ledger for good. The contract balance is not affected. This cannot be undone.`,
    );
    expect(ledgerDeleteDescription(KSEB_BY_OFFICE)).toContain("paid by the office");
  });
});

describe("LedgerEntryDelete", () => {
  it("is an icon button named for the entry, big enough to tap", () => {
    render(<LedgerEntryDelete payment={STAGE_2} workOrderId="wo-1" />);
    expect(screen.getByRole("button", { name: "Delete stage 2 payment" })).toHaveClass("size-10");
  });

  it("asks first, naming the entry for what it is", async () => {
    const user = userEvent.setup();
    render(<LedgerEntryDelete payment={REFUND} workOrderId="wo-1" />);
    await user.click(screen.getByRole("button", { name: "Delete refund" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete this refund?" });
    expect(dialog).toHaveAccessibleDescription(ledgerDeleteDescription(REFUND));
    expect(within(dialog).getByRole("button", { name: "Delete refund" })).toBeInTheDocument();
    expect(actions.deletePayment).not.toHaveBeenCalled();
  });

  it("calls a write-off a write-off, not a payment", async () => {
    const user = userEvent.setup();
    render(<LedgerEntryDelete payment={WRITE_OFF} workOrderId="wo-1" />);
    await user.click(screen.getByRole("button", { name: "Delete write-off" }));
    expect(await screen.findByRole("dialog", { name: "Delete this write-off?" })).toBeInTheDocument();
  });

  it("posts the entry and its work order to deletePayment", async () => {
    const user = userEvent.setup();
    render(<LedgerEntryDelete payment={STAGE_2} workOrderId="wo-1" />);
    await user.click(screen.getByRole("button", { name: "Delete stage 2 payment" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete payment" }));

    await vi.waitFor(() => expect(actions.deletePayment).toHaveBeenCalledTimes(1));
    const formData = actions.deletePayment.mock.calls[0][0] as FormData;
    expect(formData.get("id")).toBe("pay-2");
    expect(formData.get("work_order_id")).toBe("wo-1");
  });
});
