import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Payment, Profile, WorkOrder } from "@/lib/types";

// redirect() throws in Next; emulate that so the target can be asserted.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(),
  requireSuperAdmin: vi.fn(),
}));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/data/payments.repository", () => ({
  paymentsRepository: {
    listForWorkOrder: vi.fn(),
    byId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("@/server/data/work-orders.repository", () => ({
  workOrdersRepository: { byId: vi.fn() },
}));
vi.mock("@/lib/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format")>()),
  todayISO: () => "2026-10-10",
}));

import { revalidatePath } from "next/cache";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { notify } from "@/server/notifications";
import { paymentsRepository } from "@/server/data/payments.repository";
import { workOrdersRepository } from "@/server/data/work-orders.repository";
import { WRITE_OFF_REASON_ERROR } from "@/server/forms/payment";
import {
  deletePayment,
  recordPayment,
  updatePayment,
  writeOffBalance,
} from "./actions";

const payments = vi.mocked(paymentsRepository);
const workOrders = vi.mocked(workOrdersRepository);

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;

// ₹1,95,000 contract, ₹20,000 advance, ₹80,000 stage 1 → ₹95,000 due.
const WORK_ORDER = {
  id: "wo-1",
  coordinator_id: "coord-1",
  coordinators: [{ id: "coord-1", full_name: "Rahul Menon", sort_order: 1, incentive: null }],
  client_name: "Anand Kumar",
  total_cost: 195000,
  advance_amount: 20000,
  project: {
    id: "proj-1",
    current_stage: "material_dispatch",
    is_completed: false,
    cancellation: null,
  },
} as WorkOrder;

/** Rahul's sale, shared with Priya. */
const SHARED_WORK_ORDER = {
  ...WORK_ORDER,
  coordinators: [
    ...WORK_ORDER.coordinators,
    { id: "coord-2", full_name: "Priya Suresh", sort_order: 2, incentive: null },
  ],
} as WorkOrder;

function cancelled(cancellation: "cancelled" | "refunded"): WorkOrder {
  return {
    ...WORK_ORDER,
    project: { ...WORK_ORDER.project!, cancellation },
  } as WorkOrder;
}

/** A commissioned sale of `total` with `advance` taken at booking. */
function commissioned(total: number, advance: number): WorkOrder {
  return {
    ...WORK_ORDER,
    total_cost: total,
    advance_amount: advance,
    project: { ...WORK_ORDER.project!, is_completed: true },
  } as WorkOrder;
}

function stored(overrides: Partial<Payment> & Pick<Payment, "id" | "amount">): Payment {
  return {
    work_order_id: "wo-1",
    paid_on: "2026-09-20",
    purpose: "contract",
    paid_by_office: false,
    created_at: "2026-09-20T10:00:00Z",
    ...overrides,
  } as Payment;
}

const STAGE_1 = stored({ id: "pay-1", amount: 80000 });

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ENTRY = {
  amount: "45000",
  paid_on: "2026-10-01",
  method: "bank_transfer",
  kind: "contract",
  reference: "UTR 1",
};

const WRITE_OFF = {
  amount: "800",
  paid_on: "2026-10-01",
  reason: "Customer was ₹800 short at handover; waived by the office",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  vi.mocked(requireSuperAdmin).mockResolvedValue({ ...ADMIN, role: "superadmin" });
  workOrders.byId.mockResolvedValue(WORK_ORDER);
  payments.listForWorkOrder.mockResolvedValue([STAGE_1]);
  payments.byId.mockResolvedValue(STAGE_1);
  payments.create.mockResolvedValue({ id: "pay-2", error: null });
  payments.update.mockResolvedValue({ error: null });
  payments.remove.mockResolvedValue({ error: null });
});

