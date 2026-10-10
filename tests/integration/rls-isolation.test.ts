import { describe, it, expect } from "vitest";
import { signedInAs, anonClient, USERS } from "./helpers";

/**
 * Row Level Security: coordinators must only ever see their OWN data; admins see
 * everything. A regression here leaks client PII and financials across tenants.
 */
describe("RLS read isolation", () => {
  it("a coordinator sees only their own work orders", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul.from("work_orders").select("id, coordinator_id");
    expect(error).toBeNull();
    expect(data && data.length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(row.coordinator_id).toBe(USERS.rahul.id);
    }
  });

  it("a different coordinator sees a disjoint set", async () => {
    const priya = await signedInAs(USERS.priya);
    const { data } = await priya.from("work_orders").select("id, coordinator_id");
    for (const row of data ?? []) {
      expect(row.coordinator_id).toBe(USERS.priya.id);
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

  it("a coordinator sees only projects they own", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data } = await rahul.from("projects").select("id, coordinator_id");
    for (const row of data ?? []) {
      expect(row.coordinator_id).toBe(USERS.rahul.id);
    }
  });

  it("a coordinator only sees service tickets on their own projects", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data } = await rahul
      .from("service_tickets")
      .select("id, project:projects(coordinator_id)");
    for (const row of (data ?? []) as unknown as {
      project: { coordinator_id: string } | null;
    }[]) {
      expect(row.project?.coordinator_id).toBe(USERS.rahul.id);
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
});
