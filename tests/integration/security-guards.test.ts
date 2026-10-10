import { describe, it, expect, afterAll } from "vitest";
import { signedInAs, serviceClient, USERS, withDb } from "./helpers";
import { uniqueTag } from "./fixtures";

/**
 * The confirmed critical vulnerabilities, pinned so they can never regress:
 *   - a coordinator cannot escalate their own role to admin
 *   - a coordinator cannot self-approve / reassign a work order, nor create
 *     one that is already approved
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
    const rahul = await signedInAs(USERS.rahul);
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
    const admin = await signedInAs(USERS.admin);
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
    const rahul = await signedInAs(USERS.rahul);

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
    const rahul = await signedInAs(USERS.rahul);

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

  describe("creating a work order", () => {
    const clientNames: string[] = [];

    afterAll(async () => {
      await svc.from("work_orders").delete().in("client_name", clientNames);
    });

    function newWorkOrder(status?: "pending" | "approved" | "rejected") {
      const client_name = `Insert guard ${uniqueTag()}`;
      clientNames.push(client_name);
      return {
        coordinator_id: USERS.rahul.id,
        client_name,
        plant_capacity: "5kW",
        total_cost: 900000,
        ...(status && { status }),
      };
    }

    async function stored(clientName: string) {
      const { data } = await svc
        .from("work_orders")
        .select("status")
        .eq("client_name", clientName);
      return data ?? [];
    }

    it.each(["approved", "rejected"] as const)(
      "blocks a coordinator from creating one that is already %s",
      async (status) => {
        const rahul = await signedInAs(USERS.rahul);
        const values = newWorkOrder(status);

        const { error } = await rahul.from("work_orders").insert(values);
        expect(error?.code).toBe("42501");
        expect(await stored(values.client_name)).toEqual([]);
      },
    );

    it("still lets a coordinator log a pending one, explicitly or by default", async () => {
      const rahul = await signedInAs(USERS.rahul);
      const explicit = newWorkOrder("pending");
      const implicit = newWorkOrder();

      expect((await rahul.from("work_orders").insert(explicit)).error).toBeNull();
      expect((await rahul.from("work_orders").insert(implicit)).error).toBeNull();
      expect(await stored(explicit.client_name)).toEqual([{ status: "pending" }]);
      expect(await stored(implicit.client_name)).toEqual([{ status: "pending" }]);
    });

    it("lets the office create one already approved (positive control)", async () => {
      const admin = await signedInAs(USERS.admin);
      const values = newWorkOrder("approved");

      expect((await admin.from("work_orders").insert(values)).error).toBeNull();
      expect(await stored(values.client_name)).toEqual([{ status: "approved" }]);
    });

    // Defense in depth: the wo_insert policy and the guard trigger each refuse
    // it on their own, so neither is a single point of failure.
    it("is refused by the insert policy and by the guard trigger independently", async () => {
      const values = newWorkOrder("approved");
      const insert = `insert into public.work_orders
          (coordinator_id, client_name, plant_capacity, total_cost, status)
        values ($1, $2, $3, $4, $5)`;
      const params = [
        values.coordinator_id,
        values.client_name,
        values.plant_capacity,
        values.total_cost,
        values.status,
      ];

      await withDb(async (db) => {
        await db.query("begin");
        try {
          await db.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ sub: USERS.rahul.id, role: "authenticated" }),
          ]);

          // The trigger alone: the table owner bypasses RLS, yet auth.uid() is Rahul.
          await db.query("savepoint trigger_only");
          await expect(db.query(insert, params)).rejects.toThrow(/starts as pending/);
          await db.query("rollback to savepoint trigger_only");

          // The policy alone: as the API role, with the trigger switched off
          // (inside this transaction only — it is rolled back below).
          await db.query("alter table public.work_orders disable trigger t_wo_guard");
          await db.query("set local role authenticated");
          await expect(db.query(insert, params)).rejects.toThrow(/row-level security/);
        } finally {
          await db.query("rollback");
        }
      });
    });
  });
});
