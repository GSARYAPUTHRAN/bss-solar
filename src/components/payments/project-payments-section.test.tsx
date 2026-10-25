// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/payments/actions", () => ({
  recordPayment: vi.fn(),
  updatePayment: vi.fn(),
  deletePayment: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/data/payments.repository", () => ({
  paymentsRepository: { listForWorkOrder: vi.fn() },
}));

import { paymentsRepository } from "@/server/data/payments.repository";
import type { Payment } from "@/lib/types";
import { ProjectPaymentsSection } from "./project-payments-section";

const STAGE_1 = {
  id: "pay-1",
  work_order_id: "wo1",
  amount: 100000,
  paid_on: "2026-09-20",
  method: "bank_transfer",
  purpose: "contract",
  reference: "UTR 1",
  notes: null,
  created_at: "2026-09-20T10:00:00Z",
} as Payment;

const PROPS = {
  workOrderId: "wo1",
  projectId: "p1",
  totalCost: 195000,
  advanceAmount: 20000,
  isCompleted: true,
  viewer: { canRecord: true, canEdit: true, canDelete: false },
};

beforeEach(() => {
  vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([STAGE_1]);
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
