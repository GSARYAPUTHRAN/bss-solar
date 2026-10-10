import { describe, it, expect } from "vitest";
import { signedInAs, serviceClient, USERS } from "./helpers";

/**
 * The flattened list views back server-side pagination. They are SECURITY
 * INVOKER, so a coordinator must only see their own rows through them, and
 * filter/search/order/range must work against the flat columns.
 */
describe("list views", () => {
  it("work_orders_list respects RLS (coordinator sees only their own)", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul
      .from("work_orders_list")
      .select("id, coordinator_id, coordinator_name");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(row.coordinator_id).toBe(USERS.rahul.id);
      expect(row.coordinator_name).toBeTruthy(); // join resolved through RLS
    }
  });

  it("work_orders_list supports status filter + exact count", async () => {
    const svc = serviceClient();
    const { data, count, error } = await svc
      .from("work_orders_list")
      .select("id, status", { count: "exact" })
      .eq("status", "pending");
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.status).toBe("pending");
  });

  it("work_orders_list supports ilike search + range", async () => {
    const svc = serviceClient();
    const { data } = await svc
      .from("work_orders_list")
      .select("client_name")
      .ilike("client_name", "%anand%")
      .range(0, 4);
    expect((data ?? []).some((r) => /anand/i.test(r.client_name ?? ""))).toBe(true);
    expect((data ?? []).length).toBeLessThanOrEqual(5);
  });

  it("projects_list exposes milestone counts and client name", async () => {
    const svc = serviceClient();
    const { data } = await svc
      .from("projects_list")
      .select("id, client_name, milestones_done, milestones_total")
      .order("created_at", { ascending: false })
      .range(0, 9);
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(Number(row.milestones_total)).toBeGreaterThanOrEqual(
        Number(row.milestones_done),
      );
    }
  });

  it("service_tickets_list flattens the client name", async () => {
    const svc = serviceClient();
    const { data } = await svc
      .from("service_tickets_list")
      .select("id, ticket_no, client_name")
      .not("client_name", "is", null)
      .limit(1);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("service_tickets_list names the assigned engineer", async () => {
    const svc = serviceClient();
    const { data, error } = await svc
      .from("service_tickets_list")
      .select("ticket_no, assigned_to, assignee_name")
      .eq("ticket_no", "BSS-2606-1002")
      .single();
    expect(error).toBeNull();
    expect(data?.assigned_to).toBe(USERS.vineeth.id);
    expect(data?.assignee_name).toBe("Vineeth Nair");
  });

  it("work_orders_list exposes financing and the numeric capacity", async () => {
    const svc = serviceClient();
    const { data, error } = await svc
      .from("work_orders_list")
      .select("client_name, financing_type, loan_bank_name, plant_capacity_kw")
      .in("client_name", ["Anand Kumar", "George Varghese"])
      .order("client_name");
    expect(error).toBeNull();
    expect(data).toEqual([
      {
        client_name: "Anand Kumar",
        financing_type: "loan",
        loan_bank_name: "State Bank of India",
        plant_capacity_kw: 3,
      },
      {
        client_name: "George Varghese",
        financing_type: "self",
        loan_bank_name: null,
        plant_capacity_kw: 5,
      },
    ]);
  });

  it("supports the shared financing filter (?financing=loan)", async () => {
    const svc = serviceClient();
    const { data, count, error } = await svc
      .from("projects_list")
      .select("financing_type", { count: "exact" })
      .eq("financing_type", "loan");
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.financing_type).toBe("loan");
  });
});
