import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  anonClient,
  istToday,
  serviceClient,
  signedInAs,
  USERS,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import type { EngineerTicketRow } from "@/lib/types";
import type { TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";

/**
 * A service engineer works the tickets assigned to them and nothing else
 * (migrations 20261010120100 / 20261010120400):
 *   - reads only their assigned tickets, and the customer's site details only
 *     through engineer_tickets() — never the sales tables, money or incentives;
 *   - may move a ticket to in_progress / completed and change nothing else;
 *   - a ticket can only be assigned to an engineer, and an engineer can never
 *     own (or log) a work order.
 * All of it is enforced by the database, so it holds for any client.
 */
const svc = serviceClient();
const fx = createFixtures(svc);

/** Seeded project P1 (Rahul's client Anand Kumar) — the site for fixture tickets. */
const ANAND_PROJECT = "20000000-0000-0000-0000-000000000001";

/**
 * Exactly the columns engineer_tickets() may expose. `satisfies` keeps this
 * list in lock-step with the app's EngineerTicketRow type.
 */
const ENGINEER_TICKET_COLUMNS = Object.keys({
  id: true,
  ticket_no: true,
  ticket_type: true,
  status: true,
  scheduled_date: true,
  service_date: true,
  nature_of_complaint: true,
  created_at: true,
  project_id: true,
  client_name: true,
  client_phone: true,
  address: true,
  plant_capacity: true,
  consumer_number: true,
  kseb_section: true,
} satisfies Record<keyof EngineerTicketRow, true>).sort();

/** Marks every row this run creates, so a regressed guard cannot leak one. */
const RUN = uniqueTag();
const COMPLAINT = `Fixture ${RUN}: inverter tripping at noon`;

afterAll(async () => {
  await fx.cleanup();
  // Sweep writes that were expected to fail but did not.
  await svc
    .from("service_tickets")
    .delete()
    .eq("nature_of_complaint", COMPLAINT);
  await svc.from("work_orders").delete().like("client_name", `%${RUN}`);
});

async function assignedTicketIds(engineerId: string): Promise<string[]> {
  const rows = must(
    await svc
      .from("service_tickets")
      .select("id")
      .eq("assigned_to", engineerId),
    "assigned tickets",
  );
  return rows.map((r) => r.id).sort();
}

/** A fresh scheduled ticket on Anand's site, assigned to `engineerId`. */
function ticketFor(
  engineerId: string,
  values: Partial<TablesInsert<"service_tickets">> = {},
) {
  return fx.ticket({
    project_id: ANAND_PROJECT,
    assigned_to: engineerId,
    status: "scheduled",
    scheduled_date: "2026-10-01",
    nature_of_complaint: COMPLAINT,
    ...values,
  });
}

async function ticketRow(id: string) {
  return must(
    await svc
      .from("service_tickets")
      .select(
        "status, service_date, assigned_to, action_taken, defects_found, service_charge, scheduled_date, nature_of_complaint",
      )
      .eq("id", id)
      .single(),
    "ticket",
  );
}

describe("a service engineer reading their worklist", () => {
  it("sees exactly the tickets assigned to them", async () => {
    for (const user of [USERS.anil, USERS.vineeth]) {
      const client = await signedInAs(user);
      const seen = must(
        await client.from("service_tickets").select("id"),
        "tickets",
      );
      const expected = await assignedTicketIds(user.id);
      expect(expected.length).toBeGreaterThan(0);
      expect(seen.map((r) => r.id).sort()).toEqual(expected);

      const listed = must(
        await client.from("service_tickets_list").select("id, assignee_name"),
        "service_tickets_list",
      );
      expect(listed.map((r) => r.id).sort()).toEqual(expected);
      // The assignee join resolves through profiles RLS (own row only).
      for (const row of listed) expect(row.assignee_name).toBeTruthy();
    }
  });

  it("gets the site details through engineer_tickets(), and nothing more", async () => {
    const anil = await signedInAs(USERS.anil);
    const rows = must(await anil.rpc("engineer_tickets"), "engineer_tickets");
    expect(rows.map((r) => r.id).sort()).toEqual(
      await assignedTicketIds(USERS.anil.id),
    );

    // No contract value, payments or incentive can ride along.
    for (const row of rows)
      expect(Object.keys(row).sort()).toEqual(ENGINEER_TICKET_COLUMNS);

    const anand = rows.find((r) => r.ticket_no === "BSS-2606-1001");
    expect(anand).toMatchObject({
      project_id: ANAND_PROJECT,
      client_name: "Anand Kumar",
      client_phone: "+91 98470 11111",
      address: "Vytilla, Kochi, Kerala",
      plant_capacity: "3kW",
      consumer_number: "1156789012345",
      kseb_section: "Vytilla",
    });
  });

  it("sees what a custom plan sold where a capacity would be", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: {
        client_name: `Custom Site ${RUN}`,
        plan_type: "custom",
        plant_capacity: "Inverter + panel",
      },
    });
    const ticketId = await ticketFor(USERS.anil.id, { project_id: projectId });

    const anil = await signedInAs(USERS.anil);
    const rows = must(await anil.rpc("engineer_tickets"), "engineer_tickets");
    const site = rows.find((r) => r.id === ticketId);
    expect(site).toMatchObject({
      client_name: `Custom Site ${RUN}`,
      plant_capacity: "Inverter + panel",
    });
    // The shape is unchanged: no plan, kW or money rides along.
    expect(Object.keys(site!).sort()).toEqual(ENGINEER_TICKET_COLUMNS);
  });

  it("can filter, order, paginate and count engineer_tickets() like a view", async () => {
    const anil = await signedInAs(USERS.anil);
    const { count: completed } = await svc
      .from("service_tickets")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", USERS.anil.id)
      .eq("status", "completed");

    const { data, count, error } = await anil
      .rpc("engineer_tickets", {}, { count: "exact" })
      .eq("status", "completed")
      .order("scheduled_date", { ascending: false })
      .range(0, 0);
    expect(error).toBeNull();
    expect(count).toBe(completed);
    expect(completed ?? 0).toBeGreaterThan(1);
    expect(data).toHaveLength(1);
  });

  it("is empty for anyone who holds no tickets", async () => {
    for (const user of [USERS.rahul, USERS.admin]) {
      const client = await signedInAs(user);
      expect(
        must(await client.rpc("engineer_tickets"), "engineer_tickets"),
      ).toEqual([]);
    }
  });

  it("is refused to a signed-out caller", async () => {
    const { error } = await anonClient().rpc("engineer_tickets");
    expect(error?.code).toBe("42501");
  });

  it("cannot read work orders, projects, milestones, payments or incentives", async () => {
    const anil = await signedInAs(USERS.anil);
    const head = { count: "exact", head: true } as const;
    const visible = {
      work_orders: await anil.from("work_orders").select("id", head),
      projects: await anil.from("projects").select("id", head),
      project_milestones: await anil
        .from("project_milestones")
        .select("id", head),
      payments: await anil.from("payments").select("id", head),
      work_orders_list: await anil.from("work_orders_list").select("id", head),
      projects_list: await anil.from("projects_list").select("id", head),
      work_order_coordinators: await anil
        .from("work_order_coordinators")
        .select("work_order_id", head),
      coordinator_incentives: await anil
        .from("coordinator_incentives")
        .select("work_order_id", head),
    };
    const rowsSeen = Object.fromEntries(
      Object.entries(visible).map(([table, r]) => [
        table,
        r.error?.message ?? r.count,
      ]),
    );
    expect(rowsSeen).toEqual({
      work_orders: 0,
      projects: 0,
      project_milestones: 0,
      payments: 0,
      work_orders_list: 0,
      projects_list: 0,
      work_order_coordinators: 0,
      coordinator_incentives: 0,
    });

    const incentives = must(
      await anil.rpc("incentive_summary").single(),
      "incentive_summary",
    );
    expect(incentives).toEqual({
      projects: 0,
      pending_projects: 0,
      total: 0,
      paid: 0,
      pending: 0,
    });
  });

  it("is recognised by the role helpers the policies use", async () => {
    const anil = await signedInAs(USERS.anil);
    expect((await anil.rpc("current_user_role")).data).toBe("service_engineer");
    expect((await anil.rpc("is_service_engineer")).data).toBe(true);
    expect((await anil.rpc("is_admin")).data).toBe(false);

    const rahul = await signedInAs(USERS.rahul);
    expect((await rahul.rpc("is_service_engineer")).data).toBe(false);
  });
});

