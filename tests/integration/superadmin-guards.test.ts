import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { clientAs, serviceClient, USERS } from "./helpers";

/**
 * The SuperAdmin owns every destructive action. These pin the two halves of that
 * contract at the database level, where it is actually enforced:
 *
 *   - a plain admin (and a coordinator) cannot DELETE users, projects or work
 *     orders — RLS filters the rows away, so the statement removes nothing;
 *   - the SuperAdmin can, and the seat itself cannot be duplicated or quietly
 *     taken over by an admin.
 */
const svc = serviceClient();

/** A throwaway approved work order + its project, created past RLS. */
async function makeFixture(client = "SuperAdmin Guard Fixture") {
  const wo = await svc
    .from("work_orders")
    .insert({
      coordinator_id: USERS.rahul.id,
      client_name: client,
      plant_capacity: "5kW",
      total_cost: 300000,
      status: "approved",
    })
    .select("id")
    .single();
  if (wo.error || !wo.data) throw new Error(wo.error?.message ?? "no work order");

  const pr = await svc
    .from("projects")
    .insert({ work_order_id: wo.data.id, coordinator_id: USERS.rahul.id })
    .select("id")
    .single();
  if (pr.error || !pr.data) throw new Error(pr.error?.message ?? "no project");

  return { workOrderId: wo.data.id as string, projectId: pr.data.id as string };
}

async function cleanup(workOrderId: string) {
  await svc.from("work_orders").delete().eq("id", workOrderId);
}

describe("delete is SuperAdmin-only", () => {
  it("an admin cannot delete a work order", async () => {
    const { workOrderId } = await makeFixture("Admin Delete Attempt");
    try {
      const admin = await clientAs(USERS.admin.email, USERS.admin.password);
      const { error } = await admin
        .from("work_orders")
        .delete()
        .eq("id", workOrderId)
        .select("id");
      // RLS filters the row out: no error, but nothing is removed.
      expect(error).toBeNull();

      const { data } = await svc
        .from("work_orders")
        .select("id")
        .eq("id", workOrderId);
      expect(data ?? []).toHaveLength(1);
    } finally {
      await cleanup(workOrderId);
    }
  });

  it("an admin cannot delete a project", async () => {
    const { workOrderId, projectId } = await makeFixture("Admin Project Delete");
    try {
      const admin = await clientAs(USERS.admin.email, USERS.admin.password);
      await admin.from("projects").delete().eq("id", projectId);

      const { data } = await svc.from("projects").select("id").eq("id", projectId);
      expect(data ?? []).toHaveLength(1);
    } finally {
      await cleanup(workOrderId);
    }
  });

  it("a coordinator cannot delete their own work order", async () => {
    const { workOrderId } = await makeFixture("Coordinator Delete Attempt");
    try {
      const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);
      await rahul.from("work_orders").delete().eq("id", workOrderId);

      const { data } = await svc
        .from("work_orders")
        .select("id")
        .eq("id", workOrderId);
      expect(data ?? []).toHaveLength(1);
    } finally {
      await cleanup(workOrderId);
    }
  });

  it("an admin cannot delete a profile", async () => {
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    await admin.from("profiles").delete().eq("id", USERS.sneha.id);

    const { data } = await svc
      .from("profiles")
      .select("id")
      .eq("id", USERS.sneha.id);
    expect(data ?? []).toHaveLength(1);
  });

  it("the SuperAdmin can delete a project (cascading its milestones)", async () => {
    const { workOrderId, projectId } = await makeFixture("Super Project Delete");
    try {
      const su = await clientAs(
        USERS.superadmin.email,
        USERS.superadmin.password,
      );
      const { data: deleted, error } = await su
        .from("projects")
        .delete()
        .eq("id", projectId)
        .select("id");
      expect(error).toBeNull();
      expect(deleted ?? []).toHaveLength(1);

      const milestones = await svc
        .from("project_milestones")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      expect(milestones.count).toBe(0);
    } finally {
      await cleanup(workOrderId);
    }
  });

  it("the SuperAdmin can delete a work order (cascading its project)", async () => {
    const { workOrderId, projectId } = await makeFixture("Super WO Delete");
    const su = await clientAs(USERS.superadmin.email, USERS.superadmin.password);
    const { data: deleted, error } = await su
      .from("work_orders")
      .delete()
      .eq("id", workOrderId)
      .select("id");
    expect(error).toBeNull();
    expect(deleted ?? []).toHaveLength(1);

    const project = await svc.from("projects").select("id").eq("id", projectId);
    expect(project.data ?? []).toHaveLength(0);
  });
});

