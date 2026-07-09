import { describe, it, expect, afterEach } from "vitest";
import { serviceClient, USERS } from "./helpers";

/**
 * The onboarding importer inserts an already-'approved' work order and then
 * creates the project itself. This pins the assumptions it relies on:
 *  - inserting an approved WO does NOT auto-create a project (the trigger fires
 *    only on the pending->approved UPDATE), so there is no duplicate;
 *  - creating the project seeds the 9 milestones, which can be completed up to
 *    a target stage.
 */
describe("project import mechanics", () => {
  const svc = serviceClient();
  let workOrderId: string | null = null;

  afterEach(async () => {
    if (workOrderId) {
      await svc.from("work_orders").delete().eq("id", workOrderId);
      workOrderId = null;
    }
  });

  it("inserting an approved WO does not auto-create a project", async () => {
    const wo = await svc
      .from("work_orders")
      .insert({
        coordinator_id: USERS.rahul.id,
        client_name: "Import Mechanics Client",
        plant_capacity: "5kW",
        total_cost: 300000,
        status: "approved",
      })
      .select("id")
      .single();
    expect(wo.error).toBeNull();
    workOrderId = wo.data!.id;

    const projects = await svc
      .from("projects")
      .select("id")
      .eq("work_order_id", workOrderId);
    expect(projects.data ?? []).toHaveLength(0);
  });

  it("manual project creation seeds 9 milestones and can be advanced to a stage", async () => {
    const wo = await svc
      .from("work_orders")
      .insert({
        coordinator_id: USERS.rahul.id,
        client_name: "Import Stage Client",
        plant_capacity: "5kW",
        total_cost: 300000,
        status: "approved",
      })
      .select("id")
      .single();
    workOrderId = wo.data!.id;

    const pr = await svc
      .from("projects")
      .insert({ work_order_id: workOrderId, coordinator_id: USERS.rahul.id })
      .select("id")
      .single();
    expect(pr.error).toBeNull();
    const projectId = pr.data!.id;

    const seeded = await svc
      .from("project_milestones")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    expect(seeded.count).toBe(9);

    // Complete milestones up to sort_order 4 (material_dispatch).
    const { data: milestones } = await svc
      .from("project_milestones")
      .select("id, sort_order")
      .eq("project_id", projectId);
    const completedIds = (milestones ?? [])
      .filter((m) => m.sort_order < 4)
      .map((m) => m.id);
    await svc
      .from("project_milestones")
      .update({ status: "completed" })
      .in("id", completedIds);
    await svc
      .from("projects")
      .update({ current_stage: "material_dispatch" })
      .eq("id", projectId);

    const done = await svc
      .from("project_milestones")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "completed");
    expect(done.count).toBe(3);
  });
});