describe("a service engineer working a ticket", () => {
  it("moves it to in progress, then completed — stamping today's IST date", async () => {
    const id = await ticketFor(USERS.anil.id);
    const anil = await signedInAs(USERS.anil);

    const started = await anil
      .from("service_tickets")
      .update({ status: "in_progress" })
      .eq("id", id)
      .select("status, service_date");
    expect(started.error).toBeNull();
    expect(started.data).toEqual([
      { status: "in_progress", service_date: null },
    ]);

    const done = await anil
      .from("service_tickets")
      .update({ status: "completed" })
      .eq("id", id)
      .select("status, service_date");
    expect(done.error).toBeNull();
    expect(done.data).toEqual([
      { status: "completed", service_date: await istToday() },
    ]);
  });

  it("keeps a service date the office already set", async () => {
    const id = await ticketFor(USERS.anil.id, {
      status: "in_progress",
      service_date: "2026-10-02",
    });
    const anil = await signedInAs(USERS.anil);
    const { error } = await anil
      .from("service_tickets")
      .update({ status: "completed" })
      .eq("id", id);
    expect(error).toBeNull();
    expect((await ticketRow(id)).service_date).toBe("2026-10-02");
  });

  it.each<[string, TablesUpdate<"service_tickets">]>([
    ["the action taken", { action_taken: "Replaced the inverter" }],
    ["the defects found", { defects_found: "None" }],
    ["the charges", { service_charge: 999 }],
    ["the schedule", { scheduled_date: "2026-12-31" }],
    ["the service date", { service_date: "2026-01-01" }],
    ["the complaint", { nature_of_complaint: "Edited" }],
    ["the assignee", { assigned_to: USERS.vineeth.id }],
    [
      "anything alongside the status",
      { status: "completed", action_taken: "Fixed" },
    ],
  ])("cannot change %s", async (_what, patch) => {
    const id = await ticketFor(USERS.anil.id);
    const before = await ticketRow(id);
    const anil = await signedInAs(USERS.anil);

    const { error } = await anil
      .from("service_tickets")
      .update(patch)
      .eq("id", id);
    expect(error?.code).toBe("42501");
    expect(await ticketRow(id)).toEqual(before);
  });

  it.each(["cancelled", "open", "scheduled"] as const)(
    "cannot set the status to %s (cancel or reopen)",
    async (status) => {
      const id = await ticketFor(USERS.anil.id, { status: "in_progress" });
      const anil = await signedInAs(USERS.anil);
      const { error } = await anil
        .from("service_tickets")
        .update({ status })
        .eq("id", id);
      expect(error?.code).toBe("42501");
      expect((await ticketRow(id)).status).toBe("in_progress");
    },
  );

  it("cannot touch a ticket assigned to another engineer", async () => {
    const id = await ticketFor(USERS.vineeth.id);
    const anil = await signedInAs(USERS.anil);
    const { data, error } = await anil
      .from("service_tickets")
      .update({ status: "completed" })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await ticketRow(id)).status).toBe("scheduled");
  });

  it("cannot create or delete tickets", async () => {
    const anil = await signedInAs(USERS.anil);
    const created = await anil.from("service_tickets").insert({
      ticket_type: "adhoc",
      project_id: ANAND_PROJECT,
      assigned_to: USERS.anil.id,
      nature_of_complaint: COMPLAINT,
    });
    expect(created.error?.code).toBe("42501");

    const id = await ticketFor(USERS.anil.id);
    const removed = await anil
      .from("service_tickets")
      .delete()
      .eq("id", id)
      .select("id");
    expect(removed.data ?? []).toEqual([]);
    expect((await ticketRow(id)).status).toBe("scheduled");
  });
});

