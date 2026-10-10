import { describe, it, expect, afterEach } from "vitest";
import { serviceClient, signedInAs, USERS } from "./helpers";
import { createFixtures } from "./fixtures";

/**
 * Coordinators may edit the details of their OWN work orders, and those edits
 * must show up on the linked project — the project reads client/capacity/KSEB/
 * financing data straight off the work order (live joins, nothing denormalised).
 * Collections are the office's: they live in the payments ledger, which the
 * project's balance also reads live — and once an order is approved, so are
 * its advance and total cost, the other two inputs to that balance.
 *
 * The escalation paths stay shut: status and coordinator_id remain admin-only,
 * and another coordinator's rows stay invisible/untouchable.
 */
describe("coordinator work-order editing", () => {
  const svc = serviceClient();
  const fx = createFixtures(svc);
  let workOrderId = "";
  let projectId = "";

  afterEach(() => fx.cleanup());

  async function seedApprovedProject() {
    ({ workOrderId, projectId } = await fx.approvedProject({
      workOrder: {
        client_name: "Edit Flow Client",
        plant_capacity: "3kW",
        total_cost: 200000,
        advance_amount: 20000,
      },
    }));
  }

  /** The office records one collection stage (coordinators cannot). */
  async function recordPayment(amount: number) {
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.from("payments").insert({
      work_order_id: workOrderId,
      amount,
      paid_on: "2026-03-01",
      method: "bank_transfer",
      recorded_by: USERS.admin.id,
    });
    expect(error).toBeNull();
  }

  it("lets the owner edit details, and the project reflects them immediately", async () => {
    await seedApprovedProject();
    const rahul = await signedInAs(USERS.rahul);

    const { error } = await rahul
      .from("work_orders")
      .update({
        client_name: "Edit Flow Client (renamed)",
        plant_capacity: "5kW",
        // The edit form re-sends the amounts; unchanged, they are accepted.
        total_cost: 200000,
        advance_amount: 20000,
        consumer_number: "1156700099999",
        kseb_section: "Kakkanad",
        financing_type: "loan",
        loan_bank_name: "Federal Bank",
        notes: "Customer moved the array to the garage roof.",
      })
      .eq("id", workOrderId);
    expect(error).toBeNull();
    await recordPayment(60000);

    // Read the PROJECT's flattened view — this is what the project pages render.
    const { data: project } = await svc
      .from("projects_list")
      .select(
        "client_name, plant_capacity, plant_capacity_kw, total_cost, consumer_number, kseb_section, financing_type, loan_bank_name, amount_received, balance_due, payment_pending",
      )
      .eq("id", projectId)
      .single();

    expect(project?.client_name).toBe("Edit Flow Client (renamed)");
    expect(project?.plant_capacity).toBe("5kW");
    expect(Number(project?.plant_capacity_kw)).toBe(5);
    expect(Number(project?.total_cost)).toBe(200000);
    expect(project?.consumer_number).toBe("1156700099999");
    expect(project?.kseb_section).toBe("Kakkanad");
    expect(project?.financing_type).toBe("loan");
    expect(project?.loan_bank_name).toBe("Federal Bank");
    // 20000 advance + 60000 first ledger stage
    expect(Number(project?.amount_received)).toBe(80000);
    expect(Number(project?.balance_due)).toBe(120000);
    // Not commissioned yet, so an outstanding balance is not "payment pending".
    expect(project?.payment_pending).toBe(false);
  });

  it.each([
    ["total cost", { total_cost: 150000 }],
    ["advance", { advance_amount: 100000 }],
  ])(
    "refuses the owner changing the %s once the order is approved",
    async (_what, amounts) => {
      await seedApprovedProject();
      const rahul = await signedInAs(USERS.rahul);

      const { error } = await rahul
        .from("work_orders")
        .update({ ...amounts, kseb_section: "Kakkanad" })
        .eq("id", workOrderId);
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/Only the office can change the amounts/);

      // Atomic: nothing in the statement landed, the detail edit included.
      const { data } = await svc
        .from("work_orders")
        .select("total_cost, advance_amount, kseb_section")
        .eq("id", workOrderId)
        .single();
      expect(Number(data?.total_cost)).toBe(200000);
      expect(Number(data?.advance_amount)).toBe(20000);
      expect(data?.kseb_section).toBeNull();
    },
  );

  it("reads a missing advance as ₹0, so re-sending it as 0 is not a change", async () => {
    await seedApprovedProject();
    // A legacy row with no advance (the column allows NULL; the app always
    // writes a number, and so does the edit form when it re-sends the terms).
    const { error: setup } = await svc
      .from("work_orders")
      .update({ advance_amount: null })
      .eq("id", workOrderId);
    expect(setup).toBeNull();

    const rahul = await signedInAs(USERS.rahul);
    const { error } = await rahul
      .from("work_orders")
      .update({ total_cost: 200000, advance_amount: 0, kseb_section: "Kakkanad" })
      .eq("id", workOrderId);
    expect(error).toBeNull();
  });

  it("lets the owner change the amounts while the order is still pending", async () => {
    workOrderId = await fx.workOrder({
      status: "pending",
      total_cost: 200000,
      advance_amount: 20000,
    });
    const rahul = await signedInAs(USERS.rahul);

    const { error } = await rahul
      .from("work_orders")
      .update({ total_cost: 240000, advance_amount: 30000 })
      .eq("id", workOrderId);
    expect(error).toBeNull();

    const { data } = await svc
      .from("work_orders")
      .select("total_cost, advance_amount")
      .eq("id", workOrderId)
      .single();
    expect(Number(data?.total_cost)).toBe(240000);
    expect(Number(data?.advance_amount)).toBe(30000);
  });

  it("lets the office change the amounts of an approved order", async () => {
    await seedApprovedProject();
    const admin = await signedInAs(USERS.admin);

    const { error } = await admin
      .from("work_orders")
      .update({ total_cost: 260000, advance_amount: 25000 })
      .eq("id", workOrderId);
    expect(error).toBeNull();

    const { data } = await svc
      .from("projects_list")
      .select("total_cost, balance_due")
      .eq("id", projectId)
      .single();
    expect(Number(data?.total_cost)).toBe(260000);
    expect(Number(data?.balance_due)).toBe(235000);
  });

  it("flags the project once it is commissioned with a balance left", async () => {
    await seedApprovedProject();
    await recordPayment(100000);

    // Commissioning is an office action.
    const admin = await signedInAs(USERS.admin);
    const done = await admin
      .from("projects")
      .update({ is_completed: true, current_stage: "plant_commissioning" })
      .eq("id", projectId);
    expect(done.error).toBeNull();

    const { data } = await svc
      .from("projects_list")
      .select("balance_due, payment_pending")
      .eq("id", projectId)
      .single();
    expect(Number(data?.balance_due)).toBe(80000); // 200000 - (20000 + 100000)
    expect(data?.payment_pending).toBe(true);

    // Collecting the rest — one more ledger stage — clears the flag.
    await recordPayment(80000);
    const { data: after } = await svc
      .from("projects_list")
      .select("balance_due, payment_pending")
      .eq("id", projectId)
      .single();
    expect(Number(after?.balance_due)).toBe(0);
    expect(after?.payment_pending).toBe(false);
  });

  it("still refuses status and reassignment from a coordinator", async () => {
    await seedApprovedProject();
    const rahul = await signedInAs(USERS.rahul);

    const status = await rahul
      .from("work_orders")
      .update({ status: "rejected", consumer_number: "9999" })
      .eq("id", workOrderId);
    expect(status.error).not.toBeNull();

    const reassign = await rahul
      .from("work_orders")
      .update({ coordinator_id: USERS.priya.id })
      .eq("id", workOrderId);
    expect(reassign.error).not.toBeNull();

    // The rejected statement is atomic — the detail edit did not sneak through.
    const { data } = await svc
      .from("work_orders")
      .select("status, coordinator_id, consumer_number")
      .eq("id", workOrderId)
      .single();
    expect(data?.status).toBe("approved");
    expect(data?.coordinator_id).toBe(USERS.rahul.id);
    expect(data?.consumer_number).toBeNull();
  });

  it("cannot edit another coordinator's work order", async () => {
    await seedApprovedProject();
    const priya = await signedInAs(USERS.priya);

    const { data: affected } = await priya
      .from("work_orders")
      .update({ consumer_number: "hijacked" })
      .eq("id", workOrderId)
      .select("id");
    expect(affected ?? []).toHaveLength(0);

    const { data } = await svc
      .from("work_orders")
      .select("consumer_number")
      .eq("id", workOrderId)
      .single();
    expect(data?.consumer_number).toBeNull();
  });

  it("lets an admin edit any coordinator's work order", async () => {
    await seedApprovedProject();
    const admin = await signedInAs(USERS.admin);

    const { data: affected, error } = await admin
      .from("work_orders")
      .update({ kseb_section: "Ernakulam South" })
      .eq("id", workOrderId)
      .select("id");
    expect(error).toBeNull();
    expect(affected ?? []).toHaveLength(1);
  });
});
