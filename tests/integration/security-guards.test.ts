import { describe, it, expect, afterAll } from "vitest";
import { clientAs, serviceClient, USERS } from "./helpers";

/**
 * The confirmed critical vulnerabilities, pinned so they can never regress:
 *   - a coordinator cannot escalate their own role to admin
 *   - a coordinator cannot self-approve / reassign a work order
 *   - an admin retains the legitimate ability to do both
 */
describe("privilege-escalation guards", () => {
  const svc = serviceClient();

  afterAll(async () => {
    // Restore any state the negative tests may have touched.
    await svc
      .from("profiles")
      .update({ role: "coordinator" })
      .eq("id", USERS.rahul.id);
    await svc.from("profiles").update({ role: "admin" }).eq("id", USERS.admin.id);
  });

  it("blocks a coordinator from promoting themselves to admin", async () => {
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);
    const { error } = await rahul
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", USERS.rahul.id);

    // The BEFORE trigger raises, surfacing an error to the client.
    expect(error).not.toBeNull();

    // Authoritative check: role is unchanged in the database.
    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", USERS.rahul.id)
      .single();
    expect(data?.role).toBe("coordinator");
  });

  it("allows an admin to change roles (positive control)", async () => {
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    const up = await admin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", USERS.priya.id);
    expect(up.error).toBeNull();

    const down = await admin
      .from("profiles")
      .update({ role: "coordinator" })
      .eq("id", USERS.priya.id);
    expect(down.error).toBeNull();

    const { data } = await svc
      .from("profiles")
      .select("role")
      .eq("id", USERS.priya.id)
      .single();
    expect(data?.role).toBe("coordinator");
  });
});

describe("work-order self-approval guards", () => {
  const svc = serviceClient();

  async function rahulsPendingWorkOrderId(): Promise<string> {
    const { data } = await svc
      .from("work_orders")
      .select("id")
      .eq("coordinator_id", USERS.rahul.id)
      .eq("status", "pending")
      .limit(1)
      .single();
    if (!data) throw new Error("expected a seeded pending work order for Rahul");
    return data.id;
  }

  it("blocks a coordinator from approving their own work order", async () => {
    const id = await rahulsPendingWorkOrderId();
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);

    const { error } = await rahul
      .from("work_orders")
      .update({ status: "approved" })
      .eq("id", id);
    expect(error).not.toBeNull();

    const { data } = await svc
      .from("work_orders")
      .select("status")
      .eq("id", id)
      .single();
    expect(data?.status).toBe("pending");
  });

  it("blocks a coordinator from reassigning a work order to someone else", async () => {
    const id = await rahulsPendingWorkOrderId();
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);

    const { error } = await rahul
      .from("work_orders")
      .update({ coordinator_id: USERS.priya.id })
      .eq("id", id);
    expect(error).not.toBeNull();

    const { data } = await svc
      .from("work_orders")
      .select("coordinator_id")
      .eq("id", id)
      .single();
    expect(data?.coordinator_id).toBe(USERS.rahul.id);
  });
});
