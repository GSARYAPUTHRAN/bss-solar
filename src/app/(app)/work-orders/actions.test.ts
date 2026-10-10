import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, WorkOrder } from "@/lib/types";

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
  requireWorkOrderRole: vi.fn(),
}));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
// The repository modules are mocked one by one (not the "@/server/data" index),
// so the real loadContract helper runs against them.
vi.mock("@/server/data/work-orders.repository", () => ({
  workOrdersRepository: {
    byId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("@/server/data/projects.repository", () => ({
  projectsRepository: {
    existsForWorkOrder: vi.fn(),
    createForWorkOrder: vi.fn(),
  },
}));
vi.mock("@/server/data/payments.repository", () => ({
  paymentsRepository: {
    listForWorkOrder: vi.fn(),
  },
}));

import { requireAdmin, requireWorkOrderRole } from "@/lib/auth";
import { notify } from "@/server/notifications";
import {
  paymentsRepository,
  projectsRepository,
  workOrdersRepository,
} from "@/server/data";
import { CONTRACT_TERMS_LOCKED_ERROR } from "@/server/forms/work-order";
import {
  approveWorkOrder,
  createWorkOrder,
  rejectWorkOrder,
  updateWorkOrder,
} from "./actions";

const workOrders = vi.mocked(workOrdersRepository);
const projects = vi.mocked(projectsRepository);
const payments = vi.mocked(paymentsRepository);

const COORD = { id: "coord-1", role: "coordinator", full_name: "Rahul Menon" } as Profile;
const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;

const BODY = {
  client_name: "Meera Nair",
  plant_capacity: "5kW",
  total_cost: "310000",
  advance_amount: "30000",
  financing_type: "self",
  loan_bank_name: "Ignored Bank",
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function pendingOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo-1",
    coordinator_id: "coord-1",
    client_name: "Meera Nair",
    status: "pending",
    project: null,
    ...overrides,
  } as WorkOrder;
}

beforeEach(() => {
  vi.clearAllMocks();
  workOrders.create.mockResolvedValue({ id: "wo-new", error: null });
  workOrders.update.mockResolvedValue({ error: null });
  workOrders.setStatus.mockResolvedValue({ error: null });
  workOrders.byId.mockResolvedValue(pendingOrder());
  projects.existsForWorkOrder.mockResolvedValue(false);
  projects.createForWorkOrder.mockResolvedValue({ error: null });
  payments.listForWorkOrder.mockResolvedValue([]);
});

describe("createWorkOrder", () => {
  it("turns away roles outside the sales pipeline before reading the form", async () => {
    vi.mocked(requireWorkOrderRole).mockRejectedValue(new Error("REDIRECT:/tickets"));
    await expect(createWorkOrder(form(BODY))).rejects.toThrow("REDIRECT:/tickets");
    expect(workOrders.create).not.toHaveBeenCalled();
  });

  it("refuses a capacity without a number", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    await expect(
      createWorkOrder(form({ ...BODY, plant_capacity: "big" })),
    ).rejects.toThrow(
      `REDIRECT:/work-orders/new?error=${encodeURIComponent("Plant capacity must include a number, e.g. 3kW.")}`,
    );
    expect(workOrders.create).not.toHaveBeenCalled();
  });

  it("a coordinator logs for themselves, never stores a bank for self-financed, and tells the office", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    await expect(
      createWorkOrder(form({ ...BODY, coordinator_id: "someone-else" })),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);

    expect(workOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinator_id: "coord-1",
        financing_type: "self",
        loan_bank_name: null,
      }),
    );
    const input = workOrders.create.mock.calls[0][0];
    expect(input).not.toHaveProperty("first_payment_amount");
    expect(notify).toHaveBeenCalledWith({
      type: "work_order.submitted",
      actorId: "coord-1",
      actorName: "Rahul Menon",
      workOrderId: "wo-new",
      clientName: "Meera Nair",
      capacity: "5kW",
    });
  });

  it("the office logging for a coordinator tells that coordinator", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
    await expect(
      createWorkOrder(form({ ...BODY, coordinator_id: "coord-9" })),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);

    expect(workOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({ coordinator_id: "coord-9" }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "work_order.assigned", coordinatorId: "coord-9" }),
    );
  });

  it("does not notify when the insert fails", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    workOrders.create.mockResolvedValue({ id: null, error: "violates row-level security" });
    await expect(createWorkOrder(form(BODY))).rejects.toThrow(/^REDIRECT:\/work-orders\/new\?error=/);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("updateWorkOrder", () => {
  it("a coordinator's edit is announced to the office", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    await expect(
      updateWorkOrder(form({ ...BODY, id: "wo-1", financing_type: "loan" })),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);

    expect(workOrders.update).toHaveBeenCalledWith(
      "wo-1",
      expect.objectContaining({ financing_type: "loan", loan_bank_name: "Ignored Bank" }),
    );
    expect(notify).toHaveBeenCalledWith({
      type: "work_order.updated",
      actorId: "coord-1",
      actorName: "Rahul Menon",
      workOrderId: "wo-1",
      clientName: "Meera Nair",
    });
  });

  it("an office edit is not announced", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
    await expect(updateWorkOrder(form({ ...BODY, id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/work-orders\/wo-1\?flash=/,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  describe("contract terms", () => {
    const EDIT_ERROR = "REDIRECT:/work-orders/wo-1/edit?error=";
    // ₹3,10,000 contract, ₹30,000 advance, ₹2,00,000 collected through the
    // ledger → ₹80,000 due.
    const approved = pendingOrder({
      status: "approved",
      total_cost: 310000,
      advance_amount: 30000,
      project: { id: "proj-1", current_stage: "site_feasibility_survey", is_completed: false },
    });
    const { total_cost: _t, advance_amount: _a, ...detailsOnly } = BODY;
    void _t;
    void _a;

    beforeEach(() => {
      workOrders.byId.mockResolvedValue(approved);
      payments.listForWorkOrder.mockResolvedValue([
        { id: "p1", amount: 200000, paid_on: "2026-09-01", purpose: "contract" },
      ] as Awaited<ReturnType<typeof paymentsRepository.listForWorkOrder>>);
    });

    it("a coordinator's edit of an approved order keeps the office's money", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      await expect(
        updateWorkOrder(form({ ...detailsOnly, id: "wo-1", client_phone: "98470 22222" })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
      expect(workOrders.update).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({
          client_phone: "98470 22222",
          total_cost: 310000,
          advance_amount: 30000,
        }),
      );
    });

    it.each([
      ["raises the advance", { advance_amount: "110000" }],
      ["lowers the total", { total_cost: "230000" }],
    ])("a coordinator who %s on an approved order is refused", async (_label, patch) => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      await expect(
        updateWorkOrder(form({ ...BODY, ...patch, id: "wo-1" })),
      ).rejects.toThrow(`${EDIT_ERROR}${encodeURIComponent(CONTRACT_TERMS_LOCKED_ERROR)}`);
      expect(workOrders.update).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("the office may change the money on an approved order", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
      const raised = { ...BODY, id: "wo-1", total_cost: "320000", advance_amount: "40000" };
      await expect(updateWorkOrder(form(raised))).rejects.toThrow(
        /^REDIRECT:\/work-orders\/wo-1\?flash=/,
      );
      expect(workOrders.update).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ total_cost: 320000, advance_amount: 40000 }),
      );
    });

    it("refuses terms that would overpay the contract against the ledger", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
      // 1,50,000 advance + 2,00,000 ledger against a 3,10,000 contract.
      await expect(
        updateWorkOrder(form({ ...BODY, id: "wo-1", advance_amount: "150000" })),
      ).rejects.toThrow(
        `${EDIT_ERROR}${encodeURIComponent("The advance and the contract payments recorded come to ₹3,50,000.00")}`,
      );
      expect(workOrders.update).not.toHaveBeenCalled();
    });

    it("applies the cap to a pending order's coordinator too", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      workOrders.byId.mockResolvedValue({ ...approved, status: "pending" });
      await expect(
        updateWorkOrder(form({ ...BODY, id: "wo-1", total_cost: "200000" })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\/edit\?error=.*overpaid/);
      expect(workOrders.update).not.toHaveBeenCalled();
    });

    it("refuses the edit when the ledger cannot be read", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
      payments.listForWorkOrder.mockRejectedValue(new Error("connection reset"));
      await expect(updateWorkOrder(form({ ...BODY, id: "wo-1" }))).rejects.toThrow(
        `${EDIT_ERROR}${encodeURIComponent("Could not read the payment ledger — please try again.")}`,
      );
      expect(workOrders.update).not.toHaveBeenCalled();
    });

    it("reports a work order that is gone", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
      workOrders.byId.mockResolvedValue(null);
      await expect(updateWorkOrder(form({ ...BODY, id: "wo-1" }))).rejects.toThrow(
        `${EDIT_ERROR}${encodeURIComponent("Work order not found, or you cannot edit it.")}`,
      );
      expect(workOrders.update).not.toHaveBeenCalled();
    });
  });
});

