import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";
import type { ProjectBrief } from "@/server/data/projects.repository";

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
vi.mock("@/server/data/projects.repository", () => ({
  projectsRepository: {
    brief: vi.fn(),
    milestones: vi.fn(),
    updateMilestone: vi.fn(),
    setProgress: vi.fn(),
    captureFeasibilityDate: vi.fn(),
    setFeasibilityDate: vi.fn(),
    setCoordinatorIncentive: vi.fn(),
    recordIncentivePayment: vi.fn(),
    updateIncentivePayment: vi.fn(),
    deleteIncentivePayment: vi.fn(),
    setCancellation: vi.fn(),
    reinstate: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("@/server/data/work-orders.repository", () => ({
  workOrdersRepository: { setStatus: vi.fn() },
}));
vi.mock("@/lib/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format")>()),
  todayISO: () => "2026-10-10",
}));

import { revalidatePath } from "next/cache";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { formatCurrency } from "@/lib/format";
import { notify } from "@/server/notifications";
import { projectsRepository, workOrdersRepository } from "@/server/data";
import {
  advanceProject,
  deleteIncentivePayment,
  deleteProject,
  recordIncentivePayment,
  reinstateProject,
  setProjectCancellation,
  updateCoordinatorIncentive,
  updateIncentivePayment,
  updateMilestone,
  updateProjectSettings,
} from "./actions";

const projects = vi.mocked(projectsRepository);
const workOrders = vi.mocked(workOrdersRepository);

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;

/** A live solar project shared by Ravi (first) and Abhijith; Ravi has ₹2,000 pending. */
function brief(over: Partial<ProjectBrief> = {}): ProjectBrief {
  return {
    id: "p1",
    work_order_id: "wo1",
    is_completed: false,
    completed_at: null,
    feasibility_date: "2026-09-20",
    cancellation: null,
    cancelled_on: null,
    cancellation_remarks: null,
    client_name: "Anand Kumar",
    plan_type: "solar",
    order_date: "2026-08-01",
    coordinators: [
      {
        id: "c1",
        full_name: "Ravi Kumar",
        sort_order: 1,
        incentive: { amount: 2000, paid_on: null, payments: [], paid: 0 },
      },
      {
        id: "c2",
        full_name: "Abhijith Nair",
        sort_order: 2,
        incentive: { amount: null, paid_on: null, payments: [], paid: 0 },
      },
    ],
    ...over,
  };
}

/** An instalment as the brief carries it. */
const instalment = (id: string, amount: number, paid_on: string) => ({
  id,
  amount,
  paid_on,
  note: null,
  recorded_by: "admin-1",
});

/**
 * The same sale with Ravi's incentive agreed at ₹6,000 and ₹4,000 of it paid in
 * two instalments (₹2,000 on 1 Sep and on 15 Sep): ₹2,000 still to pay.
 */
function briefWithInstalments(over: Partial<ProjectBrief> = {}): ProjectBrief {
  const base = brief(over);
  return {
    ...base,
    coordinators: base.coordinators.map((c) =>
      c.id === "c1"
        ? {
            ...c,
            incentive: {
              amount: 6000,
              paid_on: null,
              payments: [
                instalment("pay-1", 2000, "2026-09-01"),
                instalment("pay-2", 2000, "2026-09-15"),
              ],
              paid: 4000,
            },
          }
        : c,
    ),
  };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const MILESTONES = [
  { id: "m1", stage: "site_feasibility_survey", sort_order: 1, status: "completed", completed_at: "2026-08-02T05:00:00Z" },
  { id: "m2", stage: "kseb_portal_registration", sort_order: 2, status: "in_progress", completed_at: null },
  { id: "m3", stage: "kseb_feasibility_clearance", sort_order: 3, status: "pending", completed_at: null },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  vi.mocked(requireSuperAdmin).mockResolvedValue({ ...ADMIN, role: "superadmin" });
  projects.brief.mockResolvedValue(brief());
  projects.milestones.mockResolvedValue([...MILESTONES]);
  projects.updateMilestone.mockResolvedValue({ error: null });
  projects.setProgress.mockResolvedValue({ error: null });
  projects.captureFeasibilityDate.mockResolvedValue({ error: null });
  projects.setFeasibilityDate.mockResolvedValue({ error: null });
  projects.setCoordinatorIncentive.mockResolvedValue({ error: null });
  projects.recordIncentivePayment.mockResolvedValue({ error: null });
  projects.updateIncentivePayment.mockResolvedValue({ error: null });
  projects.deleteIncentivePayment.mockResolvedValue({ error: null });
  projects.setCancellation.mockResolvedValue({ error: null });
  projects.reinstate.mockResolvedValue({ error: null });
  projects.remove.mockResolvedValue({ error: null });
  workOrders.setStatus.mockResolvedValue({ error: null });
});

const LOCKED = encodeURIComponent("Reinstate the project before changing its milestones.");