describe("recordPayment", () => {
  it("is office-only: a refused guard touches nothing", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(
      recordPayment(null, form({ ...ENTRY, work_order_id: "wo-1" })),
    ).rejects.toThrow("REDIRECT:/work-orders");
    expect(payments.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns a validation message without reading the ledger", async () => {
    const res = await recordPayment(
      null,
      form({ ...ENTRY, paid_on: "2026-10-11", work_order_id: "wo-1" }),
    );
    expect(res).toEqual({ ok: false, error: "The payment date cannot be in the future." });
    expect(payments.listForWorkOrder).not.toHaveBeenCalled();
  });

  it("refuses a contract payment above the balance", async () => {
    const res = await recordPayment(
      null,
      form({ ...ENTRY, amount: "95000.01", work_order_id: "wo-1" }),
    );
    expect(res?.ok).toBe(false);
    expect(payments.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports a missing work order plainly", async () => {
    workOrders.byId.mockResolvedValue(null);
    const res = await recordPayment(null, form({ ...ENTRY, work_order_id: "gone" }));
    expect(res).toEqual({
      ok: false,
      error: "Work order not found — it may have been deleted.",
    });
  });

  it("records, tells the coordinator the new balance and refreshes every view", async () => {
    const res = await recordPayment(null, form({ ...ENTRY, work_order_id: "wo-1" }));

    expect(res).toEqual({ ok: true, data: { message: "Payment of ₹45,000.00 recorded." } });
    expect(payments.create).toHaveBeenCalledWith(
      "wo-1",
      {
        amount: 45000,
        paid_on: "2026-10-01",
        method: "bank_transfer",
        purpose: "contract",
        paid_by_office: false,
        reference: "UTR 1",
        notes: null,
      },
      "admin-1",
    );
    expect(notify).toHaveBeenCalledWith({
      type: "payment.recorded",
      actorId: "admin-1",
      coordinatorIds: ["coord-1"],
      workOrderId: "wo-1",
      projectId: "proj-1",
      clientName: "Anand Kumar",
      amount: 45000,
      purpose: "contract",
      paidByOffice: false,
      balanceDue: 50000,
      cancellation: null,
    });
    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toEqual(
      expect.arrayContaining(["/projects/proj-1", "/work-orders/wo-1", "/projects", "/work-orders", "/"]),
    );
  });

  it("tells every coordinator on a shared sale", async () => {
    workOrders.byId.mockResolvedValue(SHARED_WORK_ORDER);
    await recordPayment(null, form({ ...ENTRY, work_order_id: "wo-1" }));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "payment.recorded",
        coordinatorIds: ["coord-1", "coord-2"],
        balanceDue: 50000,
        cancellation: null,
      }),
    );
  });

  it("reports what is still due, not the ledger's balance, when the entry settles the contract", async () => {
    await recordPayment(null, form({ ...ENTRY, amount: "95000", work_order_id: "wo-1" }));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 95000, balanceDue: 0 }),
    );
  });

  it.each(["cancelled", "refunded"] as const)(
    "on a %s project the ledger still takes the money but nothing is reported as still due",
    async (cancellation) => {
      workOrders.byId.mockResolvedValue(cancelled(cancellation));
      const res = await recordPayment(null, form({ ...ENTRY, work_order_id: "wo-1" }));
      expect(res?.ok).toBe(true);
      expect(payments.create).toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "payment.recorded",
          amount: 45000,
          // 50,000 would still be owed on a live project; here it is not collectable.
          balanceDue: 0,
          cancellation,
        }),
      );
    },
  );

  it("surfaces a persistence error and does not notify", async () => {
    payments.create.mockResolvedValue({ id: null, error: "Payment was not recorded — office staff only." });
    const res = await recordPayment(null, form({ ...ENTRY, work_order_id: "wo-1" }));
    expect(res).toEqual({ ok: false, error: "Payment was not recorded — office staff only." });
    expect(notify).not.toHaveBeenCalled();
  });

  describe("a KSEB fee", () => {
    it("collected from the customer never changes the contract balance it reports", async () => {
      const res = await recordPayment(
        null,
        form({ ...ENTRY, kind: "kseb_customer", amount: "3540", work_order_id: "wo-1" }),
      );
      expect(res).toEqual({ ok: true, data: { message: "KSEB fee of ₹3,540.00 recorded." } });
      expect(payments.create).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ purpose: "kseb_fees", paid_by_office: false }),
        "admin-1",
      );
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 3540,
          purpose: "kseb_fees",
          paidByOffice: false,
          balanceDue: 95000,
        }),
      );
    });

    it("paid by the office is stored as such, is never capped, and says who paid", async () => {
      workOrders.byId.mockResolvedValue(commissioned(100000, 100000));
      payments.listForWorkOrder.mockResolvedValue([]);
      const res = await recordPayment(
        null,
        form({ ...ENTRY, kind: "kseb_office", amount: "5720", work_order_id: "wo-1" }),
      );
      expect(res).toEqual({
        ok: true,
        data: { message: "KSEB fee of ₹5,720.00 recorded as paid by the office." },
      });
      expect(payments.create).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ purpose: "kseb_fees", paid_by_office: true }),
        "admin-1",
      );
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "kseb_fees", paidByOffice: true, balanceDue: 0 }),
      );
    });
  });

  describe("a refund", () => {
    // ₹1,95,000 sold; ₹20,000 advance + ₹80,000 + ₹95,000 collected: settled, and
    // the plant is commissioned.
    const settled = [STAGE_1, stored({ id: "pay-2", amount: 95000, paid_on: "2026-09-25" })];

    beforeEach(() => {
      workOrders.byId.mockResolvedValue(commissioned(195000, 20000));
      payments.listForWorkOrder.mockResolvedValue(settled);
    });

    it("on a completed project lowers the net received and keeps the project live", async () => {
      const res = await recordPayment(
        null,
        form({ ...ENTRY, kind: "refund", amount: "10000", work_order_id: "wo-1" }),
      );

      expect(res).toEqual({ ok: true, data: { message: "Refund of ₹10,000.00 recorded." } });
      expect(payments.create).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ purpose: "refund", amount: 10000, paid_by_office: false }),
        "admin-1",
      );
      // ₹10,000 of the ₹1,95,000 went back, so ₹10,000 is due again — and the
      // sale is still a live, commissioned project (no cancellation).
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: "refund",
          amount: 10000,
          balanceDue: 10000,
          cancellation: null,
        }),
      );
      expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/projects/proj-1");
    });

    it("may be as much as was collected, and no more", async () => {
      // 20,000 + 80,000 + 95,000.
      const all = await recordPayment(
        null,
        form({ ...ENTRY, kind: "refund", amount: "195000", work_order_id: "wo-1" }),
      );
      expect(all?.ok).toBe(true);

      vi.clearAllMocks();
      const over = await recordPayment(
        null,
        form({ ...ENTRY, kind: "refund", amount: "195000.01", work_order_id: "wo-1" }),
      );
      expect(over).toEqual({
        ok: false,
        error: expect.stringMatching(/^A refund of ₹1,95,000\.01 is more than the ₹1,95,000\.00 collected/),
      });
      expect(payments.create).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("counts refunds already made against what was collected", async () => {
      payments.listForWorkOrder.mockResolvedValue([
        ...settled,
        stored({ id: "pay-3", amount: 150000, purpose: "refund", paid_on: "2026-09-28" }),
      ]);
      const over = await recordPayment(
        null,
        form({ ...ENTRY, kind: "refund", amount: "45000.01", work_order_id: "wo-1" }),
      );
      expect(over?.ok).toBe(false);
      const exact = await recordPayment(
        null,
        form({ ...ENTRY, kind: "refund", amount: "45000", work_order_id: "wo-1" }),
      );
      expect(exact?.ok).toBe(true);
    });

    it("is office-only", async () => {
      vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
      await expect(
        recordPayment(null, form({ ...ENTRY, kind: "refund", work_order_id: "wo-1" })),
      ).rejects.toThrow("REDIRECT:/work-orders");
      expect(payments.create).not.toHaveBeenCalled();
    });

    it("makes room for the customer to pay again what was returned", async () => {
      payments.listForWorkOrder.mockResolvedValue([
        ...settled,
        stored({ id: "pay-3", amount: 10000, purpose: "refund", paid_on: "2026-09-28" }),
      ]);
      const exact = await recordPayment(
        null,
        form({ ...ENTRY, amount: "10000", work_order_id: "wo-1" }),
      );
      expect(exact?.ok).toBe(true);
      const over = await recordPayment(
        null,
        form({ ...ENTRY, amount: "10000.01", work_order_id: "wo-1" }),
      );
      expect(over?.ok).toBe(false);
    });
  });

  it("a contract payment can no longer take what was written off", async () => {
    // ₹1,75,000 sold, ₹15,000 advance + ₹1,59,200 collected, ₹800 written off.
    workOrders.byId.mockResolvedValue(commissioned(175000, 15000));
    payments.listForWorkOrder.mockResolvedValue([
      stored({ id: "pay-1", amount: 159200 }),
      stored({ id: "pay-2", amount: 800, purpose: "write_off", notes: "Waived" }),
    ]);
    const res = await recordPayment(null, form({ ...ENTRY, amount: "1", work_order_id: "wo-1" }));
    expect(res).toEqual({
      ok: false,
      error: expect.stringMatching(/^Nothing is due on this contract/),
    });
    expect(payments.create).not.toHaveBeenCalled();
  });
});