describe("approve / reject", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  });

  it("approving creates the project and links the coordinator to it", async () => {
    workOrders.byId
      .mockResolvedValueOnce(pendingOrder())
      .mockResolvedValueOnce(
        pendingOrder({
          status: "approved",
          project: { id: "proj-1", current_stage: "site_feasibility_survey", is_completed: false },
        }),
      );
    await expect(approveWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/work-orders\/wo-1\?flash=/,
    );
    expect(projects.createForWorkOrder).toHaveBeenCalledWith("wo-1", "coord-1");
    expect(notify).toHaveBeenCalledWith({
      type: "work_order.approved",
      actorId: "admin-1",
      coordinatorId: "coord-1",
      workOrderId: "wo-1",
      projectId: "proj-1",
      clientName: "Meera Nair",
    });
  });

  it("a repeated approve does not notify twice", async () => {
    workOrders.byId.mockResolvedValue(pendingOrder({ status: "approved" }));
    projects.existsForWorkOrder.mockResolvedValue(true);
    await expect(approveWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(/flash=/);
    expect(projects.createForWorkOrder).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejecting tells the coordinator", async () => {
    await expect(rejectWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(/flash=/);
    expect(workOrders.setStatus).toHaveBeenCalledWith("wo-1", "rejected");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "work_order.rejected", coordinatorId: "coord-1" }),
    );
  });

  it("a status write that fails is reported and not announced", async () => {
    workOrders.setStatus.mockResolvedValue({ error: "permission denied" });
    await expect(rejectWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(
      "REDIRECT:/work-orders/wo-1?error=permission%20denied",
    );
    expect(notify).not.toHaveBeenCalled();
  });
});