describe("ticket assignment", () => {
  it.each([
    ["a coordinator", USERS.rahul.id],
    ["an admin", USERS.admin.id],
  ])("refuses a new ticket assigned to %s", async (_who, assignee) => {
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.from("service_tickets").insert({
      ticket_type: "adhoc",
      project_id: ANAND_PROJECT,
      assigned_to: assignee,
      nature_of_complaint: COMPLAINT,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/only be assigned to a service engineer/);
  });

  it("refuses reassigning to a non-engineer, even via the service role", async () => {
    const id = await ticketFor(USERS.anil.id);
    const admin = await signedInAs(USERS.admin);
    const viaAdmin = await admin
      .from("service_tickets")
      .update({ assigned_to: USERS.priya.id })
      .eq("id", id);
    expect(viaAdmin.error?.code).toBe("23514");

    const viaService = await svc
      .from("service_tickets")
      .update({ assigned_to: USERS.priya.id })
      .eq("id", id);
    expect(viaService.error?.code).toBe("23514");
    expect((await ticketRow(id)).assigned_to).toBe(USERS.anil.id);
  });

  it("lets the office reassign between engineers, or unassign", async () => {
    const id = await ticketFor(USERS.anil.id);
    const admin = await signedInAs(USERS.admin);

    const moved = await admin
      .from("service_tickets")
      .update({ assigned_to: USERS.vineeth.id })
      .eq("id", id);
    expect(moved.error).toBeNull();
    expect((await ticketRow(id)).assigned_to).toBe(USERS.vineeth.id);

    const cleared = await admin
      .from("service_tickets")
      .update({ assigned_to: null })
      .eq("id", id);
    expect(cleared.error).toBeNull();
    expect((await ticketRow(id)).assigned_to).toBeNull();
  });
});

describe("work-order ownership", () => {
  let rahulsWorkOrder = "";

  beforeAll(async () => {
    rahulsWorkOrder = await fx.workOrder({
      client_name: `Ownership Fixture ${RUN}`,
    });
  });

  async function workOrdersNamed(name: string) {
    return must(
      await svc.from("work_orders").select("id").eq("client_name", name),
      "lookup",
    );
  }

  it("a service engineer cannot log a work order, for themselves or anyone", async () => {
    const anil = await signedInAs(USERS.anil);
    const name = `Engineer Attempt ${RUN}`;
    const base = {
      client_name: name,
      plant_capacity: "3kW",
      total_cost: 100000,
    };

    const own = await anil
      .from("work_orders")
      .insert({ ...base, coordinator_id: USERS.anil.id });
    expect(own.error?.code).toBe("23514"); // ownership guard fires before RLS
    const forRahul = await anil
      .from("work_orders")
      .insert({ ...base, coordinator_id: USERS.rahul.id });
    expect(forRahul.error?.code).toBe("42501");

    expect(await workOrdersNamed(name)).toEqual([]);
  });

  it("a coordinator logs work orders for themselves only", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const name = `Coordinator Insert ${RUN}`;
    const base = {
      client_name: name,
      plant_capacity: "3kW",
      total_cost: 100000,
    };

    const forPriya = await rahul
      .from("work_orders")
      .insert({ ...base, coordinator_id: USERS.priya.id });
    expect(forPriya.error?.code).toBe("42501");
    expect(await workOrdersNamed(name)).toEqual([]);

    const own = await rahul
      .from("work_orders")
      .insert({ ...base, coordinator_id: USERS.rahul.id })
      .select("id, status")
      .single();
    expect(own.error).toBeNull();
    fx.trackWorkOrder(own.data!.id);
    expect(own.data!.status).toBe("pending");
  });

  it("the office logs a work order on a coordinator's behalf", async () => {
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("work_orders")
      .insert({
        client_name: `Office Insert ${RUN}`,
        plant_capacity: "3kW",
        total_cost: 100000,
        coordinator_id: USERS.priya.id,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    fx.trackWorkOrder(data!.id);
  });

  // guard_work_order_owner only runs when a WORK ORDER changes, so the profile
  // side is guarded too (guard_profile_role): otherwise re-roling an owner to
  // service_engineer would let the "engineer" read those work orders, projects,
  // payments and incentives through the coordinator_id = auth.uid() policies.
  // The Team action refuses it as well, but an admin's own session can PATCH
  // profiles directly — so the database must hold the line.
  it("refuses to make a work-order owner a service engineer", async () => {
    const admin = await signedInAs(USERS.admin);
    try {
      const { error } = await admin
        .from("profiles")
        .update({ role: "service_engineer" })
        .eq("id", USERS.priya.id);
      expect(error?.code).toBe("23514");
    } finally {
      await svc
        .from("profiles")
        .update({ role: "coordinator" })
        .eq("id", USERS.priya.id);
    }
  });

  it("a work order is never owned by a service engineer, even via the service role", async () => {
    const name = `Service Role Engineer Owner ${RUN}`;
    const inserted = await svc.from("work_orders").insert({
      client_name: name,
      plant_capacity: "3kW",
      total_cost: 100000,
      coordinator_id: USERS.anil.id,
    });
    expect(inserted.error?.code).toBe("23514");
    expect(inserted.error?.message).toMatch(
      /owned by a coordinator or office staff/,
    );
    expect(await workOrdersNamed(name)).toEqual([]);

    const reassigned = await svc
      .from("work_orders")
      .update({ coordinator_id: USERS.vineeth.id })
      .eq("id", rahulsWorkOrder);
    expect(reassigned.error?.code).toBe("23514");
    const row = must(
      await svc
        .from("work_orders")
        .select("coordinator_id")
        .eq("id", rahulsWorkOrder)
        .single(),
      "work order",
    );
    expect(row.coordinator_id).toBe(USERS.rahul.id);
  });
});
