import { describe, it, expect, afterEach } from "vitest";
import { serviceClient, USERS } from "./helpers";

/**
 * Approving a work order must atomically create exactly one project seeded with
 * the 9 KSEB/ANERT milestones — enforced by DB triggers so it cannot desync,
 * regardless of which path performs the approval. Idempotent under re-approval.
 */
describe("approval -> project -> milestones", () => {
  const svc = serviceClient();
  let workOrderId: string | null = null;

  afterEach(async () => {
    if (workOrderId) {
      // Cascades to project + milestones.
      await svc.from("work_orders").delete().eq("id", workOrderId);
      workOrderId = null;
    }
  });

  it("creates one project with 9 milestones when a work order is approved", async () => {
    const insert = await svc
      .from("work_orders")
      .insert({
        coordinator_id: USERS.rahul.id,
        client_name: "Integration Test Client",
        plant_capacity: "5kW",
        total_cost: 300000,
        status: "pending",
      })
      .select("id")
      .single();
    expect(insert.error).toBeNull();
    workOrderId = insert.data!.id;

    // No project yet while pending.
    const before = await svc
      .from("projects")
      .select("id")
      .eq("work_order_id", workOrderId);
    expect(before.data ?? []).toHaveLength(0);

    // Approve -> trigger creates the project.
    const approve = await svc
      .from("work_orders")
      .update({ status: "approved" })
      .eq("id", workOrderId);
    expect(approve.error).toBeNull();

    const projects = await svc
      .from("projects")
      .select("id")
      .eq("work_order_id", workOrderId);
    expect(projects.data ?? []).toHaveLength(1);

    const projectId = projects.data![0].id;
    const { count } = await svc
      .from("project_milestones")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    expect(count).toBe(9);
  });

  it("is idempotent: re-approving does not create a second project", async () => {
    const insert = await svc
      .from("work_orders")
      .insert({
        coordinator_id: USERS.rahul.id,
        client_name: "Idempotency Test Client",
        plant_capacity: "3kW",
        total_cost: 180000,
        status: "pending",
      })
      .select("id")
      .single();
    workOrderId = insert.data!.id;

    await svc.from("work_orders").update({ status: "approved" }).eq("id", workOrderId);
    // A no-op re-write to approved (already approved) must not duplicate.
    await svc.from("work_orders").update({ status: "approved" }).eq("id", workOrderId);

    const projects = await svc
      .from("projects")
      .select("id")
      .eq("work_order_id", workOrderId);
    expect(projects.data ?? []).toHaveLength(1);
  });
});