describe("updateMilestone", () => {
  const body = { project_id: "p1", milestone_id: "m2", status: "completed", notes: "" };

  it("is office-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(updateMilestone(form(body))).rejects.toThrow("REDIRECT:/work-orders");
    expect(projects.updateMilestone).not.toHaveBeenCalled();
  });

  it("is frozen on a cancelled or refunded project", async () => {
    projects.brief.mockResolvedValue(brief({ cancellation: "refunded", cancelled_on: "2026-10-01" }));
    await expect(updateMilestone(form(body))).rejects.toThrow(
      `REDIRECT:/projects/p1?error=${LOCKED}`,
    );
    expect(projects.updateMilestone).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("tells every coordinator of the sale about a completed milestone, not the actor's own list only", async () => {
    await expect(updateMilestone(form(body))).rejects.toThrow("REDIRECT:/projects/p1");
    expect(projects.updateMilestone).toHaveBeenCalledWith(
      "m2",
      expect.objectContaining({ status: "completed" }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "project.milestone_completed",
        actorId: "admin-1",
        coordinatorIds: ["c1", "c2"],
        projectId: "p1",
        stage: "kseb_portal_registration",
      }),
    );
  });

  it("announces a custom plan's only step as handed over, to the whole team", async () => {
    projects.brief.mockResolvedValue(brief({ plan_type: "custom", feasibility_date: null }));
    // The milestone is read twice: to find it, then again to recompute the
    // project's stage once it is saved (now completed).
    projects.milestones.mockResolvedValueOnce([
      { id: "h1", stage: "plant_commissioning", sort_order: 9, status: "in_progress", completed_at: null },
    ]);
    projects.milestones.mockResolvedValueOnce([
      { id: "h1", stage: "plant_commissioning", sort_order: 9, status: "completed", completed_at: "2026-10-10T05:00:00Z" },
    ]);

    await expect(
      updateMilestone(form({ project_id: "p1", milestone_id: "h1", status: "completed" })),
    ).rejects.toThrow("REDIRECT:/projects/p1");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "project.commissioned",
        planType: "custom",
        coordinatorIds: ["c1", "c2"],
      }),
    );
  });

  describe("completion dates", () => {
    const NOW = "2026-10-10T08:00:00.000Z";
    const STAMPED = "2026-09-25T05:00:00.000Z";

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(NOW));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Every milestone completed, none with a date: what an import without commissioned_on leaves. */
    const UNDATED_DONE = [
      { id: "m1", stage: "site_feasibility_survey", sort_order: 1, status: "completed", completed_at: null },
      { id: "m2", stage: "kseb_feasibility_clearance", sort_order: 2, status: "completed", completed_at: null },
    ] as const;

    it("stamps now on a real completion, and the project when that commissions it", async () => {
      projects.milestones.mockResolvedValueOnce([...MILESTONES.slice(0, 2)]);
      projects.milestones.mockResolvedValueOnce([
        MILESTONES[0],
        { ...MILESTONES[1], status: "completed" },
      ]);
      projects.brief.mockResolvedValue(brief({ feasibility_date: null }));

      await expect(updateMilestone(form(body))).rejects.toThrow("REDIRECT:/projects/p1");

      expect(projects.updateMilestone).toHaveBeenCalledWith("m2", {
        status: "completed",
        notes: null,
        completed_at: NOW,
      });
      expect(projects.setProgress).toHaveBeenCalledWith("p1", {
        current_stage: "kseb_portal_registration",
        is_completed: true,
        completed_at: NOW,
      });
    });

    it("saving a note on an imported commissioned project invents no date", async () => {
      // Commissioned, date not recorded (D18): the milestone is completed and
      // undated, so is the project. A note edit posts status = completed again.
      projects.brief.mockResolvedValue(
        brief({ is_completed: true, completed_at: null, feasibility_date: null }),
      );
      projects.milestones.mockResolvedValue([...UNDATED_DONE]);

      await expect(
        updateMilestone(form({ ...body, milestone_id: "m2", notes: "Handed over" })),
      ).rejects.toThrow("REDIRECT:/projects/p1");

      expect(projects.updateMilestone).toHaveBeenCalledWith("m2", {
        status: "completed",
        notes: "Handed over",
        completed_at: null,
      });
      expect(projects.setProgress).toHaveBeenCalledWith("p1", {
        current_stage: "kseb_feasibility_clearance",
        is_completed: true,
        completed_at: null,
      });
      // Nothing was completed or commissioned just now: no feasibility capture,
      // and no event (notify() is called with none).
      expect(projects.captureFeasibilityDate).not.toHaveBeenCalled();
      expect(vi.mocked(notify).mock.calls.flat()).toEqual([]);
    });

    it("keeps a recorded commissioning instant (and the milestone's) on a re-save", async () => {
      projects.brief.mockResolvedValue(
        brief({ is_completed: true, completed_at: STAMPED, feasibility_date: null }),
      );
      projects.milestones.mockResolvedValue(
        UNDATED_DONE.map((m) => ({ ...m, completed_at: "2026-09-20T05:00:00.000Z" })),
      );

      await expect(
        updateMilestone(form({ ...body, milestone_id: "m2", notes: "edited" })),
      ).rejects.toThrow("REDIRECT:/projects/p1");

      expect(projects.updateMilestone).toHaveBeenCalledWith(
        "m2",
        expect.objectContaining({ completed_at: "2026-09-20T05:00:00.000Z" }),
      );
      expect(projects.setProgress).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ is_completed: true, completed_at: STAMPED }),
      );
    });

    it("reopening a commissioned project's milestone clears both dates", async () => {
      projects.brief.mockResolvedValue(
        brief({ is_completed: true, completed_at: STAMPED, feasibility_date: null }),
      );
      projects.milestones.mockResolvedValueOnce(
        UNDATED_DONE.map((m) => ({ ...m, completed_at: STAMPED })),
      );
      projects.milestones.mockResolvedValueOnce([
        { ...UNDATED_DONE[0], completed_at: STAMPED },
        { ...UNDATED_DONE[1], status: "in_progress", completed_at: null },
      ]);

      await expect(
        updateMilestone(form({ ...body, milestone_id: "m2", status: "in_progress" })),
      ).rejects.toThrow("REDIRECT:/projects/p1");

      expect(projects.updateMilestone).toHaveBeenCalledWith(
        "m2",
        expect.objectContaining({ status: "in_progress", completed_at: null }),
      );
      expect(projects.setProgress).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ is_completed: false, completed_at: null }),
      );
    });

    it("completing again after a reopen is a real completion, stamped now", async () => {
      // The project was reopened (is_completed false, no date); this save completes it.
      projects.brief.mockResolvedValue(brief({ is_completed: false, feasibility_date: null }));
      projects.milestones.mockResolvedValueOnce([
        { ...UNDATED_DONE[0], completed_at: STAMPED },
        { ...UNDATED_DONE[1], status: "in_progress", completed_at: null },
      ]);
      projects.milestones.mockResolvedValueOnce([
        { ...UNDATED_DONE[0], completed_at: STAMPED },
        { ...UNDATED_DONE[1], completed_at: NOW },
      ]);

      await expect(
        updateMilestone(form({ ...body, milestone_id: "m2" })),
      ).rejects.toThrow("REDIRECT:/projects/p1");

      expect(projects.updateMilestone).toHaveBeenCalledWith(
        "m2",
        expect.objectContaining({ completed_at: NOW }),
      );
      expect(projects.setProgress).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ is_completed: true, completed_at: NOW }),
      );
    });
  });
});