describe("deleting a team member", () => {
  it("is refused while they still own work orders (on delete restrict)", async () => {
    // Rahul owns seeded work orders, so the profile row must be undeletable even
    // for the privileged path the app uses (service role bypasses RLS entirely).
    const { error } = await svc
      .from("profiles")
      .delete()
      .eq("id", USERS.rahul.id);
    expect(error).not.toBeNull();

    const { data } = await svc
      .from("profiles")
      .select("id")
      .eq("id", USERS.rahul.id);
    expect(data ?? []).toHaveLength(1);
  });

  it("the SuperAdmin can delete a member who owns nothing", async () => {
    const created = await svc.auth.admin.createUser({
      email: `disposable-${Date.now()}@bsssolar.test`,
      password: "Disposable@12345",
      email_confirm: true,
      user_metadata: { full_name: "Disposable Staff" },
    });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;

    const su = await clientAs(USERS.superadmin.email, USERS.superadmin.password);
    const { data: deleted, error } = await su
      .from("profiles")
      .delete()
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(deleted ?? []).toHaveLength(1);

    // Clean up the auth user the profile row was hanging off.
    await svc.auth.admin.deleteUser(id);
  });
});

describe("the SuperAdmin seat", () => {
  beforeEach(async () => {
    // Every test below assumes the seeded seat is occupied by the seeded holder.
    await svc
      .from("profiles")
      .update({ role: "superadmin" })
      .eq("id", USERS.superadmin.id);
  });

  afterAll(async () => {
    await svc.from("profiles").update({ role: "admin" }).eq("id", USERS.admin.id);
    await svc
      .from("profiles")
      .update({ role: "coordinator" })
      .eq("id", USERS.sneha.id);
    await svc
      .from("profiles")
      .update({ role: "superadmin" })
      .eq("id", USERS.superadmin.id);
  });

  it("holds at most one SuperAdmin", async () => {
    const { error } = await svc
      .from("profiles")
      .update({ role: "superadmin" })
      .eq("id", USERS.sneha.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/uniq_profiles_single_superadmin/);

    const { count } = await svc
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "superadmin");
    expect(count).toBe(1);
  });

  it("blocks an admin from promoting anyone to SuperAdmin while it is taken", async () => {
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    const { error } = await admin
      .from("profiles")
      .update({ role: "superadmin" })
      .eq("id", USERS.sneha.id);
    expect(error).not.toBeNull();

    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", USERS.sneha.id)
      .single();
    expect(data?.role).toBe("coordinator");
  });

  it("blocks an admin from demoting the SuperAdmin", async () => {
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    const { error } = await admin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", USERS.superadmin.id);
    expect(error).not.toBeNull();

    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", USERS.superadmin.id)
      .single();
    expect(data?.role).toBe("superadmin");
  });

  it("blocks a coordinator from claiming the seat", async () => {
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);
    const { error } = await rahul
      .from("profiles")
      .update({ role: "superadmin" })
      .eq("id", USERS.rahul.id);
    expect(error).not.toBeNull();

    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", USERS.rahul.id)
      .single();
    expect(data?.role).toBe("coordinator");
  });

  it("lets the SuperAdmin step down, after which any admin may appoint one", async () => {
    // Step down (only the holder may revoke the seat).
    const su = await clientAs(USERS.superadmin.email, USERS.superadmin.password);
    const stepDown = await su
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", USERS.superadmin.id);
    expect(stepDown.error).toBeNull();

    // Vacant seat: the bootstrap/recovery path opens up for a plain admin.
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    const appoint = await admin
      .from("profiles")
      .update({ role: "superadmin" })
      .eq("id", USERS.sneha.id);
    expect(appoint.error).toBeNull();

    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", USERS.sneha.id)
      .single();
    expect(data?.role).toBe("superadmin");

    // Restore the seeded arrangement for the remaining suites.
    await svc
      .from("profiles")
      .update({ role: "coordinator" })
      .eq("id", USERS.sneha.id);
  });

  it("still lets the SuperAdmin see and manage everything an admin can", async () => {
    const su = await clientAs(USERS.superadmin.email, USERS.superadmin.password);
    const orders = await su
      .from("work_orders")
      .select("id", { count: "exact", head: true });
    expect(orders.error).toBeNull();
    expect(orders.count ?? 0).toBeGreaterThan(0);

    const isAdmin = await su.rpc("is_admin");
    expect(isAdmin.data).toBe(true);
    const isSuper = await su.rpc("is_superadmin");
    expect(isSuper.data).toBe(true);

    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    expect((await admin.rpc("is_superadmin")).data).toBe(false);
    expect((await admin.rpc("is_admin")).data).toBe(true);
  });
});
