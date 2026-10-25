import { describe, it, expect, afterEach } from "vitest";
import { serviceClient, signedInAs, USERS } from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import { parseCapacityKw } from "@/lib/domain/capacity";
import { HANDOVER_STAGE, stagesFor } from "@/lib/domain/plan";

/**
 * A custom plan (migration 20261022120100) is a sale that is not a kW solar
 * plant — "1 panel", "Inverter + panel". Its free text is the plan label in
 * `plant_capacity`; it has no kW (so nothing can price it per kW), no KSEB
 * feasibility date and a single Handover milestone, and its plan is fixed
 * once a project exists. Solar stays exactly as it was.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

afterEach(() => fx.cleanup());

const CUSTOM = {
  plan_type: "custom",
  plant_capacity: "Inverter + panel",
} as const;

async function plantCapacityKw(workOrderId: string): Promise<number | null> {
  return must(
    await svc
      .from("work_orders")
      .select("plant_capacity_kw")
      .eq("id", workOrderId)
      .single(),
    "work order",
  ).plant_capacity_kw;
}

async function milestonesOf(projectId: string) {
  return must(
    await svc
      .from("project_milestones")
      .select("stage, sort_order, status")
      .eq("project_id", projectId)
      .order("sort_order"),
    "milestones",
  );
}

describe("the plan of a work order", () => {
  it("is solar unless said otherwise", async () => {
    const id = await fx.workOrder({ client_name: `Default Plan ${RUN}` });
    const row = must(
      await svc.from("work_orders").select("plan_type").eq("id", id).single(),
      "work order",
    );
    expect(row.plan_type).toBe("solar");
  });

  it("is the same two choices in the database as in the code", async () => {
    const accepted = await svc.from("work_orders").insert({
      coordinator_id: USERS.rahul.id,
      client_name: `Bad Plan ${RUN}`,
      plant_capacity: "3kW",
      total_cost: 1,
      // @ts-expect-error — not a plan type: the enum refuses it.
      plan_type: "hybrid",
    });
    expect(accepted.error?.code).toBe("22P02");
  });
});

describe("work_orders.plant_capacity_kw", () => {
  it("is NULL for a custom plan, whatever the label says", async () => {
    for (const label of ["Inverter + panel", "1 panel", "5 kW inverter"]) {
      const id = await fx.workOrder({
        client_name: `Custom kW ${RUN} ${label}`,
        ...CUSTOM,
        plant_capacity: label,
      });
      expect(await plantCapacityKw(id), label).toBeNull();
    }
  });

  it("still follows the label for a solar plant, as parseCapacityKw() does", async () => {
    for (const label of ["3kW", "4.5 kWp", "3000W", "Solar 5kW plant", "to be surveyed"]) {
      const id = await fx.workOrder({
        client_name: `Solar kW ${RUN} ${label}`,
        plan_type: "solar",
        plant_capacity: label,
      });
      expect(await plantCapacityKw(id), label).toBe(parseCapacityKw(label));
    }
  });

  it("is recomputed when a pending order changes plan", async () => {
    const id = await fx.workOrder({
      client_name: `Plan Switch ${RUN}`,
      status: "pending",
      plant_capacity: "3kW",
    });
    expect(await plantCapacityKw(id)).toBe(3);

    const toCustom = await svc
      .from("work_orders")
      .update({ plan_type: "custom" })
      .eq("id", id);
    expect(toCustom.error).toBeNull();
    expect(await plantCapacityKw(id)).toBeNull();

    const back = await svc
      .from("work_orders")
      .update({ plan_type: "solar" })
      .eq("id", id);
    expect(back.error).toBeNull();
    expect(await plantCapacityKw(id)).toBe(3);
  });

  it("is what the list views report", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Custom Lists ${RUN}`, ...CUSTOM },
    });
    const workOrder = must(
      await svc
        .from("work_orders_list")
        .select("plan_type, plant_capacity, plant_capacity_kw")
        .eq("id", workOrderId)
        .single(),
      "work_orders_list",
    );
    const project = must(
      await svc
        .from("projects_list")
        .select(
          "plan_type, plant_capacity, plant_capacity_kw, current_stage, milestones_total, milestones_done, feasibility_days_left, feasibility_extension_cost",
        )
        .eq("id", projectId)
        .single(),
      "projects_list",
    );
    expect(workOrder).toEqual({
      plan_type: "custom",
      plant_capacity: "Inverter + panel",
      plant_capacity_kw: null,
    });
    expect(project).toEqual({
      plan_type: "custom",
      plant_capacity: "Inverter + panel",
      plant_capacity_kw: null,
      current_stage: HANDOVER_STAGE,
      milestones_total: 1,
      milestones_done: 0,
      feasibility_days_left: null,
      feasibility_extension_cost: 0,
    });
  });
});

describe("a custom plan's project", () => {
  it("is created, on approval, with a single Handover milestone", async () => {
    const workOrderId = await fx.workOrder({
      client_name: `Custom Approval ${RUN}`,
      status: "pending",
      ...CUSTOM,
    });
    const approve = await svc
      .from("work_orders")
      .update({ status: "approved" })
      .eq("id", workOrderId);
    expect(approve.error).toBeNull();

    const project = must(
      await svc
        .from("projects")
        .select("id, current_stage, is_completed, feasibility_date")
        .eq("work_order_id", workOrderId)
        .single(),
      "project",
    );
    expect(project).toMatchObject({
      current_stage: "plant_commissioning",
      is_completed: false,
      feasibility_date: null,
    });
    expect(await milestonesOf(project.id)).toEqual([
      { stage: "plant_commissioning", sort_order: 9, status: "pending" },
    ]);
    // The code and the database agree on the plan's stages.
    expect((await milestonesOf(project.id)).map((m) => m.stage)).toEqual(
      stagesFor("custom"),
    );
  });

  it("leaves a solar plant on its nine milestones", async () => {
    const workOrderId = await fx.workOrder({
      client_name: `Solar Approval ${RUN}`,
      status: "pending",
    });
    await svc.from("work_orders").update({ status: "approved" }).eq("id", workOrderId);
    const project = must(
      await svc
        .from("projects")
        .select("id, current_stage")
        .eq("work_order_id", workOrderId)
        .single(),
      "project",
    );
    expect(project.current_stage).toBe("site_feasibility_survey");
    expect((await milestonesOf(project.id)).map((m) => m.stage)).toEqual(
      stagesFor("solar"),
    );
  });

  it("starts at Handover whatever stage the insert asks for", async () => {
    const workOrderId = await fx.workOrder({
      client_name: `Custom Stage ${RUN}`,
      ...CUSTOM,
    });
    const project = must(
      await svc
        .from("projects")
        .insert({
          work_order_id: workOrderId,
          coordinator_id: USERS.rahul.id,
          current_stage: "site_feasibility_survey",
        })
        .select("id, current_stage")
        .single(),
      "project",
    );
    expect(project.current_stage).toBe("plant_commissioning");
  });

  it("has no KSEB feasibility date — on insert or afterwards", async () => {
    const workOrderId = await fx.workOrder({
      client_name: `Custom Feasibility ${RUN}`,
      ...CUSTOM,
    });
    const insert = await svc.from("projects").insert({
      work_order_id: workOrderId,
      coordinator_id: USERS.rahul.id,
      feasibility_date: "2026-10-01",
    });
    expect(insert.error?.code).toBe("23514");
    expect(insert.error?.message).toMatch(/no KSEB feasibility date/i);

    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: `Custom Feasibility Update ${RUN}`, ...CUSTOM },
    });
    const admin = await signedInAs(USERS.admin);
    for (const client of [svc, admin]) {
      const update = await client
        .from("projects")
        .update({ feasibility_date: "2026-10-01" })
        .eq("id", projectId);
      expect(update.error?.code).toBe("23514");
    }
    // Clearing (or re-saving) the empty date is fine.
    const clear = await admin
      .from("projects")
      .update({ feasibility_date: null })
      .eq("id", projectId);
    expect(clear.error).toBeNull();
  });

  it("counts as commissioned and payment pending once handed over, like any project", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: {
        client_name: `Custom Handover ${RUN}`,
        total_cost: 42000,
        advance_amount: 10000,
        ...CUSTOM,
      },
    });
    const admin = await signedInAs(USERS.admin);
    must(
      await admin
        .from("project_milestones")
        .update({ status: "completed" })
        .eq("project_id", projectId)
        .select("id"),
      "complete handover",
    );
    const done = await admin
      .from("projects")
      .update({
        is_completed: true,
        completed_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    expect(done.error).toBeNull();

    const row = must(
      await svc
        .from("projects_list")
        .select("is_completed, payment_pending, balance_due, milestones_done")
        .eq("id", projectId)
        .single(),
      "projects_list",
    );
    expect(row).toEqual({
      is_completed: true,
      payment_pending: true,
      balance_due: 32000,
      milestones_done: 1,
    });

    // …and not once the balance is collected.
    await fx.payment(workOrderId, { amount: 32000 });
    const settled = must(
      await svc
        .from("projects_list")
        .select("payment_pending, balance_due")
        .eq("id", projectId)
        .single(),
      "projects_list",
    );
    expect(settled).toEqual({ payment_pending: false, balance_due: 0 });
  });

  it("still takes KSEB-fee payments and service tickets", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Custom Extras ${RUN}`, ...CUSTOM },
    });
    const payment = await svc.from("payments").insert({
      work_order_id: workOrderId,
      amount: 1180,
      paid_on: "2026-10-01",
      purpose: "kseb_fees",
    });
    expect(payment.error).toBeNull();
    const ticketId = await fx.ticket({ project_id: projectId });
    expect(ticketId).toBeTruthy();
  });
});

describe("changing the plan", () => {
  it("is allowed while the sale is pending, for the office and the coordinator alike", async () => {
    const id = await fx.workOrder({
      client_name: `Plan Pending ${RUN}`,
      status: "pending",
    });
    const rahul = await signedInAs(USERS.rahul);
    const admin = await signedInAs(USERS.admin);

    const byCoordinator = await rahul
      .from("work_orders")
      .update({ plan_type: "custom", plant_capacity: "1 panel" })
      .eq("id", id);
    expect(byCoordinator.error).toBeNull();
    const byOffice = await admin
      .from("work_orders")
      .update({ plan_type: "solar", plant_capacity: "3kW" })
      .eq("id", id);
    expect(byOffice.error).toBeNull();
  });

  it("is allowed on an approved order that has no project yet", async () => {
    const id = await fx.workOrder({ client_name: `Plan No Project ${RUN}` });
    const change = await svc
      .from("work_orders")
      .update({ plan_type: "custom", plant_capacity: "1 panel" })
      .eq("id", id);
    expect(change.error).toBeNull();
  });

  it("is refused once a project exists, in every context", async () => {
    for (const plan of ["solar", "custom"] as const) {
      const other = plan === "solar" ? "custom" : "solar";
      const { workOrderId } = await fx.approvedProject({
        workOrder: {
          client_name: `Plan Fixed ${plan} ${RUN}`,
          plan_type: plan,
          plant_capacity: plan === "solar" ? "3kW" : "Inverter + panel",
        },
      });
      const admin = await signedInAs(USERS.admin);
      const rahul = await signedInAs(USERS.rahul);

      for (const [who, client] of [
        ["service role", svc],
        ["the office", admin],
        ["the coordinator", rahul],
      ] as const) {
        const { error } = await client
          .from("work_orders")
          .update({ plan_type: other })
          .eq("id", workOrderId);
        expect(error?.code, `${plan} → ${other} by ${who}`).toBe("23514");
        expect(error?.message).toMatch(/plan is fixed once the work order has a project/i);
      }

      const stored = must(
        await svc
          .from("work_orders")
          .select("plan_type")
          .eq("id", workOrderId)
          .single(),
        "work order",
      );
      expect(stored.plan_type).toBe(plan);
      // Saving the same plan again (an edit of other fields) is not a change.
      const same = await admin
        .from("work_orders")
        .update({ plan_type: plan, address: "Same plan" })
        .eq("id", workOrderId);
      expect(same.error).toBeNull();
    }
  });
});