describe("writeOffBalance", () => {
  // ₹1,75,000 sold, ₹15,000 advance + ₹1,59,200 collected: ₹800 short at handover.
  const SHORT = commissioned(175000, 15000);
  const COLLECTED = [stored({ id: "pay-1", amount: 159200, paid_on: "2026-08-01" })];

  beforeEach(() => {
    workOrders.byId.mockResolvedValue(SHORT);
    payments.listForWorkOrder.mockResolvedValue(COLLECTED);
  });

  it("settles a ₹800 shortfall: stored with its reason, announced as settled", async () => {
    const res = await writeOffBalance(null, form({ ...WRITE_OFF, work_order_id: "wo-1" }));

    expect(res).toEqual({
      ok: true,
      data: { message: "₹800.00 written off — the balance is settled." },
    });
    expect(payments.create).toHaveBeenCalledWith(
      "wo-1",
      {
        amount: 800,
        paid_on: "2026-10-01",
        method: "other",
        purpose: "write_off",
        paid_by_office: false,
        reference: null,
        notes: WRITE_OFF.reason,
      },
      "admin-1",
    );
    expect(notify).toHaveBeenCalledWith({
      type: "payment.recorded",
      actorId: "admin-1",
      coordinatorIds: ["coord-1"],
      workOrderId: "wo-1",
      projectId: "proj-1",
      clientName: "Anand Kumar",
      amount: 800,
      purpose: "write_off",
      paidByOffice: false,
      balanceDue: 0,
      cancellation: null,
    });
    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toEqual(
      expect.arrayContaining(["/projects/proj-1", "/work-orders/wo-1", "/projects", "/work-orders", "/"]),
    );
  });

  it("may be part of the balance, which then says what is still due", async () => {
    const res = await writeOffBalance(
      null,
      form({ ...WRITE_OFF, amount: "300", work_order_id: "wo-1" }),
    );
    expect(res).toEqual({
      ok: true,
      data: { message: "₹300.00 written off — ₹500.00 still due." },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "write_off", balanceDue: 500 }),
    );
  });

  it("is refused for anyone outside the office, and nothing is written", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(
      writeOffBalance(null, form({ ...WRITE_OFF, work_order_id: "wo-1" })),
    ).rejects.toThrow("REDIRECT:/work-orders");
    expect(payments.listForWorkOrder).not.toHaveBeenCalled();
    expect(payments.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("is refused without a reason, before the ledger is read", async () => {
    for (const reason of ["", "   "]) {
      const res = await writeOffBalance(
        null,
        form({ ...WRITE_OFF, reason, work_order_id: "wo-1" }),
      );
      expect(res).toEqual({ ok: false, error: WRITE_OFF_REASON_ERROR });
    }
    expect(payments.listForWorkOrder).not.toHaveBeenCalled();
    expect(payments.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("is refused above the balance due, naming it", async () => {
    const res = await writeOffBalance(
      null,
      form({ ...WRITE_OFF, amount: "800.01", work_order_id: "wo-1" }),
    );
    expect(res).toEqual({
      ok: false,
      error: expect.stringMatching(/^A write-off of ₹800\.01 is more than the ₹800\.00 balance due/),
    });
    expect(payments.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("is refused when nothing is due", async () => {
    payments.listForWorkOrder.mockResolvedValue([stored({ id: "pay-1", amount: 160000 })]);
    const res = await writeOffBalance(null, form({ ...WRITE_OFF, work_order_id: "wo-1" }));
    expect(res).toEqual({
      ok: false,
      error: expect.stringMatching(/there is nothing to write off\.$/),
    });
    expect(payments.create).not.toHaveBeenCalled();
  });

  it("counts what was refunded: the balance it can close is the one after refunds", async () => {
    payments.listForWorkOrder.mockResolvedValue([
      ...COLLECTED,
      stored({ id: "pay-2", amount: 1000, purpose: "refund", paid_on: "2026-09-01" }),
    ]);
    // 800 + 1,000 refunded = ₹1,800 due.
    const over = await writeOffBalance(
      null,
      form({ ...WRITE_OFF, amount: "1800.01", work_order_id: "wo-1" }),
    );
    expect(over?.ok).toBe(false);
    const exact = await writeOffBalance(
      null,
      form({ ...WRITE_OFF, amount: "1800", work_order_id: "wo-1" }),
    );
    expect(exact?.ok).toBe(true);
  });

  it("reports a missing work order plainly", async () => {
    workOrders.byId.mockResolvedValue(null);
    const res = await writeOffBalance(null, form({ ...WRITE_OFF, work_order_id: "gone" }));
    expect(res).toEqual({
      ok: false,
      error: "Work order not found — it may have been deleted.",
    });
  });

  it("surfaces a persistence error and does not notify", async () => {
    payments.create.mockResolvedValue({
      id: null,
      error: 'new row for relation "payments" violates check constraint',
    });
    const res = await writeOffBalance(null, form({ ...WRITE_OFF, work_order_id: "wo-1" }));
    expect(res?.ok).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("updatePayment", () => {
  it("releases the entry's own amount before applying the cap", async () => {
    // Stage 1 may grow to the full ₹1,75,000 still payable after the advance.
    const res = await updatePayment(null, form({ ...ENTRY, id: "pay-1", amount: "175000" }));
    expect(res).toEqual({ ok: true, data: { message: "Payment updated." } });
    expect(payments.update).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ amount: 175000 }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("asks for a refresh when the entry has gone", async () => {
    payments.byId.mockResolvedValue(null);
    const res = await updatePayment(null, form({ ...ENTRY, id: "pay-x" }));
    expect(res).toEqual({
      ok: false,
      error: "This payment no longer exists — refresh the page.",
    });
    expect(payments.update).not.toHaveBeenCalled();
  });

  it("refuses a payment above the balance, as recording does", async () => {
    const res = await updatePayment(null, form({ ...ENTRY, id: "pay-1", amount: "175000.01" }));
    expect(res?.ok).toBe(false);
    expect(payments.update).not.toHaveBeenCalled();
  });

  it("can turn a contract payment into a KSEB fee paid by the office", async () => {
    const res = await updatePayment(
      null,
      form({ ...ENTRY, id: "pay-1", kind: "kseb_office", amount: "5720" }),
    );
    expect(res?.ok).toBe(true);
    expect(payments.update).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ purpose: "kseb_fees", paid_by_office: true }),
    );
  });

  it("never turns an entry into a write-off", async () => {
    const res = await updatePayment(null, form({ ...ENTRY, id: "pay-1", kind: "write_off" }));
    expect(res).toEqual({ ok: false, error: "Choose what the payment is for." });
    expect(payments.update).not.toHaveBeenCalled();
  });

  it("will not lower a payment below the refund that was paid out of it", async () => {
    // Collected 20,000 + 80,000, of which 90,000 was refunded: ₹80,000 → ₹60,000
    // would leave the refund with only ₹80,000 behind it.
    payments.listForWorkOrder.mockResolvedValue([
      STAGE_1,
      stored({ id: "pay-r", amount: 90000, purpose: "refund", paid_on: "2026-09-25" }),
    ]);
    const res = await updatePayment(null, form({ ...ENTRY, id: "pay-1", amount: "60000", paid_on: "2026-09-20" }));
    expect(res).toEqual({
      ok: false,
      error: expect.stringMatching(/^This change would leave the refund of ₹90,000\.00/),
    });
    expect(payments.update).not.toHaveBeenCalled();
  });

  it("holds an edited refund to what was collected", async () => {
    const refund = stored({ id: "pay-r", amount: 50000, purpose: "refund", paid_on: "2026-09-25" });
    payments.listForWorkOrder.mockResolvedValue([STAGE_1, refund]);
    payments.byId.mockResolvedValue(refund);
    const over = await updatePayment(
      null,
      form({ ...ENTRY, id: "pay-r", kind: "refund", amount: "100000.01", paid_on: "2026-09-25" }),
    );
    expect(over?.ok).toBe(false);
    const exact = await updatePayment(
      null,
      form({ ...ENTRY, id: "pay-r", kind: "refund", amount: "100000", paid_on: "2026-09-25" }),
    );
    expect(exact?.ok).toBe(true);
  });

  describe("a write-off", () => {
    const WRITTEN_OFF = stored({
      id: "pay-w",
      amount: 800,
      purpose: "write_off",
      paid_on: "2026-09-25",
      notes: "Waived",
    });

    beforeEach(() => {
      workOrders.byId.mockResolvedValue(commissioned(175000, 15000));
      payments.listForWorkOrder.mockResolvedValue([
        stored({ id: "pay-1", amount: 159200 }),
        WRITTEN_OFF,
      ]);
      payments.byId.mockResolvedValue(WRITTEN_OFF);
    });

    it("is corrected as a write-off: an amount, a date and a reason", async () => {
      const res = await updatePayment(
        null,
        form({ id: "pay-w", amount: "700", paid_on: "2026-09-25", reason: "Agreed with Anand" }),
      );
      expect(res).toEqual({ ok: true, data: { message: "Write-off updated." } });
      expect(payments.update).toHaveBeenCalledWith("pay-w", {
        amount: 700,
        paid_on: "2026-09-25",
        method: "other",
        purpose: "write_off",
        paid_by_office: false,
        reference: null,
        notes: "Agreed with Anand",
      });
    });

    it("keeps its reason: a correction without one is refused", async () => {
      const res = await updatePayment(
        null,
        form({ id: "pay-w", amount: "800", paid_on: "2026-09-25", reason: " " }),
      );
      expect(res).toEqual({ ok: false, error: WRITE_OFF_REASON_ERROR });
      expect(payments.update).not.toHaveBeenCalled();
    });

    it("stays a write-off whatever kind the form claims", async () => {
      await updatePayment(
        null,
        form({
          id: "pay-w",
          kind: "contract",
          method: "cash",
          amount: "800",
          paid_on: "2026-09-25",
          reason: "Waived",
        }),
      );
      expect(payments.update).toHaveBeenCalledWith(
        "pay-w",
        expect.objectContaining({ purpose: "write_off", method: "other" }),
      );
    });

    it("cannot be raised above the balance it closes", async () => {
      const res = await updatePayment(
        null,
        form({ id: "pay-w", amount: "800.01", paid_on: "2026-09-25", reason: "Waived" }),
      );
      expect(res).toEqual({
        ok: false,
        error: expect.stringMatching(/^A write-off of ₹800\.01 is more than the ₹800\.00 balance due/),
      });
      expect(payments.update).not.toHaveBeenCalled();
    });
  });
});

describe("deletePayment", () => {
  it("is SuperAdmin-only", async () => {
    vi.mocked(requireSuperAdmin).mockRejectedValue(new Error("REDIRECT:/"));
    await expect(deletePayment(form({ id: "pay-1" }))).rejects.toThrow("REDIRECT:/");
    expect(payments.remove).not.toHaveBeenCalled();
  });

  it("deletes and lands back on the project's ledger", async () => {
    await expect(deletePayment(form({ id: "pay-1", work_order_id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/projects\/proj-1\?flash=Payment%20deleted\./,
    );
    expect(payments.remove).toHaveBeenCalledWith("pay-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/proj-1");
  });

  it("explains an entry that was already deleted", async () => {
    payments.byId.mockResolvedValue(null);
    await expect(deletePayment(form({ id: "pay-1", work_order_id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/projects\/proj-1\?flash=That%20payment%20was%20already%20deleted\.&flashType=error$/,
    );
    expect(payments.remove).not.toHaveBeenCalled();
  });

  it("keeps a payment a refund was paid out of, and says why", async () => {
    payments.listForWorkOrder.mockResolvedValue([
      STAGE_1,
      stored({ id: "pay-r", amount: 90000, purpose: "refund", paid_on: "2026-09-25" }),
    ]);
    await expect(deletePayment(form({ id: "pay-1", work_order_id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/projects\/proj-1\?flash=This%20change%20would%20leave%20the%20refund%20of%20.*&flashType=error$/,
    );
    expect(payments.remove).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes the refund itself", async () => {
    const refund = stored({ id: "pay-r", amount: 90000, purpose: "refund", paid_on: "2026-09-25" });
    payments.listForWorkOrder.mockResolvedValue([STAGE_1, refund]);
    payments.byId.mockResolvedValue(refund);
    await expect(deletePayment(form({ id: "pay-r", work_order_id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/projects\/proj-1\?flash=Payment%20deleted\./,
    );
    expect(payments.remove).toHaveBeenCalledWith("pay-r");
  });

  it("deletes a write-off: the balance is simply due again", async () => {
    const writeOff = stored({ id: "pay-w", amount: 800, purpose: "write_off", notes: "Waived" });
    payments.listForWorkOrder.mockResolvedValue([STAGE_1, writeOff]);
    payments.byId.mockResolvedValue(writeOff);
    await expect(deletePayment(form({ id: "pay-w", work_order_id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/projects\/proj-1\?flash=Payment%20deleted\./,
    );
    expect(payments.remove).toHaveBeenCalledWith("pay-w");
  });

  it("does not delete when the ledger cannot be read", async () => {
    payments.listForWorkOrder.mockRejectedValue(new Error("connection reset"));
    await expect(deletePayment(form({ id: "pay-1", work_order_id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/work-orders\?flash=Could%20not%20read%20the%20payment%20ledger/,
    );
    expect(payments.remove).not.toHaveBeenCalled();
  });
});
