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
  requireDeleter: vi.fn(),
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
    setCoordinators: vi.fn(),
    remove: vi.fn(),
    removeMany: vi.fn(),
    existingIds: vi.fn(),
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
vi.mock("@/server/data/profiles.repository", () => ({
  profilesRepository: {
    coordinatorDirectory: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { requireAdmin, requireDeleter, requireWorkOrderRole } from "@/lib/auth";
import { notify } from "@/server/notifications";
import {
  paymentsRepository,
  profilesRepository,
  projectsRepository,
  workOrdersRepository,
} from "@/server/data";
import { CAPACITY_PROBLEM } from "@/lib/domain/capacity";
import { CONTRACT_TERMS_LOCKED_ERROR, PLAN_FIXED_ERROR } from "@/server/forms/work-order";
import {
  approveWorkOrder,
  createWorkOrder,
  deleteWorkOrder,
  deleteWorkOrders,
  rejectWorkOrder,
  setWorkOrderCoordinators,
  updateWorkOrder,
} from "./actions";

const workOrders = vi.mocked(workOrdersRepository);
const projects = vi.mocked(projectsRepository);
const payments = vi.mocked(paymentsRepository);
const profiles = vi.mocked(profilesRepository);

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN2_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RAHUL = "11111111-1111-4111-8111-111111111111";
const PRIYA = "22222222-2222-4222-8222-222222222222";
const ARUN = "33333333-3333-4333-8333-333333333333";
const MANU = "44444444-4444-4444-8444-444444444444";
const ENGINEER = "55555555-5555-4555-8555-555555555555";

const COORD = { id: RAHUL, role: "coordinator", full_name: "Rahul Menon" } as Profile;
const PARTNER = { id: PRIYA, role: "coordinator", full_name: "Priya Suresh" } as Profile;
const ADMIN = { id: ADMIN_ID, role: "admin", full_name: "BSS Admin" } as Profile;

/** coordinator_directory(): owners only — no engineer. */
const DIRECTORY = [
  { id: ADMIN_ID, full_name: "BSS Admin", role: "admin" as const },
  { id: ADMIN2_ID, full_name: "Second Admin", role: "admin" as const },
  { id: RAHUL, full_name: "Rahul Menon", role: "coordinator" as const },
  { id: PRIYA, full_name: "Priya Suresh", role: "coordinator" as const },
  { id: ARUN, full_name: "Arun Krishnan", role: "coordinator" as const },
  { id: MANU, full_name: "Manu Das", role: "coordinator" as const },
];

const BODY = {
  client_name: "Meera Nair",
  plant_capacity: "5kW",
  total_cost: "310000",
  advance_amount: "30000",
  financing_type: "self",
  loan_bank_name: "Ignored Bank",
};

/** A form body; an array value posts the field once per entry, in order. */
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) fd.append(k, value);
  }
  return fd;
}

function member(id: string, full_name: string, sort_order: number) {
  return { id, full_name, sort_order, incentive: null };
}
const RAHUL_ON_SALE = member(RAHUL, "Rahul Menon", 1);
const PRIYA_ON_SALE = member(PRIYA, "Priya Suresh", 2);

function pendingOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo-1",
    coordinator_id: RAHUL,
    coordinators: [RAHUL_ON_SALE],
    client_name: "Meera Nair",
    plan_type: "solar",
    plant_capacity: "5kW",
    status: "pending",
    project: null,
    ...overrides,
  } as WorkOrder;
}

function liveProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    current_stage: "site_feasibility_survey" as const,
    is_completed: false,
    cancellation: null,
    ...overrides,
  };
}

/** The event(s) of a given type handed to notify(), whichever call carried them. */
function notified(type: string) {
  return vi
    .mocked(notify)
    .mock.calls.flat()
    .filter((event) => event.type === type);
}

beforeEach(() => {
  vi.clearAllMocks();
  workOrders.create.mockResolvedValue({ id: "wo-new", error: null });
  workOrders.update.mockResolvedValue({ error: null });
  workOrders.setStatus.mockResolvedValue({ error: null });
  workOrders.setCoordinators.mockResolvedValue({ added: [], removed: [], error: null });
  workOrders.byId.mockResolvedValue(pendingOrder());
  projects.existsForWorkOrder.mockResolvedValue(false);
  projects.createForWorkOrder.mockResolvedValue({ error: null });
  payments.listForWorkOrder.mockResolvedValue([]);
  profiles.coordinatorDirectory.mockResolvedValue(DIRECTORY);
});