describe("advanceProject", () => {
  it("is frozen on a cancelled project", async () => {
    projects.brief.mockResolvedValue(brief({ cancellation: "cancelled", cancelled_on: "2026-10-01" }));
    await expect(advanceProject(form({ project_id: "p1" }))).rejects.toThrow(
      `REDIRECT:/projects/p1?error=${LOCKED}`,
    );
    expect(projects.updateMilestone).not.toHaveBeenCalled();
  });

  it("completes the first open milestone", async () => {
    await expect(advanceProject(form({ project_id: "p1" }))).rejects.toThrow(
      "REDIRECT:/projects/p1",
    );
    expect(projects.updateMilestone).toHaveBeenCalledWith("m2", expect.objectContaining({ status: "completed" }));
  });
});

describe("updateProjectSettings", () => {
  it("saves the feasibility date alone and never touches an incentive", async () => {
    await expect(
      updateProjectSettings(form({ project_id: "p1", feasibility_date: "2026-09-01" })),
    ).rejects.toThrow(
      `REDIRECT:/projects/p1?flash=${encodeURIComponent("Project settings saved.")}&flashType=success`,
    );
    expect(projects.setFeasibilityDate).toHaveBeenCalledWith("p1", "2026-09-01");
    expect(projects.setCoordinatorIncentive).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("clears the date when the field is empty", async () => {
    await expect(
      updateProjectSettings(form({ project_id: "p1", feasibility_date: "" })),
    ).rejects.toThrow("REDIRECT:/projects/p1?flash=");
    expect(projects.setFeasibilityDate).toHaveBeenCalledWith("p1", null);
  });

  it("refuses a future date", async () => {
    await expect(
      updateProjectSettings(form({ project_id: "p1", feasibility_date: "2026-10-11" })),
    ).rejects.toThrow(
      `REDIRECT:/projects/p1?error=${encodeURIComponent("Feasibility date cannot be in the future.")}`,
    );
    expect(projects.setFeasibilityDate).not.toHaveBeenCalled();
  });

  it("refuses a date on a custom plan (it has no KSEB feasibility)", async () => {
    projects.brief.mockResolvedValue(brief({ plan_type: "custom", feasibility_date: null }));
    await expect(
      updateProjectSettings(form({ project_id: "p1", feasibility_date: "2026-09-01" })),
    ).rejects.toThrow(
      `REDIRECT:/projects/p1?error=${encodeURIComponent("A custom plan has no KSEB feasibility date.")}`,
    );
    expect(projects.setFeasibilityDate).not.toHaveBeenCalled();
  });

  it("explains, rather than hitting the CHECK, when a cancelled project never recorded its date", async () => {
    projects.brief.mockResolvedValue(
      brief({ cancellation: "cancelled", cancelled_on: null, feasibility_date: null }),
    );
    await expect(
      updateProjectSettings(form({ project_id: "p1", feasibility_date: "2026-09-01" })),
    ).rejects.toThrow(/REDIRECT:\/projects\/p1\?error=Record%20the%20date%20it%20was%20cancelled/);
    expect(projects.setFeasibilityDate).not.toHaveBeenCalled();
  });

  describe("a commissioned project whose commissioning date was never recorded", () => {
    // An imported commissioned row with no commissioned_on (D18).
    const undated = (over: Partial<ProjectBrief> = {}) =>
      brief({ is_completed: true, completed_at: null, feasibility_date: null, ...over });

    it("refuses a date, which would start a renewal clock that never stops", async () => {
      projects.brief.mockResolvedValue(undated());
      await expect(
        updateProjectSettings(form({ project_id: "p1", feasibility_date: "2025-01-05" })),
      ).rejects.toThrow(
        `REDIRECT:/projects/p1?error=${encodeURIComponent(
          "This project was commissioned on a date that was never recorded, so it has no feasibility clock.",
        )}`,
      );
      expect(projects.setFeasibilityDate).not.toHaveBeenCalled();
    });

    it("still lets the office clear a date", async () => {
      projects.brief.mockResolvedValue(undated({ feasibility_date: "2025-01-05" }));
      await expect(
        updateProjectSettings(form({ project_id: "p1", feasibility_date: "" })),
      ).rejects.toThrow("REDIRECT:/projects/p1?flash=");
      expect(projects.setFeasibilityDate).toHaveBeenCalledWith("p1", null);
    });

    it("takes a date when the commissioning instant is recorded", async () => {
      projects.brief.mockResolvedValue(undated({ completed_at: "2026-09-25T05:00:00.000Z" }));
      await expect(
        updateProjectSettings(form({ project_id: "p1", feasibility_date: "2026-09-01" })),
      ).rejects.toThrow("REDIRECT:/projects/p1?flash=");
      expect(projects.setFeasibilityDate).toHaveBeenCalledWith("p1", "2026-09-01");
    });
  });
});

describe("updateCoordinatorIncentive", () => {
  const body = { project_id: "p1", coordinator_id: "c2", amount: "3500" };

  it("is office-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(updateCoordinatorIncentive(null, form(body))).rejects.toThrow(
      "REDIRECT:/work-orders",
    );
    expect(projects.setCoordinatorIncentive).not.toHaveBeenCalled();
  });

  it("writes that person's agreed amount alone — no paid date, which the database derives — and tells only them", async () => {
    const res = await updateCoordinatorIncentive(null, form(body));

    expect(res).toEqual({ ok: true, data: { message: "Incentive saved for Abhijith Nair." } });
    expect(projects.setCoordinatorIncentive).toHaveBeenCalledWith("wo1", "c2", { amount: 3500 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      type: "incentive.updated",
      actorId: "admin-1",
      coordinatorId: "c2",
      projectId: "p1",
      clientName: "Anand Kumar",
      amount: 3500,
      paidOn: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/p1");
  });

  it("ignores a paid date posted along with it: the form no longer has one", async () => {
    await updateCoordinatorIncentive(null, form({ ...body, paid_on: "2026-10-09" }));
    expect(projects.setCoordinatorIncentive).toHaveBeenCalledWith("wo1", "c2", { amount: 3500 });
  });

  it("refuses someone who is not on the sale", async () => {
    const res = await updateCoordinatorIncentive(null, form({ ...body, coordinator_id: "stranger" }));
    expect(res).toEqual({
      ok: false,
      error: "That person is not a coordinator on this project.",
    });
    expect(projects.setCoordinatorIncentive).not.toHaveBeenCalled();
  });

  it("returns a validation message and writes nothing", async () => {
    const res = await updateCoordinatorIncentive(null, form({ ...body, amount: "-5" }));
    expect(res).toEqual({ ok: false, error: "Incentive cannot be negative." });
    expect(projects.setCoordinatorIncentive).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify when the agreed amount did not change", async () => {
    // Ravi already has ₹2,000 pending.
    const res = await updateCoordinatorIncentive(
      null,
      form({ project_id: "p1", coordinator_id: "c1", amount: "2000" }),
    );
    expect(res?.ok).toBe(true);
    expect(projects.setCoordinatorIncentive).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("clearing an incentive nobody has been paid on is told as 'removed' (amount null) to that person", async () => {
    const res = await updateCoordinatorIncentive(
      null,
      form({ project_id: "p1", coordinator_id: "c1", amount: "" }),
    );
    expect(res?.ok).toBe(true);
    expect(projects.setCoordinatorIncentive).toHaveBeenCalledWith("wo1", "c1", { amount: null });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "incentive.updated",
        coordinatorId: "c1",
        amount: null,
        paidOn: null,
      }),
    );
  });

  describe("with instalments already paid", () => {
    beforeEach(() => {
      projects.brief.mockResolvedValue(briefWithInstalments());
    });
    const ravi = { project_id: "p1", coordinator_id: "c1" };

    it("will not go below what is paid, and says how much", async () => {
      const res = await updateCoordinatorIncentive(null, form({ ...ravi, amount: "3999.99" }));
      expect(res).toEqual({
        ok: false,
        error: `The incentive cannot be less than the ${formatCurrency(4000)} already paid.`,
      });
      expect(projects.setCoordinatorIncentive).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("will not clear an incentive that has payments — they have to be removed first", async () => {
      const res = await updateCoordinatorIncentive(null, form({ ...ravi, amount: "" }));
      expect(res).toEqual({
        ok: false,
        error: `${formatCurrency(4000)} has already been paid on this incentive — remove those payments before clearing it.`,
      });
      expect(projects.setCoordinatorIncentive).not.toHaveBeenCalled();
    });

    it("may be raised, or lowered to exactly what is paid", async () => {
      expect((await updateCoordinatorIncentive(null, form({ ...ravi, amount: "7000" })))?.ok).toBe(true);
      expect((await updateCoordinatorIncentive(null, form({ ...ravi, amount: "4000" })))?.ok).toBe(true);
    });

    it("lowering it to what is paid settles it: the person is told it is paid, on the day the last instalment was", async () => {
      await updateCoordinatorIncentive(null, form({ ...ravi, amount: "4000" }));
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "incentive.updated",
          coordinatorId: "c1",
          amount: 4000,
          paidOn: "2026-09-15",
        }),
      );
    });

    it("the database's refusal in a race is worded for the person", async () => {
      projects.setCoordinatorIncentive.mockResolvedValue({
        error: "The incentive cannot be less than the ₹4,500.00 already paid.",
      });
      const res = await updateCoordinatorIncentive(null, form({ ...ravi, amount: "5000" }));
      expect(res).toEqual({
        ok: false,
        error: "The incentive cannot be less than the ₹4,500.00 already paid.",
      });
      expect(notify).not.toHaveBeenCalled();
    });
  });

  it("returns the database's refusal and notifies no one", async () => {
    projects.setCoordinatorIncentive.mockResolvedValue({ error: "not saved" });
    const res = await updateCoordinatorIncentive(null, form(body));
    expect(res).toEqual({ ok: false, error: "not saved" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports a missing project plainly", async () => {
    projects.brief.mockResolvedValue(null);
    const res = await updateCoordinatorIncentive(null, form(body));
    expect(res).toEqual({
      ok: false,
      error: "Project not found — it may have been deleted.",
    });
  });
});

describe("recordIncentivePayment", () => {
  const body = {
    project_id: "p1",
    coordinator_id: "c1",
    amount: "1500",
    paid_on: "2026-10-09",
    note: "Cheque 004211",
  };

  beforeEach(() => {
    projects.brief.mockResolvedValue(briefWithInstalments());
  });

  it("is office-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(recordIncentivePayment(null, form(body))).rejects.toThrow("REDIRECT:/work-orders");
    expect(projects.recordIncentivePayment).not.toHaveBeenCalled();
  });

  it("records the instalment against that person's incentive and tells them — only them, what is left", async () => {
    const res = await recordIncentivePayment(null, form(body));

    expect(res).toEqual({
      ok: true,
      data: {
        message: `${formatCurrency(1500)} recorded for Ravi Kumar — ${formatCurrency(500)} still to pay.`,
      },
    });
    expect(projects.recordIncentivePayment).toHaveBeenCalledWith("wo1", "c1", {
      amount: 1500,
      paid_on: "2026-10-09",
      note: "Cheque 004211",
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      type: "incentive.paid",
      actorId: "admin-1",
      coordinatorId: "c1",
      projectId: "p1",
      clientName: "Anand Kumar",
      amount: 1500,
      pending: 500,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/p1");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("the instalment that settles it says fully paid, in the message and the notification", async () => {
    const res = await recordIncentivePayment(null, form({ ...body, amount: "2000", note: "" }));
    expect(res).toEqual({
      ok: true,
      data: { message: `${formatCurrency(2000)} recorded for Ravi Kumar — fully paid.` },
    });
    expect(projects.recordIncentivePayment).toHaveBeenCalledWith("wo1", "c1", {
      amount: 2000,
      paid_on: "2026-10-09",
      note: null,
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "incentive.paid", pending: 0 }));
  });

  it("will not take the instalments past the agreed amount", async () => {
    const res = await recordIncentivePayment(null, form({ ...body, amount: "2000.01" }));
    expect(res).toEqual({
      ok: false,
      error: `${formatCurrency(2000.01)} is more than the ${formatCurrency(2000)} still to pay on this incentive.`,
    });
    expect(projects.recordIncentivePayment).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses another instalment on an incentive that is fully paid", async () => {
    projects.brief.mockResolvedValue(
      brief({
        coordinators: [
          {
            id: "c1",
            full_name: "Ravi Kumar",
            sort_order: 1,
            incentive: {
              amount: 2000,
              paid_on: "2026-10-01",
              payments: [instalment("pay-1", 2000, "2026-10-01")],
              paid: 2000,
            },
          },
        ],
      }),
    );
    const res = await recordIncentivePayment(null, form(body));
    expect(res).toEqual({ ok: false, error: "This incentive is already fully paid." });
    expect(projects.recordIncentivePayment).not.toHaveBeenCalled();
  });

  it("needs the agreed amount set first", async () => {
    const res = await recordIncentivePayment(null, form({ ...body, coordinator_id: "c2" }));
    expect(res).toEqual({ ok: false, error: "Set the incentive amount first." });
    expect(projects.recordIncentivePayment).not.toHaveBeenCalled();
  });

  it.each([
    [{ paid_on: "2026-10-11" }, "The payment date cannot be in the future."],
    [{ paid_on: "" }, "Enter the date the instalment was paid."],
    [{ paid_on: "01/10/2026" }, "Enter the date the instalment was paid."],
    [{ amount: "0" }, "The instalment must be more than zero."],
    [{ amount: "" }, "Enter the instalment amount."],
    [{ amount: "lots" }, "Instalment must be an amount in rupees, e.g. 2500."],
    [{ amount: "-5" }, "Instalment cannot be negative."],
    [{ note: "x".repeat(201) }, "The note can be at most 200 characters."],
  ])("refuses %j without writing", async (override, error) => {
    const res = await recordIncentivePayment(null, form({ ...body, ...override }));
    expect(res).toEqual({ ok: false, error });
    expect(projects.recordIncentivePayment).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("takes a payment dated today", async () => {
    const res = await recordIncentivePayment(null, form({ ...body, paid_on: "2026-10-10" }));
    expect(res?.ok).toBe(true);
  });

  it("refuses someone who is not on the sale", async () => {
    const res = await recordIncentivePayment(null, form({ ...body, coordinator_id: "stranger" }));
    expect(res).toEqual({
      ok: false,
      error: "That person is not a coordinator on this project.",
    });
    expect(projects.recordIncentivePayment).not.toHaveBeenCalled();
  });

  it("returns the database's refusal (another office user got there first) and notifies no one", async () => {
    projects.recordIncentivePayment.mockResolvedValue({ error: "That would take the payments above the agreed incentive." });
    const res = await recordIncentivePayment(null, form(body));
    expect(res).toEqual({ ok: false, error: "That would take the payments above the agreed incentive." });
    expect(notify).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a missing project plainly", async () => {
    projects.brief.mockResolvedValue(null);
    expect(await recordIncentivePayment(null, form(body))).toEqual({
      ok: false,
      error: "Project not found — it may have been deleted.",
    });
  });
});

describe("updateIncentivePayment", () => {
  const body = {
    project_id: "p1",
    payment_id: "pay-2",
    amount: "2000",
    paid_on: "2026-09-16",
    note: "Corrected date",
  };

  beforeEach(() => {
    projects.brief.mockResolvedValue(briefWithInstalments());
  });

  it("is office-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(updateIncentivePayment(null, form(body))).rejects.toThrow("REDIRECT:/work-orders");
    expect(projects.updateIncentivePayment).not.toHaveBeenCalled();
  });

  it("corrects that instalment and nothing else — and does not tell anyone again", async () => {
    const res = await updateIncentivePayment(null, form(body));
    expect(res).toEqual({ ok: true, data: { message: "Payment corrected for Ravi Kumar." } });
    expect(projects.updateIncentivePayment).toHaveBeenCalledWith("pay-2", {
      amount: 2000,
      paid_on: "2026-09-16",
      note: "Corrected date",
    });
    expect(notify).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/projects/p1");
  });

  it("does not count the instalment's own old amount against the cap", async () => {
    // ₹4,000 is paid of ₹6,000: a ₹2,000 instalment may become ₹4,000 (the other
    // ₹2,000 plus this makes the agreed ₹6,000) but not ₹4,000.01.
    expect((await updateIncentivePayment(null, form({ ...body, amount: "4000" })))?.ok).toBe(true);
    const over = await updateIncentivePayment(null, form({ ...body, amount: "4000.01" }));
    expect(over).toEqual({
      ok: false,
      error: `${formatCurrency(4000.01)} is more than the ${formatCurrency(4000)} still to pay on this incentive.`,
    });
  });

  it("holds a corrected date to today as well", async () => {
    const res = await updateIncentivePayment(null, form({ ...body, paid_on: "2026-10-11" }));
    expect(res).toEqual({ ok: false, error: "The payment date cannot be in the future." });
    expect(projects.updateIncentivePayment).not.toHaveBeenCalled();
  });

  it("only touches instalments of this project", async () => {
    const res = await updateIncentivePayment(null, form({ ...body, payment_id: "someone-elses" }));
    expect(res).toEqual({
      ok: false,
      error: "That payment is not on this project — it may have been removed.",
    });
    expect(projects.updateIncentivePayment).not.toHaveBeenCalled();
  });

  it("returns the database's refusal", async () => {
    projects.updateIncentivePayment.mockResolvedValue({ error: "That payment was not found, or you cannot change it." });
    const res = await updateIncentivePayment(null, form(body));
    expect(res).toEqual({ ok: false, error: "That payment was not found, or you cannot change it." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteIncentivePayment", () => {
  const body = { project_id: "p1", payment_id: "pay-1" };

  beforeEach(() => {
    projects.brief.mockResolvedValue(briefWithInstalments());
  });

  it("is office-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(deleteIncentivePayment(null, form(body))).rejects.toThrow("REDIRECT:/work-orders");
    expect(projects.deleteIncentivePayment).not.toHaveBeenCalled();
  });

  it("removes that instalment, leaving the agreed amount", async () => {
    const res = await deleteIncentivePayment(null, form(body));
    expect(res).toEqual({
      ok: true,
      data: { message: `${formatCurrency(2000)} payment removed for Ravi Kumar.` },
    });
    expect(projects.deleteIncentivePayment).toHaveBeenCalledWith("pay-1");
    expect(projects.setCoordinatorIncentive).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/projects/p1");
    expect(notify).not.toHaveBeenCalled();
  });

  it("only removes instalments of this project", async () => {
    const res = await deleteIncentivePayment(null, form({ ...body, payment_id: "someone-elses" }));
    expect(res).toEqual({
      ok: false,
      error: "That payment is not on this project — it may have been removed.",
    });
    expect(projects.deleteIncentivePayment).not.toHaveBeenCalled();
  });

  it("returns the database's refusal", async () => {
    projects.deleteIncentivePayment.mockResolvedValue({ error: "That payment was not found, or you cannot remove it." });
    const res = await deleteIncentivePayment(null, form(body));
    expect(res).toEqual({ ok: false, error: "That payment was not found, or you cannot remove it." });
  });
});

describe("setProjectCancellation", () => {
  const body = {
    project_id: "p1",
    cancellation: "refunded",
    cancelled_on: "2026-10-01",
    cancellation_remarks: "Refunded ₹50,000 by bank transfer",
  };

  it("is office-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(setProjectCancellation(null, form(body))).rejects.toThrow("REDIRECT:/work-orders");
    expect(projects.setCancellation).not.toHaveBeenCalled();
  });

  it("refunds a live project, tells the whole team, and warns about unpaid incentives", async () => {
    const res = await setProjectCancellation(null, form(body));

    expect(projects.setCancellation).toHaveBeenCalledWith("p1", {
      cancellation: "refunded",
      cancelled_on: "2026-10-01",
      cancellation_remarks: "Refunded ₹50,000 by bank transfer",
    });
    expect(res).toEqual({
      ok: true,
      data: {
        message: `Project marked refunded. ${formatCurrency(2000)} of coordinator incentives is still to pay — lower or clear it if it is no longer due.`,
      },
    });
    expect(notify).toHaveBeenCalledWith({
      type: "project.cancelled",
      actorId: "admin-1",
      coordinatorIds: ["c1", "c2"],
      projectId: "p1",
      clientName: "Anand Kumar",
      cancellation: "refunded",
      remarks: "Refunded ₹50,000 by bank transfer",
    });
    // The work order page and lists show it too.
    expect(revalidatePath).toHaveBeenCalledWith("/work-orders/wo1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/p1");
  });

  it("counts only what is left of an incentive that is part-paid", async () => {
    projects.brief.mockResolvedValue(briefWithInstalments());
    const res = await setProjectCancellation(null, form(body));
    expect(res?.ok && res.data.message).toContain(
      `${formatCurrency(2000)} of coordinator incentives is still to pay`,
    );
  });

  it("keeps the flash short when no incentive is owed", async () => {
    projects.brief.mockResolvedValue(
      brief({
        coordinators: [
          {
            id: "c1",
            full_name: "Ravi Kumar",
            sort_order: 1,
            incentive: {
              amount: 2000,
              paid_on: "2026-09-30",
              payments: [instalment("pay-1", 2000, "2026-09-30")],
              paid: 2000,
            },
          },
        ],
      }),
    );
    const res = await setProjectCancellation(null, form({ ...body, cancellation: "cancelled" }));
    expect(res).toEqual({ ok: true, data: { message: "Project marked cancelled." } });
  });

  it("a blank date on a new cancellation is today", async () => {
    await setProjectCancellation(null, form({ ...body, cancelled_on: "" }));
    expect(projects.setCancellation).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ cancelled_on: "2026-10-10" }),
    );
  });

  it("passes what is already recorded as `previous`: editing keeps the date, even an unrecorded one", async () => {
    // An import that never recorded when it stopped (no feasibility clock).
    projects.brief.mockResolvedValue(
      brief({
        cancellation: "cancelled",
        cancelled_on: null,
        feasibility_date: null,
        cancellation_remarks: "REFUNDED",
      }),
    );
    const res = await setProjectCancellation(
      null,
      form({ ...body, cancellation: "cancelled", cancelled_on: "", cancellation_remarks: "Cancelled by customer" }),
    );
    expect(res?.ok).toBe(true);
    expect(projects.setCancellation).toHaveBeenCalledWith("p1", {
      cancellation: "cancelled",
      cancelled_on: null,
      cancellation_remarks: "Cancelled by customer",
    });
  });

  it("will not leave a running feasibility clock without the date that stops it", async () => {
    projects.brief.mockResolvedValue(
      brief({ cancellation: "cancelled", cancelled_on: null, feasibility_date: "2026-09-20" }),
    );
    const res = await setProjectCancellation(null, form({ ...body, cancelled_on: "" }));
    expect(res).toEqual({
      ok: false,
      error: "Enter the date it was cancelled — it stops the feasibility clock.",
    });
    expect(projects.setCancellation).not.toHaveBeenCalled();
  });

  it("an edit that keeps the status is not announced again", async () => {
    projects.brief.mockResolvedValue(
      brief({ cancellation: "refunded", cancelled_on: "2026-10-01", cancellation_remarks: "old" }),
    );
    const res = await setProjectCancellation(null, form(body));
    expect(res).toEqual({ ok: true, data: { message: "Cancellation details saved." } });
    expect(notify).not.toHaveBeenCalled();
  });

  it("a change between cancelled and refunded is announced", async () => {
    projects.brief.mockResolvedValue(
      brief({ cancellation: "cancelled", cancelled_on: "2026-10-01" }),
    );
    await setProjectCancellation(null, form(body));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "project.cancelled", cancellation: "refunded" }),
    );
  });

  it.each([
    [{ cancellation: "" }, "Choose Cancelled or Refunded."],
    [{ cancellation: "void" }, "Choose Cancelled or Refunded."],
    [{ cancelled_on: "2026-10-11" }, "The date cannot be in the future."],
    [
      { cancelled_on: "2026-07-31" },
      "The date cannot be before the order date (2026-08-01).",
    ],
    [{ cancelled_on: "soon" }, "Enter a valid date."],
    [
      { cancellation_remarks: "x".repeat(2001) },
      "Remarks can be at most 2000 characters.",
    ],
  ])("refuses %j without writing", async (override, error) => {
    const res = await setProjectCancellation(null, form({ ...body, ...override }));
    expect(res).toEqual({ ok: false, error });
    expect(projects.setCancellation).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns the database's refusal and announces nothing", async () => {
    projects.setCancellation.mockResolvedValue({ error: "Project not found, or you cannot edit it." });
    const res = await setProjectCancellation(null, form(body));
    expect(res).toEqual({ ok: false, error: "Project not found, or you cannot edit it." });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("reinstateProject", () => {
  const cancelled = (over: Partial<ProjectBrief> = {}) =>
    brief({
      cancellation: "refunded",
      cancelled_on: "2026-05-01",
      cancellation_remarks: "Refunded in full",
      ...over,
    });
  const body = { project_id: "p1", cancellation_remarks: "Refunded in full", feasibility_date: "" };

  beforeEach(() => {
    projects.brief.mockResolvedValue(cancelled());
  });

  it("is office-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
    await expect(reinstateProject(null, form(body))).rejects.toThrow("REDIRECT:/work-orders");
    expect(projects.reinstate).not.toHaveBeenCalled();
  });

  it("only reinstates what is cancelled", async () => {
    projects.brief.mockResolvedValue(brief());
    const res = await reinstateProject(null, form(body));
    expect(res).toEqual({ ok: false, error: "This project is not cancelled." });
    expect(projects.reinstate).not.toHaveBeenCalled();
  });

  it("brings it back keeping the remarks, and tells the whole team what it was", async () => {
    const res = await reinstateProject(null, form(body));

    expect(res).toEqual({
      ok: true,
      data: { message: "Project reinstated — it is back in the active pipeline." },
    });
    expect(projects.reinstate).toHaveBeenCalledTimes(1);
    // No new date: the key is absent, not an empty value that would clear it.
    expect(projects.reinstate).toHaveBeenCalledWith("p1", { remarks: "Refunded in full" });
    expect(notify).toHaveBeenCalledWith({
      type: "project.reinstated",
      actorId: "admin-1",
      coordinatorIds: ["c1", "c2"],
      projectId: "p1",
      clientName: "Anand Kumar",
      previous: "refunded",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/work-orders/wo1");
  });

  it("takes a new feasibility date in the SAME update, so the clock never runs on the old one", async () => {
    const res = await reinstateProject(null, form({ ...body, feasibility_date: "2026-10-05" }));

    expect(projects.reinstate).toHaveBeenCalledTimes(1);
    expect(projects.reinstate).toHaveBeenCalledWith("p1", {
      remarks: "Refunded in full",
      feasibility_date: "2026-10-05",
    });
    expect(projects.setFeasibilityDate).not.toHaveBeenCalled();
    expect(res?.ok && res.data.message).toBe(
      "Project reinstated — it is back in the active pipeline. New feasibility date 05 Oct 2026.",
    );
  });

  it("lets the remarks be corrected or cleared on the way back", async () => {
    await reinstateProject(null, form({ ...body, cancellation_remarks: "  " }));
    expect(projects.reinstate).toHaveBeenCalledWith("p1", { remarks: null });
  });

  it("refuses a feasibility date on a custom plan", async () => {
    projects.brief.mockResolvedValue(cancelled({ plan_type: "custom", feasibility_date: null }));
    const res = await reinstateProject(null, form({ ...body, feasibility_date: "2026-10-05" }));
    expect(res).toEqual({ ok: false, error: "A custom plan has no KSEB feasibility date." });
    expect(projects.reinstate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("a custom plan with no date reinstates fine", async () => {
    projects.brief.mockResolvedValue(cancelled({ plan_type: "custom", feasibility_date: null }));
    const res = await reinstateProject(null, form(body));
    expect(res?.ok).toBe(true);
    expect(projects.reinstate).toHaveBeenCalledWith("p1", { remarks: "Refunded in full" });
  });

  describe("a commissioned project whose commissioning date was never recorded", () => {
    const undated = () =>
      cancelled({ is_completed: true, completed_at: null, feasibility_date: null });

    it("refuses a new feasibility date: reopened, its clock would run to today", async () => {
      projects.brief.mockResolvedValue(undated());
      const res = await reinstateProject(null, form({ ...body, feasibility_date: "2026-10-05" }));
      expect(res).toEqual({
        ok: false,
        error:
          "This project was commissioned on a date that was never recorded, so it has no feasibility clock.",
      });
      expect(projects.reinstate).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("reinstates fine when no date is typed", async () => {
      projects.brief.mockResolvedValue(undated());
      const res = await reinstateProject(null, form(body));
      expect(res?.ok).toBe(true);
      expect(projects.reinstate).toHaveBeenCalledWith("p1", { remarks: "Refunded in full" });
    });

    it("takes a new date when the commissioning instant is recorded", async () => {
      projects.brief.mockResolvedValue(
        cancelled({ is_completed: true, completed_at: "2026-06-01T05:00:00.000Z" }),
      );
      const res = await reinstateProject(null, form({ ...body, feasibility_date: "2026-10-05" }));
      expect(res?.ok).toBe(true);
      expect(projects.reinstate).toHaveBeenCalledWith("p1", {
        remarks: "Refunded in full",
        feasibility_date: "2026-10-05",
      });
    });
  });

  it.each([
    ["2026-10-11", "Feasibility date cannot be in the future."],
    ["soon", "Feasibility date must be a valid date."],
    ["2026-07-31", "The new feasibility date cannot be before the order date (2026-08-01)."],
  ])("refuses a new feasibility date of %s", async (date, error) => {
    const res = await reinstateProject(null, form({ ...body, feasibility_date: date }));
    expect(res).toEqual({ ok: false, error });
    expect(projects.reinstate).not.toHaveBeenCalled();
  });

  it("refuses remarks that are too long", async () => {
    const res = await reinstateProject(null, form({ ...body, cancellation_remarks: "x".repeat(2001) }));
    expect(res).toEqual({ ok: false, error: "Remarks can be at most 2000 characters." });
    expect(projects.reinstate).not.toHaveBeenCalled();
  });

  it("returns the database's refusal and announces nothing", async () => {
    projects.reinstate.mockResolvedValue({ error: "nope" });
    const res = await reinstateProject(null, form(body));
    expect(res).toEqual({ ok: false, error: "nope" });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("deleteProject", () => {
  it("is SuperAdmin-only", async () => {
    vi.mocked(requireSuperAdmin).mockRejectedValue(new Error("REDIRECT:/"));
    await expect(deleteProject(form({ project_id: "p1" }))).rejects.toThrow("REDIRECT:/");
    expect(projects.remove).not.toHaveBeenCalled();
  });

  it("returns the work order to pending so it can be approved again", async () => {
    await expect(deleteProject(form({ project_id: "p1" }))).rejects.toThrow(
      /^REDIRECT:\/projects\?flash=/,
    );
    expect(projects.remove).toHaveBeenCalledWith("p1");
    expect(workOrders.setStatus).toHaveBeenCalledWith("wo1", "pending");
  });
});
