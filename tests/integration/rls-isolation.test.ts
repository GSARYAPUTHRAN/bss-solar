import { describe, it, expect } from "vitest";
import { signedInAs, anonClient, serviceClient, USERS, type SeedUser } from "./helpers";
import { must } from "./fixtures";

/**
 * Row Level Security: coordinators must only ever see the sales they are ON
 * (their own, or one shared with them); admins see everything. A regression
 * here leaks client PII and financials across tenants.
 */
const svc = serviceClient();

/** The work orders a user is a member of, straight from the table. */
async function salesOf(user: SeedUser): Promise<string[]> {
  return must(
    await svc
      .from("work_order_coordinators")
      .select("work_order_id")
      .eq("coordinator_id", user.id),
    "memberships",
  )
    .map((m) => m.work_order_id)
    .sort();
}

describe("RLS read isolation", () => {
  it("a coordinator sees exactly the sales they are on", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul.from("work_orders").select("id, coordinator_id");
    expect(error).toBeNull();
    expect(data && data.length).toBeGreaterThan(0);
    expect((data ?? []).map((r) => r.id).sort()).toEqual(await salesOf(USERS.rahul));
    // …and the ones he logged himself are among them.
    for (const row of data ?? []) {
      if (row.coordinator_id !== USERS.rahul.id) {
        expect(await salesOf(USERS.rahul)).toContain(row.id);
      }
    }
  });

  it("a different coordinator sees a different set, overlapping only on a shared sale", async () => {
    const priya = await signedInAs(USERS.priya);
    const { data } = await priya.from("work_orders").select("id, coordinator_id");
    const priyas = (data ?? []).map((r) => r.id).sort();
    expect(priyas).toEqual(await salesOf(USERS.priya));

    const rahuls = await salesOf(USERS.rahul);
    const shared = priyas.filter((id) => rahuls.includes(id));
    // The seeded sale Rahul and Priya made together — and only that.
    expect(shared).toHaveLength(1);
    const row = (data ?? []).find((r) => r.id === shared[0]);
    expect(row?.coordinator_id).toBe(USERS.rahul.id); // Rahul logged it; Priya shares it
  });

  it("a coordinator who shares nothing sees no one else's work orders", async () => {
    for (const user of [USERS.arun, USERS.sneha]) {
      const client = await signedInAs(user);
      const { data } = await client.from("work_orders").select("id");
      expect((data ?? []).map((r) => r.id).sort(), user.email).toEqual(
        await salesOf(user),
      );
    }
  });

  it("an admin sees all work orders", async () => {
    const admin = await signedInAs(USERS.admin);
    const rahul = await signedInAs(USERS.rahul);
    const { count: adminCount } = await admin
      .from("work_orders")
      .select("id", { count: "exact", head: true });
    const { count: rahulCount } = await rahul
      .from("work_orders")
      .select("id", { count: "exact", head: true });
    expect((adminCount ?? 0)).toBeGreaterThan(rahulCount ?? 0);
  });

  it("a coordinator sees only projects of the sales they are on", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data } = await rahul.from("projects").select("id, work_order_id");
    expect((data ?? []).length).toBeGreaterThan(0);
    const mine = await salesOf(USERS.rahul);
    for (const row of data ?? []) expect(mine).toContain(row.work_order_id);
  });

  it("a coordinator only sees service tickets on projects of their sales", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data } = await rahul
      .from("service_tickets")
      .select("id, project:projects(work_order_id)");
    const mine = await salesOf(USERS.rahul);
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of (data ?? []) as unknown as {
      project: { work_order_id: string } | null;
    }[]) {
      expect(mine).toContain(row.project?.work_order_id);
    }

    // Admin sees strictly more (all seeded tickets).
    const admin = await signedInAs(USERS.admin);
    const { count } = await admin
      .from("service_tickets")
      .select("id", { count: "exact", head: true });
    expect(count ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("an anonymous (signed-out) client sees no work orders", async () => {
    const anon = anonClient();
    const { data } = await anon.from("work_orders").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("a signed-out client sees no memberships or incentives either", async () => {
    const anon = anonClient();
    for (const table of ["work_order_coordinators", "coordinator_incentives"] as const) {
      const { data, error } = await anon.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data ?? [], table).toHaveLength(0);
    }
  });
});
