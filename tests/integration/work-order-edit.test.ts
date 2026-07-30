import { describe, it, expect, afterEach } from "vitest";
import { clientAs, serviceClient, USERS } from "./helpers";

/**
 * Coordinators may edit the details of their OWN work orders, and those edits
 * must show up on the linked project — the project reads client/capacity/KSEB/
 * financial data straight off the work order (live joins, nothing denormalised).
 *
 * The escalation paths stay shut: status and coordinator_id remain admin-only,
 * and another coordinator's rows stay invisible/untouchable.
 */
describe("coordinator work-order editing", () => {
  const svc = serviceClient();
  let workOrderId: string | null = null;
  let projectId: string | null = null;

  afterEach(async () => {
    if (workOrderId) {
      await svc.from("work_orders").delete().eq("id", workOrderId);
      workOrderId = null;
      projectId = null;
    }
  });

  async function seedApprovedProject() {
    const wo = await svc
      .from("work_orders")
      .insert({
        coordinator_id: USERS.rahul.id,
        client_name: "Edit Flow Client",
        plant_capacity: "3kW",
        total_cost: 200000,
        advance_amount: 20000,
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
    projectId = pr.data!.id;
  }

  it("lets the owner edit details, and the project reflects them immediately", async () => {
    await seedApprovedProject();
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);

    const { error } = await rahul
      .from("work_orders")
      .update({
        client_name: "Edit Flow Client (renamed)",
        plant_capacity: "5kW",
        total_cost: 260000,
        consumer_number: "1156700099999",
        kseb_section: "Kakkanad",
        loan_bank_name: "Federal Bank",
        notes: "Customer moved the array to the garage roof.",
        first_payment_amount: 60000,
        first_payment_date: "2026-03-01",
      })
      .eq("id", workOrderId!);
    expect(error).toBeNull();

    // Read the PROJECT's flattened view — this is what the project pages render.
    const { data: project } = await svc
      .from("projects_list")
      .select(
        "client_name, plant_capacity, total_cost, consumer_number, kseb_section, loan_bank_name, amount_received, balance_due, payment_pending",
      )
      .eq("id", projectId!)
      .single();

    expect(project?.client_name).toBe("Edit Flow Client (renamed)");
    expect(project?.plant_capacity).toBe("5kW");
    expect(Number(project?.total_cost)).toBe(260000);
    expect(project?.consumer_number).toBe("1156700099999");
    expect(project?.kseb_section).toBe("Kakkanad");
    expect(project?.loan_bank_name).toBe("Federal Bank");
    // 20000 advance + 60000 first instalment
    expect(Number(project?.amount_received)).toBe(80000);
    expect(Number(project?.balance_due)).toBe(180000);
    // Not commissioned yet, so an outstanding balance is not "payment pending".
    expect(project?.payment_pending).toBe(false);
  });

  it("flags the project once it is commissioned with a balance left", async () => {
    await seedApprovedProject();
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);
    await rahul
      .from("work_orders")
      .update({ first_payment_amount: 100000 })
      .eq("id", workOrderId!);

    // Commissioning is an office action.
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);
    const done = await admin
      .from("projects")
      .update({ is_completed: true, current_stage: "plant_commissioning" })
      .eq("id", projectId!);
    expect(done.error).toBeNull();

    const { data } = await svc
      .from("projects_list")
      .select("balance_due, payment_pending")
      .eq("id", projectId!)
      .single();
    expect(Number(data?.balance_due)).toBe(80000); // 200000 - (20000 + 100000)
    expect(data?.payment_pending).toBe(true);

    // Collecting the rest clears the flag with no other change.
    await rahul
      .from("work_orders")
      .update({ second_payment_amount: 80000 })
      .eq("id", workOrderId!);
    const { data: after } = await svc
      .from("projects_list")
      .select("balance_due, payment_pending")
      .eq("id", projectId!)
      .single();
    expect(Number(after?.balance_due)).toBe(0);
    expect(after?.payment_pending).toBe(false);
  });

  it("still refuses status and reassignment from a coordinator", async () => {
    await seedApprovedProject();
    const rahul = await clientAs(USERS.rahul.email, USERS.rahul.password);

    const status = await rahul
      .from("work_orders")
      .update({ status: "rejected", consumer_number: "9999" })
      .eq("id", workOrderId!);
    expect(status.error).not.toBeNull();

    const reassign = await rahul
      .from("work_orders")
      .update({ coordinator_id: USERS.priya.id })
      .eq("id", workOrderId!);
    expect(reassign.error).not.toBeNull();

    // The rejected statement is atomic — the detail edit did not sneak through.
    const { data } = await svc
      .from("work_orders")
      .select("status, coordinator_id, consumer_number")
      .eq("id", workOrderId!)
      .single();
    expect(data?.status).toBe("approved");
    expect(data?.coordinator_id).toBe(USERS.rahul.id);
    expect(data?.consumer_number).toBeNull();
  });

  it("cannot edit another coordinator's work order", async () => {
    await seedApprovedProject();
    const priya = await clientAs(USERS.priya.email, USERS.priya.password);

    const { data: affected } = await priya
      .from("work_orders")
      .update({ consumer_number: "hijacked" })
      .eq("id", workOrderId!)
      .select("id");
    expect(affected ?? []).toHaveLength(0);

    const { data } = await svc
      .from("work_orders")
      .select("consumer_number")
      .eq("id", workOrderId!)
      .single();
    expect(data?.consumer_number).toBeNull();
  });

  it("lets an admin edit any coordinator's work order", async () => {
    await seedApprovedProject();
    const admin = await clientAs(USERS.admin.email, USERS.admin.password);

    const { data: affected, error } = await admin
      .from("work_orders")
      .update({ kseb_section: "Ernakulam South" })
      .eq("id", workOrderId!)
      .select("id");
    expect(error).toBeNull();
    expect(affected ?? []).toHaveLength(1);
  });
});
