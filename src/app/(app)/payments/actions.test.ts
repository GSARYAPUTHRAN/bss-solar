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
import { deletePayment, recordPayment, updatePayment } from "./actions";

const payments = vi.mocked(paymentsRepository);
const workOrders = vi.mocked(workOrdersRepository);

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;

// ₹1,95,000 contract, ₹20,000 advance, ₹80,000 stage 1 → ₹95,000 due.
const WORK_ORDER = {
  id: "wo-1",
  coordinator_id: "coord-1",
  client_name: "Anand Kumar",
  total_cost: 195000,
  advance_amount: 20000,
  project: { id: "proj-1", current_stage: "material_dispatch", is_completed: false },
} as WorkOrder;

const STAGE_1 = {
  id: "pay-1",
  work_order_id: "wo-1",
  amount: 80000,
  paid_on: "2026-09-20",
  purpose: "contract",
  created_at: "2026-09-20T10:00:00Z",
} as Payment;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ENTRY = {
  amount: "45000",
  paid_on: "2026-10-01",
  method: "bank_transfer",
  purpose: "contract",
  reference: "UTR 1",
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
        reference: "UTR 1",
        notes: null,
      },
      "admin-1",
    );
    expect(notify).toHaveBeenCalledWith({
      type: "payment.recorded",
      actorId: "admin-1",
      coordinatorId: "coord-1",
      workOrderId: "wo-1",
      projectId: "proj-1",
      clientName: "Anand Kumar",
      amount: 45000,
      balanceDue: 50000,
    });
    const paths = vi.mocked(revalidatePath).mock.calls.map(([p]) => p);
    expect(paths).toEqual(
      expect.arrayContaining(["/projects/proj-1", "/work-orders/wo-1", "/projects", "/work-orders", "/"]),
    );
  });

  it("surfaces a persistence error and does not notify", async () => {
    payments.create.mockResolvedValue({ id: null, error: "Payment was not recorded — office staff only." });
    const res = await recordPayment(null, form({ ...ENTRY, work_order_id: "wo-1" }));
    expect(res).toEqual({ ok: false, error: "Payment was not recorded — office staff only." });
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
});