describe("createWorkOrder", () => {
  it("turns away roles outside the sales pipeline before reading the form", async () => {
    vi.mocked(requireWorkOrderRole).mockRejectedValue(new Error("REDIRECT:/tickets"));
    await expect(createWorkOrder(form(BODY))).rejects.toThrow("REDIRECT:/tickets");
    expect(workOrders.create).not.toHaveBeenCalled();
  });

  it("refuses a capacity that is not a kW figure, pointing at Custom plan", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    await expect(
      createWorkOrder(form({ ...BODY, plant_capacity: "1 panel" })),
    ).rejects.toThrow(
      `REDIRECT:/work-orders/new?error=${encodeURIComponent(CAPACITY_PROBLEM)}`,
    );
    expect(workOrders.create).not.toHaveBeenCalled();
  });

  it("logs a custom plan with what was sold as its label", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    await expect(
      createWorkOrder(
        form({ ...BODY, plan_type: "custom", plant_capacity: "Inverter + panel" }),
      ),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);
    expect(workOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({ plan_type: "custom", plant_capacity: "Inverter + panel" }),
    );
    expect(notified("work_order.submitted")[0]).toMatchObject({ capacity: "Inverter + panel" });
  });

  it("a coordinator logs for themselves, never stores a bank for self-financed, and tells the office", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    await expect(
      // The old single-coordinator field is not a way to log for someone else.
      createWorkOrder(form({ ...BODY, coordinator_id: PRIYA })),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);

    expect(workOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinator_id: RAHUL,
        plan_type: "solar",
        financing_type: "self",
        loan_bank_name: null,
      }),
    );
    const input = workOrders.create.mock.calls[0][0];
    expect(input).not.toHaveProperty("first_payment_amount");
    expect(workOrders.setCoordinators).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      type: "work_order.submitted",
      actorId: RAHUL,
      actorName: "Rahul Menon",
      workOrderId: "wo-new",
      clientName: "Meera Nair",
      capacity: "5kW",
      partnerNames: [],
    });
  });

  describe("with partners", () => {
    beforeEach(() => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      workOrders.setCoordinators.mockResolvedValue({
        added: [PRIYA],
        removed: [],
        error: null,
      });
    });

    it("inserts for the creator, then adds the partners and says who it was shared with", async () => {
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, PRIYA] })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders?flash=${encodeURIComponent("Work order created and shared with Priya Suresh.")}&flashType=success`,
      );
      expect(workOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ coordinator_id: RAHUL }),
      );
      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-new", [RAHUL, PRIYA]);
    });

    it("keeps the creator first however the list was posted", async () => {
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [PRIYA, ARUN] })),
      ).rejects.toThrow(/flash=/);
      expect(workOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ coordinator_id: RAHUL }),
      );
      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-new", [RAHUL, PRIYA, ARUN]);
    });

    it("tells the office who the partners are, and the partners they were added", async () => {
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, PRIYA] })),
      ).rejects.toThrow(/flash=/);

      expect(notified("work_order.submitted")).toEqual([
        expect.objectContaining({
          actorId: RAHUL,
          workOrderId: "wo-new",
          partnerNames: ["Priya Suresh"],
        }),
      ]);
      // The office already heard (above), so it is not told twice.
      expect(notified("work_order.coordinator_added")).toEqual([
        {
          type: "work_order.coordinator_added",
          actorId: RAHUL,
          actorName: "Rahul Menon",
          addedIds: [PRIYA],
          notifyOffice: false,
          workOrderId: "wo-new",
          projectId: null,
          clientName: "Meera Nair",
          capacity: "5kW",
          teamNames: ["Rahul Menon", "Priya Suresh"],
        },
      ]);
    });

    it("builds the announcements from the team the database reports, not the planned one", async () => {
      // The database added only Priya of the two asked for.
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, PRIYA, ARUN] })),
      ).rejects.toThrow(/flash=/);
      expect(notified("work_order.submitted")[0]).toMatchObject({ partnerNames: ["Priya Suresh"] });
      expect(notified("work_order.coordinator_added")[0]).toMatchObject({
        addedIds: [PRIYA],
        teamNames: ["Rahul Menon", "Priya Suresh"],
      });
    });

    it("when adding the partners fails, the order still exists: say exactly what to redo, announce no partner", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [],
        removed: [],
        error: "Only coordinator or office accounts can share a sale: Priya Suresh",
        code: "23514",
      });
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, PRIYA] })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/wo-new?error=${encodeURIComponent(
          "Work order created, but Priya Suresh could not be added: Only coordinator or office accounts can share a sale: Priya Suresh. Add them under Coordinators.",
        )}`,
      );
      expect(notified("work_order.coordinator_added")).toEqual([]);
      expect(notified("work_order.submitted")).toEqual([
        expect.objectContaining({ partnerNames: [] }),
      ]);
    });

    it("does not show a raw database error when adding the partners fails", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [],
        removed: [],
        error: "FetchError: connection reset",
      });
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, PRIYA, ARUN] })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/wo-new?error=${encodeURIComponent(
          "Work order created, but Priya Suresh & Arun Krishnan could not be added: Could not save the coordinators — please try again. Add them under Coordinators.",
        )}`,
      );
      expect(notified("work_order.coordinator_added")).toEqual([]);
    });

    it("refuses someone who cannot share a sale before anything is written", async () => {
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, ENGINEER] })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/new?error=${encodeURIComponent("Only coordinator or office accounts can share a sale.")}`,
      );
      expect(workOrders.create).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it.each([
      ["an admin", ADMIN2_ID],
      ["the office's own account", ADMIN_ID],
    ])("refuses %s as a partner before anything is written: only the office adds office accounts", async (_who, id) => {
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, PRIYA, id] })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/new?error=${encodeURIComponent("Only the office can add an office account to a sale.")}`,
      );
      expect(workOrders.create).not.toHaveBeenCalled();
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("refuses a team of more than five", async () => {
      await expect(
        createWorkOrder(
          form({ ...BODY, coordinator_ids: [RAHUL, PRIYA, ARUN, MANU, ADMIN2_ID, ADMIN_ID] }),
        ),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/new?error=${encodeURIComponent("A sale can have at most 5 coordinators.")}`,
      );
      expect(workOrders.create).not.toHaveBeenCalled();
    });
  });

  describe("the office logging a work order", () => {
    beforeEach(() => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
    });

    it("for a coordinator tells that coordinator", async () => {
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [ARUN] })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);

      expect(workOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ coordinator_id: ARUN }),
      );
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "work_order.assigned", coordinatorIds: [ARUN] }),
      );
    });

    it("for several coordinators makes the first the one it is logged for, and tells everyone on the sale", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [PRIYA],
        removed: [],
        error: null,
      });
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [ARUN, PRIYA] })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders?flash=${encodeURIComponent("Work order created and shared with Priya Suresh.")}`,
      );
      expect(workOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ coordinator_id: ARUN }),
      );
      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-new", [ARUN, PRIYA]);
      expect(notified("work_order.assigned")).toEqual([
        expect.objectContaining({ coordinatorIds: [ARUN, PRIYA], actorId: ADMIN_ID }),
      ]);
      // Everyone hears the one announcement; nobody is told "added" as well.
      expect(notified("work_order.coordinator_added")).toEqual([]);
    });

    it("may put another office account on the sale", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [ADMIN2_ID],
        removed: [],
        error: null,
      });
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [ADMIN_ID, ADMIN2_ID] })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);
      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-new", [ADMIN_ID, ADMIN2_ID]);
    });

    it("never tells the office itself it logged the order", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [PRIYA],
        removed: [],
        error: null,
      });
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [ADMIN_ID, PRIYA] })),
      ).rejects.toThrow(/flash=/);
      expect(notified("work_order.assigned")).toEqual([
        expect.objectContaining({ coordinatorIds: [PRIYA] }),
      ]);
    });

    it("assigns only to the people who actually joined when adding the partners fails", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [],
        removed: [],
        error: "Only coordinator or office accounts can share a sale: Priya Suresh",
        code: "23514",
      });
      await expect(
        createWorkOrder(form({ ...BODY, coordinator_ids: [ARUN, PRIYA] })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-new\?error=/);
      expect(notified("work_order.assigned")).toEqual([
        expect.objectContaining({ coordinatorIds: [ARUN] }),
      ]);
    });

    it("for itself alone is a new work order the rest of the office should know about", async () => {
      await expect(createWorkOrder(form(BODY))).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);
      expect(workOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ coordinator_id: ADMIN_ID }),
      );
      expect(notified("work_order.assigned")).toEqual([]);
      expect(notified("work_order.submitted")).toEqual([
        expect.objectContaining({ actorId: ADMIN_ID, partnerNames: [] }),
      ]);
    });
  });

  it("does not notify when the insert fails", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    workOrders.create.mockResolvedValue({ id: null, error: "violates row-level security" });
    await expect(
      createWorkOrder(form({ ...BODY, coordinator_ids: [RAHUL, PRIYA] })),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\/new\?error=/);
    expect(notify).not.toHaveBeenCalled();
    expect(workOrders.setCoordinators).not.toHaveBeenCalled();
  });
});

describe("updateWorkOrder", () => {
  it("a coordinator's edit is announced to the office and the sale's other coordinators", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    workOrders.byId.mockResolvedValue(
      pendingOrder({ coordinators: [RAHUL_ON_SALE, PRIYA_ON_SALE] }),
    );
    await expect(
      updateWorkOrder(form({ ...BODY, id: "wo-1", financing_type: "loan" })),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);

    expect(workOrders.update).toHaveBeenCalledWith(
      "wo-1",
      expect.objectContaining({ financing_type: "loan", loan_bank_name: "Ignored Bank" }),
    );
    expect(notify).toHaveBeenCalledWith({
      type: "work_order.updated",
      actorId: RAHUL,
      actorName: "Rahul Menon",
      coordinatorIds: [RAHUL, PRIYA],
      workOrderId: "wo-1",
      clientName: "Meera Nair",
    });
  });

  it("a partner may edit the order too, and the first coordinator hears of it", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(PARTNER);
    workOrders.byId.mockResolvedValue(
      pendingOrder({ coordinators: [RAHUL_ON_SALE, PRIYA_ON_SALE] }),
    );
    await expect(
      updateWorkOrder(form({ ...BODY, id: "wo-1", address: "Vytilla, Kochi" })),
    ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
    expect(workOrders.update).toHaveBeenCalledWith(
      "wo-1",
      expect.objectContaining({ address: "Vytilla, Kochi" }),
    );
    expect(notified("work_order.updated")).toEqual([
      expect.objectContaining({ actorId: PRIYA, coordinatorIds: [RAHUL, PRIYA] }),
    ]);
  });

  it("an office edit is not announced", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
    await expect(updateWorkOrder(form({ ...BODY, id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/work-orders\/wo-1\?flash=/,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  describe("the plan", () => {
    const CUSTOM_BODY = { ...BODY, plan_type: "custom", plant_capacity: "Inverter + panel" };

    beforeEach(() => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    });

    it("may still change while the order is pending (no project yet)", async () => {
      await expect(updateWorkOrder(form({ ...CUSTOM_BODY, id: "wo-1" }))).rejects.toThrow(
        /^REDIRECT:\/work-orders\/wo-1\?flash=/,
      );
      expect(workOrders.update).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ plan_type: "custom", plant_capacity: "Inverter + panel" }),
      );
    });

    it("is fixed once a project exists: another plan is refused before anything is written", async () => {
      workOrders.byId.mockResolvedValue(
        pendingOrder({ status: "approved", plan_type: "custom", project: liveProject() }),
      );
      await expect(
        updateWorkOrder(form({ ...BODY, id: "wo-1", plan_type: "solar" })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/wo-1/edit?error=${encodeURIComponent(PLAN_FIXED_ERROR)}`,
      );
      expect(workOrders.update).not.toHaveBeenCalled();
    });

    it("keeps the stored plan when the form posts none, and still edits the details", async () => {
      workOrders.byId.mockResolvedValue(
        pendingOrder({
          status: "approved",
          plan_type: "custom",
          plant_capacity: "Inverter + panel",
          total_cost: 310000,
          advance_amount: 30000,
          project: liveProject(),
        }),
      );
      const { total_cost: _t, advance_amount: _a, plan_type: _p, ...details } = CUSTOM_BODY;
      void _t;
      void _a;
      void _p;
      await expect(
        updateWorkOrder(form({ ...details, id: "wo-1", plant_capacity: "Inverter + 2 panels" })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
      expect(workOrders.update).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ plan_type: "custom", plant_capacity: "Inverter + 2 panels" }),
      );
    });

    it("lets an old solar order whose capacity predates the unit rule be saved unchanged", async () => {
      workOrders.byId.mockResolvedValue(pendingOrder({ plant_capacity: "1 panel" }));
      await expect(
        updateWorkOrder(form({ ...BODY, id: "wo-1", plant_capacity: "1 panel", notes: "Gate code" })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
      expect(workOrders.update).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ plant_capacity: "1 panel", notes: "Gate code" }),
      );
    });

    it("does not let a custom label slip through as a solar capacity when the plan is switched", async () => {
      workOrders.byId.mockResolvedValue(
        pendingOrder({ plan_type: "custom", plant_capacity: "1 panel" }),
      );
      await expect(
        updateWorkOrder(
          form({ ...BODY, id: "wo-1", plan_type: "solar", plant_capacity: "1 panel" }),
        ),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/wo-1/edit?error=${encodeURIComponent(CAPACITY_PROBLEM)}`,
      );
      expect(workOrders.update).not.toHaveBeenCalled();
    });
  });

  describe("contract terms", () => {
    const EDIT_ERROR = "REDIRECT:/work-orders/wo-1/edit?error=";
    // ₹3,10,000 contract, ₹30,000 advance, ₹2,00,000 collected through the
    // ledger → ₹80,000 due.
    const approved = pendingOrder({
      status: "approved",
      total_cost: 310000,
      advance_amount: 30000,
      project: liveProject(),
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

    it("a partner's edit of an approved order keeps the office's money too", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(PARTNER);
      workOrders.byId.mockResolvedValue({
        ...approved,
        coordinators: [RAHUL_ON_SALE, PRIYA_ON_SALE],
      });
      await expect(
        updateWorkOrder(form({ ...BODY, total_cost: "230000", id: "wo-1" })),
      ).rejects.toThrow(`${EDIT_ERROR}${encodeURIComponent(CONTRACT_TERMS_LOCKED_ERROR)}`);
      expect(workOrders.update).not.toHaveBeenCalled();
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

describe("advance details", () => {
  const EDIT_ERROR = "REDIRECT:/work-orders/wo-1/edit?error=";
  const DETAILS = {
    advance_method: "upi",
    advance_paid_on: "2026-09-02",
    advance_reference: "UPI 4410021199",
  };
  // The office has approved this sale and recorded how the advance was paid.
  const approved = pendingOrder({
    status: "approved",
    total_cost: 310000,
    advance_amount: 30000,
    advance_method: "cheque",
    advance_paid_on: "2026-09-01",
    advance_reference: "CHQ 3003",
    project: liveProject(),
  });
  const { total_cost: _t, advance_amount: _a, ...detailsOnly } = BODY;
  void _t;
  void _a;

  describe("when logging a work order", () => {
    it("stores how, when and the reference of the advance", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      await expect(
        createWorkOrder(form({ ...BODY, ...DETAILS })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);
      expect(workOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({ advance_amount: 30000, ...DETAILS }),
      );
    });

    it("stores nothing about them when they are left blank", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      await expect(createWorkOrder(form(BODY))).rejects.toThrow(/^REDIRECT:\/work-orders\?flash=/);
      expect(workOrders.create).toHaveBeenCalledWith(
        expect.objectContaining({
          advance_method: null,
          advance_paid_on: null,
          advance_reference: null,
        }),
      );
    });

    it("refuses an advance dated in the future before anything is written", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      await expect(
        createWorkOrder(form({ ...BODY, advance_paid_on: "2999-01-01" })),
      ).rejects.toThrow(
        `REDIRECT:/work-orders/new?error=${encodeURIComponent("The advance date cannot be in the future.")}`,
      );
      expect(workOrders.create).not.toHaveBeenCalled();
    });

    it("refuses details when there is no advance", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      await expect(
        createWorkOrder(form({ ...BODY, advance_amount: "0", advance_method: "upi" })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/new\?error=/);
      expect(workOrders.create).not.toHaveBeenCalled();
    });
  });

  describe("when editing one", () => {
    it("a coordinator's edit of an approved order writes the office's details back as they were", async () => {
      // The edit form leaves the locked details out. The database refuses a
      // coordinator any change to them once the order is reviewed, and it
      // compares what it is sent: so they must go back exactly as stored.
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      workOrders.byId.mockResolvedValue(approved);
      await expect(
        updateWorkOrder(form({ ...detailsOnly, id: "wo-1", client_phone: "98470 22222" })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
      expect(workOrders.update).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({
          client_phone: "98470 22222",
          advance_amount: 30000,
          advance_method: "cheque",
          advance_paid_on: "2026-09-01",
          advance_reference: "CHQ 3003",
        }),
      );
    });

    it("a coordinator cannot change them once the order is approved", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      workOrders.byId.mockResolvedValue(approved);
      await expect(
        updateWorkOrder(
          form({ ...detailsOnly, id: "wo-1", advance_method: "cash", advance_paid_on: "2026-09-01", advance_reference: "CHQ 3003" }),
        ),
      ).rejects.toThrow(`${EDIT_ERROR}${encodeURIComponent(CONTRACT_TERMS_LOCKED_ERROR)}`);
      expect(workOrders.update).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("a partner cannot either", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(PARTNER);
      workOrders.byId.mockResolvedValue({
        ...approved,
        coordinators: [RAHUL_ON_SALE, PRIYA_ON_SALE],
      });
      await expect(
        updateWorkOrder(form({ ...detailsOnly, id: "wo-1", advance_reference: "CHQ 0000" })),
      ).rejects.toThrow(`${EDIT_ERROR}${encodeURIComponent(CONTRACT_TERMS_LOCKED_ERROR)}`);
      expect(workOrders.update).not.toHaveBeenCalled();
    });

    it("the office may correct them on an approved order", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
      workOrders.byId.mockResolvedValue(approved);
      await expect(
        updateWorkOrder(
          form({ ...BODY, ...DETAILS, id: "wo-1", total_cost: "310000", advance_amount: "30000" }),
        ),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
      expect(workOrders.update).toHaveBeenCalledWith("wo-1", expect.objectContaining(DETAILS));
    });

    it("the coordinator who logged a pending order may still change them", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
      workOrders.byId.mockResolvedValue(
        pendingOrder({ total_cost: 310000, advance_amount: 30000, advance_method: "cash" }),
      );
      await expect(
        updateWorkOrder(form({ ...BODY, ...DETAILS, id: "wo-1", total_cost: "310000" })),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
      expect(workOrders.update).toHaveBeenCalledWith("wo-1", expect.objectContaining(DETAILS));
    });

    it("the office may clear them", async () => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
      workOrders.byId.mockResolvedValue(approved);
      await expect(
        updateWorkOrder(
          form({
            ...BODY,
            id: "wo-1",
            total_cost: "310000",
            advance_amount: "30000",
            advance_method: "none",
            advance_paid_on: "",
            advance_reference: "",
          }),
        ),
      ).rejects.toThrow(/^REDIRECT:\/work-orders\/wo-1\?flash=/);
      expect(workOrders.update).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({
          advance_method: null,
          advance_paid_on: null,
          advance_reference: null,
        }),
      );
    });
  });
});

describe("setWorkOrderCoordinators", () => {
  const DETAIL = "/work-orders/wo-1";
  const flash = (message: string) =>
    `REDIRECT:${DETAIL}?flash=${encodeURIComponent(message)}&flashType=success`;
  const error = (message: string) => `REDIRECT:${DETAIL}?error=${encodeURIComponent(message)}`;

  const shared = pendingOrder({ coordinators: [RAHUL_ON_SALE, PRIYA_ON_SALE] });

  it("is closed to roles outside the sales pipeline", async () => {
    vi.mocked(requireWorkOrderRole).mockRejectedValue(new Error("REDIRECT:/tickets"));
    await expect(
      setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL] })),
    ).rejects.toThrow("REDIRECT:/tickets");
    expect(workOrders.setCoordinators).not.toHaveBeenCalled();
  });

  it("reports a work order that is gone, or hidden from this person", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
    workOrders.byId.mockResolvedValue(null);
    await expect(
      setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL] })),
    ).rejects.toThrow(`REDIRECT:/work-orders?error=${encodeURIComponent("Work order not found.")}`);
    expect(workOrders.setCoordinators).not.toHaveBeenCalled();
  });

  describe("a coordinator who logged a pending order", () => {
    beforeEach(() => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(COORD);
    });

    it("adds a partner, tells them and the office, and says so", async () => {
      workOrders.setCoordinators.mockResolvedValue({ added: [PRIYA], removed: [], error: null });
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, PRIYA] })),
      ).rejects.toThrow(flash("Coordinators updated — Priya Suresh added."));

      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-1", [RAHUL, PRIYA]);
      expect(notify).toHaveBeenCalledWith({
        type: "work_order.coordinator_added",
        actorId: RAHUL,
        actorName: "Rahul Menon",
        addedIds: [PRIYA],
        notifyOffice: true,
        workOrderId: "wo-1",
        projectId: null,
        clientName: "Meera Nair",
        capacity: "5kW",
        teamNames: ["Rahul Menon", "Priya Suresh"],
      });
    });

    it("appends the partner even when the list is posted in another order", async () => {
      workOrders.byId.mockResolvedValue(pendingOrder());
      workOrders.setCoordinators.mockResolvedValue({ added: [PRIYA], removed: [], error: null });
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [PRIYA, RAHUL] })),
      ).rejects.toThrow(/flash=/);
      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-1", [RAHUL, PRIYA]);
    });

    it("cannot take anyone off", async () => {
      workOrders.byId.mockResolvedValue(shared);
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL] })),
      ).rejects.toThrow(error("Only the office can take a coordinator off a work order."));
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("cannot add someone who cannot own a sale", async () => {
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, ENGINEER] })),
      ).rejects.toThrow(error("Only coordinator or office accounts can share a sale."));
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
    });

    it.each([
      ["an admin", ADMIN2_ID],
      ["the office's own account", ADMIN_ID],
    ])("cannot add %s: only the office adds office accounts", async (_who, id) => {
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, PRIYA, id] })),
      ).rejects.toThrow(error("Only the office can add an office account to a sale."));
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("cannot add past five", async () => {
      workOrders.byId.mockResolvedValue(
        pendingOrder({
          coordinators: [
            RAHUL_ON_SALE,
            PRIYA_ON_SALE,
            member(ARUN, "Arun Krishnan", 3),
            member(MANU, "Manu Das", 4),
            member(ADMIN2_ID, "Second Admin", 5),
          ],
        }),
      );
      await expect(
        setWorkOrderCoordinators(
          form({ id: "wo-1", coordinator_ids: [RAHUL, PRIYA, ARUN, MANU, ADMIN2_ID, ADMIN_ID] }),
        ),
      ).rejects.toThrow(error("A sale can have at most 5 coordinators."));
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
    });

    it("cannot change the team once the order has been approved", async () => {
      workOrders.byId.mockResolvedValue(
        pendingOrder({ status: "approved", project: liveProject() }),
      );
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, PRIYA] })),
      ).rejects.toThrow(error("Only the office can change who shares this work order."));
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
    });
  });

  it("a partner cannot change who shares the order", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(PARTNER);
    workOrders.byId.mockResolvedValue(shared);
    await expect(
      setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, PRIYA, ARUN] })),
    ).rejects.toThrow(error("Only the office can change who shares this work order."));
    expect(workOrders.setCoordinators).not.toHaveBeenCalled();
  });

  describe("the office", () => {
    beforeEach(() => {
      vi.mocked(requireWorkOrderRole).mockResolvedValue(ADMIN);
      workOrders.byId.mockResolvedValue(
        pendingOrder({ status: "approved", coordinators: [RAHUL_ON_SALE, PRIYA_ON_SALE], project: liveProject() }),
      );
    });

    it("swaps a partner on an approved order: the new one is added, the old one removed, both told", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [ARUN],
        removed: [PRIYA],
        error: null,
      });
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, ARUN] })),
      ).rejects.toThrow(flash("Coordinators updated — Arun Krishnan added, Priya Suresh removed."));

      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-1", [RAHUL, ARUN]);
      expect(notify).toHaveBeenCalledWith(
        {
          type: "work_order.coordinator_added",
          actorId: ADMIN_ID,
          actorName: "BSS Admin",
          addedIds: [ARUN],
          // The office made the change; it needs no copy of its own announcement.
          notifyOffice: false,
          workOrderId: "wo-1",
          projectId: "proj-1",
          clientName: "Meera Nair",
          capacity: "5kW",
          teamNames: ["Rahul Menon", "Arun Krishnan"],
        },
        {
          type: "work_order.coordinator_removed",
          actorId: ADMIN_ID,
          actorName: "BSS Admin",
          removedIds: [PRIYA],
          clientName: "Meera Nair",
        },
      );
    });

    it("reorders without announcing anything", async () => {
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [PRIYA, RAHUL] })),
      ).rejects.toThrow(flash("Coordinator order updated."));
      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-1", [PRIYA, RAHUL]);
      // notify() with nothing in it announces nothing.
      expect(vi.mocked(notify).mock.calls.flat()).toEqual([]);
    });

    it("does nothing, and says so, when the list is the same", async () => {
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, PRIYA] })),
      ).rejects.toThrow(flash("Coordinators unchanged."));
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("cannot leave a sale without a coordinator", async () => {
      await expect(setWorkOrderCoordinators(form({ id: "wo-1" }))).rejects.toThrow(
        error("A work order needs at least one coordinator."),
      );
      expect(workOrders.setCoordinators).not.toHaveBeenCalled();
    });

    it("refuses an engineer or an unknown account", async () => {
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, ENGINEER] })),
      ).rejects.toThrow(error("Only coordinator or office accounts can share a sale."));
    });

    it("may add an office account", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [ADMIN2_ID],
        removed: [],
        error: null,
      });
      await expect(
        setWorkOrderCoordinators(
          form({ id: "wo-1", coordinator_ids: [RAHUL, PRIYA, ADMIN2_ID] }),
        ),
      ).rejects.toThrow(flash("Coordinators updated — Second Admin added."));
      expect(workOrders.setCoordinators).toHaveBeenCalledWith("wo-1", [RAHUL, PRIYA, ADMIN2_ID]);
    });

    it("shows the database's refusal when it is worded for people (a period is added)", async () => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [],
        removed: [],
        error: "Priya Suresh still has an incentive on this sale — clear it before taking them off",
        code: "23514",
      });
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL] })),
      ).rejects.toThrow(
        error("Priya Suresh still has an incentive on this sale — clear it before taking them off."),
      );
      expect(notify).not.toHaveBeenCalled();
    });

    it.each(["42501", "22023", "P0002"])("shows a worded refusal with code %s", async (code) => {
      workOrders.setCoordinators.mockResolvedValue({
        added: [],
        removed: [],
        error: "Work order not found",
        code,
      });
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, ARUN] })),
      ).rejects.toThrow(error("Work order not found."));
    });

    it.each([undefined, "08006", "PGRST301"])(
      "never shows an unexpected failure raw (code %s)",
      async (code) => {
        workOrders.setCoordinators.mockResolvedValue({
          added: [],
          removed: [],
          error: 'canceling statement due to statement timeout (relation "work_orders")',
          code,
        });
        await expect(
          setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, ARUN] })),
        ).rejects.toThrow(error("Could not save the coordinators — please try again."));
        expect(notify).not.toHaveBeenCalled();
      },
    );

    it("refreshes the order, its project and the lists", async () => {
      const { revalidatePath } = await import("next/cache");
      workOrders.setCoordinators.mockResolvedValue({ added: [ARUN], removed: [PRIYA], error: null });
      await expect(
        setWorkOrderCoordinators(form({ id: "wo-1", coordinator_ids: [RAHUL, ARUN] })),
      ).rejects.toThrow(/flash=/);
      expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toEqual(
        expect.arrayContaining(["/work-orders/wo-1", "/projects/proj-1", "/work-orders", "/projects", "/"]),
      );
    });
  });
});

describe("approve / reject", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  });

  it("approving creates the project and tells everyone on the sale", async () => {
    const team = [RAHUL_ON_SALE, PRIYA_ON_SALE];
    workOrders.byId
      .mockResolvedValueOnce(pendingOrder({ coordinators: team }))
      .mockResolvedValueOnce(
        pendingOrder({ status: "approved", coordinators: team, project: liveProject() }),
      );
    await expect(approveWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(
      /^REDIRECT:\/work-orders\/wo-1\?flash=/,
    );
    expect(projects.createForWorkOrder).toHaveBeenCalledWith("wo-1", RAHUL);
    expect(notify).toHaveBeenCalledWith({
      type: "work_order.approved",
      actorId: ADMIN_ID,
      coordinatorIds: [RAHUL, PRIYA],
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

  it("rejecting tells everyone on the sale", async () => {
    workOrders.byId.mockResolvedValue(
      pendingOrder({ coordinators: [RAHUL_ON_SALE, PRIYA_ON_SALE] }),
    );
    await expect(rejectWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(/flash=/);
    expect(workOrders.setStatus).toHaveBeenCalledWith("wo-1", "rejected");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "work_order.rejected",
        coordinatorIds: [RAHUL, PRIYA],
      }),
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

describe("deleteWorkOrder", () => {
  const SUPERADMIN = { ...ADMIN, role: "superadmin" } as Profile;
  const revalidated = () => vi.mocked(revalidatePath).mock.calls.map(([path]) => path);

  beforeEach(() => {
    vi.mocked(requireDeleter).mockResolvedValue(ADMIN);
    workOrders.remove.mockResolvedValue({ error: null });
  });

  it("is for deleters only: a refused guard deletes nothing", async () => {
    vi.mocked(requireDeleter).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(deleteWorkOrder(form({ id: "wo-1" }))).rejects.toThrow("REDIRECT:/work-orders");
    expect(workOrders.remove).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin", ADMIN],
    ["the Super Admin", SUPERADMIN],
  ])("lets %s delete a sale and lands on the work orders", async (_who, profile) => {
    vi.mocked(requireDeleter).mockResolvedValue(profile);
    await expect(deleteWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(
      "REDIRECT:/work-orders?flash=Work%20order%20deleted.",
    );
    expect(workOrders.remove).toHaveBeenCalledWith("wo-1");
  });

  it("lands on the projects list when deleted from the project page", async () => {
    await expect(deleteWorkOrder(form({ id: "wo-1", back: "projects" }))).rejects.toThrow(
      "REDIRECT:/projects?flash=Sale%20deleted.",
    );
    expect(workOrders.remove).toHaveBeenCalledWith("wo-1");
  });

  it.each(["", "tickets", "/projects", "https://example.com"])(
    "ignores any other back (%j)",
    async (back) => {
      await expect(deleteWorkOrder(form({ id: "wo-1", back }))).rejects.toThrow(
        "REDIRECT:/work-orders?flash=Work%20order%20deleted.",
      );
    },
  );

  it("refreshes the sale, the lists, the reports, the clean-up page and the dashboard", async () => {
    await expect(deleteWorkOrder(form({ id: "wo-1" }))).rejects.toThrow(/flash=/);
    expect(revalidated()).toEqual(
      expect.arrayContaining([
        "/work-orders",
        "/work-orders/wo-1",
        "/work-orders/duplicates",
        "/projects",
        "/reports",
        "/",
      ]),
    );
  });

  it("shows a refusal from the project page back on that project", async () => {
    const PROJECT = "20000000-0000-4000-8000-000000000001";
    workOrders.remove.mockResolvedValue({ error: "Nothing was deleted." });
    await expect(
      deleteWorkOrder(form({ id: "wo-1", back: "projects", project_id: PROJECT })),
    ).rejects.toThrow(`REDIRECT:/projects/${PROJECT}?error=${encodeURIComponent("Nothing was deleted.")}`);
  });

  it("ignores a project id that is not an id, and stays on the sale's page", async () => {
    workOrders.remove.mockResolvedValue({ error: "Nothing was deleted." });
    await expect(
      deleteWorkOrder(form({ id: "wo-1", back: "projects", project_id: "../team" })),
    ).rejects.toThrow(`REDIRECT:/work-orders/wo-1?error=${encodeURIComponent("Nothing was deleted.")}`);
  });

  it("explains a delete that removed nothing, on the sale's page", async () => {
    workOrders.remove.mockResolvedValue({
      error: "Nothing was deleted — it may already be gone, or your role cannot delete it.",
    });
    await expect(deleteWorkOrder(form({ id: "wo-1", back: "projects" }))).rejects.toThrow(
      `REDIRECT:/work-orders/wo-1?error=${encodeURIComponent(
        "Nothing was deleted — it may already be gone, or your role cannot delete it.",
      )}`,
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteWorkOrders", () => {
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const revalidated = () => vi.mocked(revalidatePath).mock.calls.map(([path]) => path);

  beforeEach(() => {
    vi.mocked(requireDeleter).mockResolvedValue(ADMIN);
    workOrders.removeMany.mockImplementation(async (ids: string[]) => ({
      deleted: ids,
      error: null,
    }));
  });

  it("is for deleters only: a refused guard deletes nothing", async () => {
    vi.mocked(requireDeleter).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(deleteWorkOrders([id(1)])).rejects.toThrow("REDIRECT:/work-orders");
    expect(workOrders.removeMany).not.toHaveBeenCalled();
  });

  it("deletes every sale asked for in one call and says how many went", async () => {
    await expect(deleteWorkOrders([id(1), id(2), id(3)])).resolves.toEqual({
      ok: true,
      deleted: 3,
      requested: 3,
    });
    expect(workOrders.removeMany).toHaveBeenCalledTimes(1);
    expect(workOrders.removeMany).toHaveBeenCalledWith([id(1), id(2), id(3)]);
  });

  it("asks for each sale once, however often it was sent", async () => {
    await expect(deleteWorkOrders([id(1), id(1), id(2), id(1)])).resolves.toEqual({
      ok: true,
      deleted: 2,
      requested: 2,
    });
    expect(workOrders.removeMany).toHaveBeenCalledWith([id(1), id(2)]);
  });

  it("reports a partial delete as done — the rest were already gone", async () => {
    workOrders.removeMany.mockResolvedValue({ deleted: [id(2)], error: null });
    await expect(deleteWorkOrders([id(1), id(2)])).resolves.toEqual({
      ok: true,
      deleted: 1,
      requested: 2,
    });
    expect(revalidated()).toContain("/work-orders/duplicates");
  });

  it("is an error when nothing was deleted — gone already, or the database refused the role", async () => {
    // delete_work_orders runs as the caller: RLS refusing removes nothing, silently.
    workOrders.removeMany.mockResolvedValue({ deleted: [], error: null });
    await expect(deleteWorkOrders([id(1), id(2)])).resolves.toEqual({
      ok: false,
      error: "Nothing was deleted — they may already be gone, or your role cannot delete them.",
    });
    // Still refreshed: a page whose sales were already gone must catch up.
    expect(revalidated()).toContain("/work-orders/duplicates");
  });

  it("refreshes the lists, the clean-up page, the reports and the dashboard", async () => {
    await deleteWorkOrders([id(1)]);
    expect(revalidated()).toEqual(
      expect.arrayContaining(["/work-orders", "/work-orders/duplicates", "/projects", "/reports", "/"]),
    );
  });

  it("refuses an empty selection", async () => {
    await expect(deleteWorkOrders([])).resolves.toEqual({
      ok: false,
      error: "Choose at least one sale to delete.",
    });
    expect(workOrders.removeMany).not.toHaveBeenCalled();
  });

  it("refuses more than 500 sales at once", async () => {
    const many = Array.from({ length: 501 }, (_, i) => id(i));
    await expect(deleteWorkOrders(many)).resolves.toEqual({
      ok: false,
      error: "At most 500 sales can be deleted at once — select fewer.",
    });
    expect(workOrders.removeMany).not.toHaveBeenCalled();
  });

  it("takes exactly 500", async () => {
    const most = Array.from({ length: 500 }, (_, i) => id(i));
    await expect(deleteWorkOrders(most)).resolves.toMatchObject({ ok: true, requested: 500 });
  });

  it.each([
    ["a non-uuid", ["wo-1"]],
    ["one bad id among good ones", [id(1), "1; drop table work_orders"]],
    ["a non-string", [42 as unknown as string]],
  ])("refuses %s and deletes nothing", async (_what, ids) => {
    await expect(deleteWorkOrders(ids)).resolves.toEqual({
      ok: false,
      error: "That selection is not valid — reload the page and try again.",
    });
    expect(workOrders.removeMany).not.toHaveBeenCalled();
  });

  it("refuses something that is not a list", async () => {
    await expect(deleteWorkOrders(null as unknown as string[])).resolves.toEqual({
      ok: false,
      error: "Choose the sales to delete.",
    });
    expect(workOrders.removeMany).not.toHaveBeenCalled();
  });

  it("says nothing was deleted when the database refuses, and refreshes nothing", async () => {
    workOrders.removeMany.mockResolvedValue({ deleted: [], error: "statement timeout" });
    await expect(deleteWorkOrders([id(1)])).resolves.toEqual({
      ok: false,
      error: "Nothing was deleted: statement timeout",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  describe("the copies the page means to keep", () => {
    const STALE =
      "This page is out of date: a copy you meant to keep has already been deleted. Refresh the page and check the selection again.";

    beforeEach(() => {
      // By default every id asked about still exists.
      workOrders.existingIds.mockImplementation(async (ids: string[]) => ({ ids, error: null }));
    });

    it("checks them, then deletes, when each group still has one", async () => {
      await expect(
        deleteWorkOrders([id(2), id(4)], [[id(1)], [id(3), id(5)]]),
      ).resolves.toEqual({ ok: true, deleted: 2, requested: 2 });
      expect(workOrders.existingIds).toHaveBeenCalledWith([id(1), id(3), id(5)]);
      expect(workOrders.existingIds.mock.invocationCallOrder[0]).toBeLessThan(
        workOrders.removeMany.mock.invocationCallOrder[0],
      );
    });

    it("deletes nothing when a copy to keep was deleted elsewhere since the page loaded", async () => {
      // A (kept) went in another tab; the stale page still has B ticked.
      workOrders.existingIds.mockResolvedValue({ ids: [], error: null });
      await expect(deleteWorkOrders([id(2)], [[id(1)]])).resolves.toEqual({
        ok: false,
        error: STALE,
      });
      expect(workOrders.removeMany).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("is satisfied by any one surviving copy of a group", async () => {
      workOrders.existingIds.mockResolvedValue({ ids: [id(5)], error: null });
      await expect(deleteWorkOrders([id(2)], [[id(3), id(5)]])).resolves.toMatchObject({
        ok: true,
      });
    });

    it("refuses when one group of several has nothing left", async () => {
      workOrders.existingIds.mockResolvedValue({ ids: [id(1)], error: null });
      await expect(deleteWorkOrders([id(2), id(4)], [[id(1)], [id(3)]])).resolves.toEqual({
        ok: false,
        error: STALE,
      });
      expect(workOrders.removeMany).not.toHaveBeenCalled();
    });

    it("does not count a copy to keep that is also being deleted", async () => {
      await expect(deleteWorkOrders([id(1), id(2)], [[id(1)]])).resolves.toEqual({
        ok: false,
        error: STALE,
      });
      expect(workOrders.removeMany).not.toHaveBeenCalled();
    });

    it("compares ids whatever their case", async () => {
      const upper = id(1).toUpperCase();
      workOrders.existingIds.mockResolvedValue({ ids: [id(1)], error: null });
      await expect(deleteWorkOrders([id(2)], [[upper]])).resolves.toMatchObject({ ok: true });
      expect(workOrders.existingIds).toHaveBeenCalledWith([id(1)]);
    });

    it("deletes nothing when the copies to keep cannot be checked", async () => {
      workOrders.existingIds.mockResolvedValue({ ids: [], error: "statement timeout" });
      await expect(deleteWorkOrders([id(2)], [[id(1)]])).resolves.toEqual({
        ok: false,
        error: "Nothing was deleted: the copies to keep could not be checked (statement timeout).",
      });
      expect(workOrders.removeMany).not.toHaveBeenCalled();
    });

    it("asks nothing when there is nothing to keep (every copy of a group chosen)", async () => {
      await expect(deleteWorkOrders([id(1)])).resolves.toMatchObject({ ok: true });
      await expect(deleteWorkOrders([id(1)], [])).resolves.toMatchObject({ ok: true });
      expect(workOrders.existingIds).not.toHaveBeenCalled();
    });

    it.each([
      ["not a list", "keep" as unknown],
      ["null", null],
      ["a group that is not a list", [id(1)]],
      ["an empty group", [[]]],
      ["a non-uuid", [["wo-1"]]],
      ["a SQL fragment", [[`${id(1)}'); delete from work_orders; --`]]],
      ["too many ids to check", Array.from({ length: 5001 }, (_, i) => [id(i)])],
    ])("refuses %s and deletes nothing", async (_what, keep) => {
      await expect(deleteWorkOrders([id(1)], keep as string[][])).resolves.toEqual({
        ok: false,
        error: "That selection is not valid — reload the page and try again.",
      });
      expect(workOrders.existingIds).not.toHaveBeenCalled();
      expect(workOrders.removeMany).not.toHaveBeenCalled();
    });

    it("takes up to 5000 ids to check", async () => {
      const keep = Array.from({ length: 50 }, (_, g) =>
        Array.from({ length: 100 }, (_, i) => id(1000 + g * 100 + i)),
      );
      await expect(deleteWorkOrders([id(1)], keep)).resolves.toMatchObject({ ok: true });
      expect(workOrders.existingIds.mock.calls[0][0]).toHaveLength(5000);
    });
  });
});
