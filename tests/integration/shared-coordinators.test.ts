import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { describe, it, expect, afterEach } from "vitest";
import {
  anonClient,
  rolledBack,
  serviceClient,
  signedInAs,
  USERS,
  withDb,
  type SeedUser,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import { MAX_SALE_COORDINATORS } from "@/lib/domain/coordinators";

/**
 * A sale can be shared by several coordinators (migration 20261022120000).
 * `work_order_coordinators` is the single source of truth: membership gives
 * read/edit access to the work order, its project, milestones, payments and
 * tickets, while `work_orders.coordinator_id` is only ever the FIRST member and
 * `projects.coordinator_id` a deprecated copy of it. Each member's incentive is
 * private (coordinator_incentives). All of it is enforced by the database.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;
const ARUN = USERS.arun.id;
const SNEHA = USERS.sneha.id;

// Each test builds the sales it needs; none may leave a partnership behind that
// a later "not a partner" assertion would trip over.
afterEach(() => fx.cleanup());

/** Who is on a sale, first coordinator first. */
async function membersOf(workOrderId: string): Promise<string[]> {
  const rows = must(
    await svc
      .from("work_order_coordinators")
      .select("coordinator_id")
      .eq("work_order_id", workOrderId)
      .order("sort_order"),
    "members",
  );
  return rows.map((r) => r.coordinator_id);
}

async function workOrderRow(id: string) {
  return must(
    await svc
      .from("work_orders")
      .select("coordinator_id, status, address, total_cost")
      .eq("id", id)
      .single(),
    "work order",
  );
}

async function projectCoordinator(projectId: string): Promise<string> {
  return must(
    await svc
      .from("projects")
      .select("coordinator_id")
      .eq("id", projectId)
      .single(),
    "project",
  ).coordinator_id;
}

/** A sale Rahul logged and shares with Priya, with something in every table a member reads. */
async function sharedSale() {
  const sale = await fx.approvedProject({
    workOrder: { client_name: `Shared Fixture ${RUN}` },
    partners: [PRIYA],
  });
  await fx.payment(sale.workOrderId, { amount: 25000 });
  const ticketId = await fx.ticket({
    project_id: sale.projectId,
    assigned_to: null,
  });
  return { ...sale, ticketId };
}

describe("the migrated database", () => {
  it("has every sale on at least one coordinator, in step with its caches", async () => {
    const problems = await withDb(async (db) => {
      const one = async (sql: string) =>
        (await db.query<{ n: number }>(sql)).rows[0].n;
      return {
        withoutMembers: await one(
          `select count(*)::int as n from public.work_orders w
            where not exists (select 1 from public.work_order_coordinators c
                               where c.work_order_id = w.id)`,
        ),
        // work_orders.coordinator_id is the first member (lowest sort_order).
        firstMismatch: await one(
          `select count(*)::int as n from public.work_orders w
            where w.coordinator_id is distinct from public.first_coordinator(w.id)`,
        ),
        // projects.coordinator_id is a copy of the work order's.
        projectMismatch: await one(
          `select count(*)::int as n from public.projects p
             join public.work_orders w on w.id = p.work_order_id
            where p.coordinator_id <> w.coordinator_id`,
        ),
        // Exactly one incentive row per membership, both ways.
        incentiveWithoutMember: await one(
          `select count(*)::int as n from public.coordinator_incentives i
            where not exists (select 1 from public.work_order_coordinators c
                               where c.work_order_id = i.work_order_id
                                 and c.coordinator_id = i.coordinator_id)`,
        ),
        memberWithoutIncentive: await one(
          `select count(*)::int as n from public.work_order_coordinators c
            where not exists (select 1 from public.coordinator_incentives i
                               where i.work_order_id = c.work_order_id
                                 and i.coordinator_id = c.coordinator_id)`,
        ),
        // No engineer is ever a member.
        engineers: await one(
          `select count(*)::int as n from public.work_order_coordinators c
             join public.profiles p on p.id = c.coordinator_id
            where p.role::text not in ('coordinator', 'admin', 'superadmin')`,
        ),
      };
    });
    expect(problems).toEqual({
      withoutMembers: 0,
      firstMismatch: 0,
      projectMismatch: 0,
      incentiveWithoutMember: 0,
      memberWithoutIncentive: 0,
      engineers: 0,
    });
  });

  it("carries the seeded shared sale: Rahul first, Priya second", async () => {
    const wo = must(
      await svc
        .from("work_orders")
        .select("id, coordinator_id")
        .eq("client_name", "Harikrishnan Nair")
        .single(),
      "seeded shared sale",
    );
    expect(wo.coordinator_id).toBe(RAHUL);
    expect(await membersOf(wo.id)).toEqual([RAHUL, PRIYA]);
  });

  it("keeps the code's team size in step with the database's", async () => {
    const limit = must(await svc.rpc("max_sale_coordinators"), "limit");
    expect(limit).toBe(MAX_SALE_COORDINATORS);
  });
});

describe("what a member can read", () => {
  /** Row counts the signed-in user sees for one shared sale, table by table. */
  async function seen(
    client: Awaited<ReturnType<typeof signedInAs>>,
    sale: { workOrderId: string; projectId: string },
  ) {
    const count = async (query: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
      const { data, error } = await query;
      expect(error).toBeNull();
      return (data ?? []).length;
    };
    return {
      work_orders: await count(
        client.from("work_orders").select("id").eq("id", sale.workOrderId),
      ),
      work_orders_list: await count(
        client.from("work_orders_list").select("id").eq("id", sale.workOrderId),
      ),
      projects: await count(
        client.from("projects").select("id").eq("id", sale.projectId),
      ),
      projects_list: await count(
        client.from("projects_list").select("id").eq("id", sale.projectId),
      ),
      project_milestones: await count(
        client
          .from("project_milestones")
          .select("id")
          .eq("project_id", sale.projectId),
      ),
      payments: await count(
        client
          .from("payments")
          .select("id")
          .eq("work_order_id", sale.workOrderId),
      ),
      service_tickets: await count(
        client
          .from("service_tickets")
          .select("id")
          .eq("project_id", sale.projectId),
      ),
      work_order_coordinators: await count(
        client
          .from("work_order_coordinators")
          .select("coordinator_id")
          .eq("work_order_id", sale.workOrderId),
      ),
    };
  }

  const EVERYTHING = {
    work_orders: 1,
    work_orders_list: 1,
    projects: 1,
    projects_list: 1,
    project_milestones: 9,
    payments: 1,
    service_tickets: 1,
    work_order_coordinators: 2,
  };
  const NOTHING = Object.fromEntries(
    Object.keys(EVERYTHING).map((k) => [k, 0]),
  );

  it("is the whole sale for the first coordinator, a partner and the office", async () => {
    const sale = await sharedSale();
    for (const user of [USERS.rahul, USERS.priya, USERS.admin, USERS.superadmin]) {
      expect(await seen(await signedInAs(user), sale), user.email).toEqual(
        EVERYTHING,
      );
    }
  });

  it("is nothing for a coordinator who is not on the sale, an engineer, or a signed-out caller", async () => {
    const sale = await sharedSale();
    for (const user of [USERS.arun, USERS.sneha, USERS.anil, USERS.vineeth]) {
      expect(await seen(await signedInAs(user), sale), user.email).toEqual(
        NOTHING,
      );
    }
    // Signed out: empty results, never an error.
    expect(await seen(anonClient(), sale)).toEqual(NOTHING);
  });

  it("stops the moment the office takes someone off the sale", async () => {
    const sale = await sharedSale();
    const priya = await signedInAs(USERS.priya);
    expect((await seen(priya, sale)).work_orders).toBe(1);

    await fx.team(sale.workOrderId, [RAHUL]);

    expect(await seen(priya, sale)).toEqual(NOTHING);
  });

  it("shows partners each other's profile, and nobody else's", async () => {
    await sharedSale();
    const names = async (user: SeedUser) =>
      must(
        await (await signedInAs(user)).from("profiles").select("id, full_name, phone"),
        "profiles",
      );

    // Priya: herself and the partners she shares a sale with — Rahul, by the
    // seeded sale — but not Arun, Sneha or the office.
    const seenByPriya = await names(USERS.priya);
    expect(seenByPriya.map((p) => p.id).sort()).toEqual([PRIYA, RAHUL].sort());
    expect(seenByPriya.find((p) => p.id === RAHUL)).toMatchObject({
      full_name: "Rahul Menon",
      phone: "+91 98470 10001",
    });

    // Sneha shares nothing with anyone: she sees only herself.
    expect((await names(USERS.sneha)).map((p) => p.id)).toEqual([SNEHA]);
  });
});

describe("what a member can change", () => {
  it("lets a partner edit the details, but not the amounts, status or owner of an approved sale", async () => {
    const { workOrderId } = await sharedSale();
    const priya = await signedInAs(USERS.priya);

    const edited = await priya
      .from("work_orders")
      .update({ address: "Edited by a partner" })
      .eq("id", workOrderId)
      .select("address");
    expect(edited.error).toBeNull();
    expect(edited.data).toEqual([{ address: "Edited by a partner" }]);

    for (const change of [
      { total_cost: 1 },
      { advance_amount: 1 },
    ]) {
      const { error } = await priya
        .from("work_orders")
        .update(change)
        .eq("id", workOrderId);
      expect(error?.code, JSON.stringify(change)).toBe("42501");
      expect(error?.message).toMatch(/only the office can change the amounts/i);
    }

    const status = await priya
      .from("work_orders")
      .update({ status: "rejected" })
      .eq("id", workOrderId);
    expect(status.error?.code).toBe("42501");

    const owner = await priya
      .from("work_orders")
      .update({ coordinator_id: PRIYA })
      .eq("id", workOrderId);
    expect(owner.error?.code).toBe("42501");
    expect(owner.error?.message).toMatch(/only an administrator can reassign/i);

    expect(await workOrderRow(workOrderId)).toMatchObject({
      coordinator_id: RAHUL,
      status: "approved",
      address: "Edited by a partner",
      total_cost: 300000,
    });
  });

  it("lets a partner change the amounts while the sale is still pending", async () => {
    const workOrderId = await fx.workOrder({
      client_name: `Pending Shared ${RUN}`,
      status: "pending",
    });
    await fx.team(workOrderId, [RAHUL, PRIYA]);

    const priya = await signedInAs(USERS.priya);
    const { error } = await priya
      .from("work_orders")
      .update({ total_cost: 310000, advance_amount: 20000 })
      .eq("id", workOrderId);
    expect(error).toBeNull();
    expect(await workOrderRow(workOrderId)).toMatchObject({ total_cost: 310000 });
  });

  it("leaves the project, its milestones, the payments and the tickets to the office — partners included", async () => {
    const sale = await sharedSale();
    for (const user of [USERS.rahul, USERS.priya]) {
      const client = await signedInAs(user);

      const project = await client
        .from("projects")
        .update({ feasibility_date: "2026-10-01" })
        .eq("id", sale.projectId)
        .select("id");
      expect(project.error, user.email).toBeNull();
      expect(project.data, user.email).toEqual([]);

      const milestones = await client
        .from("project_milestones")
        .update({ status: "completed" })
        .eq("project_id", sale.projectId)
        .select("id");
      expect(milestones.error, user.email).toBeNull();
      expect(milestones.data, user.email).toEqual([]);

      const payment = await client.from("payments").insert({
        work_order_id: sale.workOrderId,
        amount: 1,
        paid_on: "2026-10-01",
      });
      expect(payment.error?.code, user.email).toBe("42501");

      const ticket = await client
        .from("service_tickets")
        .update({ status: "completed" })
        .eq("id", sale.ticketId)
        .select("id");
      expect(ticket.error, user.email).toBeNull();
      expect(ticket.data, user.email).toEqual([]);
    }
    const stored = must(
      await svc
        .from("projects")
        .select("feasibility_date")
        .eq("id", sale.projectId)
        .single(),
      "project",
    );
    expect(stored.feasibility_date).toBeNull();
  });

  it("keeps a coordinator who is not on the sale from changing it", async () => {
    const { workOrderId } = await sharedSale();
    const arun = await signedInAs(USERS.arun);
    const { data, error } = await arun
      .from("work_orders")
      .update({ address: "Not mine" })
      .eq("id", workOrderId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await workOrderRow(workOrderId)).address).not.toBe("Not mine");
  });

  it("lets a coordinator log a work order and read it straight back (INSERT … RETURNING)", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const created = await rahul
      .from("work_orders")
      .insert({
        coordinator_id: RAHUL,
        client_name: `Returning Fixture ${RUN}`,
        plant_capacity: "3kW",
        total_cost: 150000,
      })
      .select("id, status, coordinator_id")
      .single();
    expect(created.error).toBeNull();
    fx.trackWorkOrder(created.data!.id);
    expect(created.data).toMatchObject({ status: "pending", coordinator_id: RAHUL });

    // The AFTER INSERT trigger made them the first member, by their own hand.
    const member = must(
      await svc
        .from("work_order_coordinators")
        .select("coordinator_id, sort_order, added_by")
        .eq("work_order_id", created.data!.id)
        .single(),
      "membership",
    );
    expect(member).toEqual({
      coordinator_id: RAHUL,
      sort_order: 1,
      added_by: RAHUL,
    });
    // …and their incentive row is open and empty.
    const incentive = must(
      await svc
        .from("coordinator_incentives")
        .select("amount, paid_on")
        .eq("work_order_id", created.data!.id)
        .single(),
      "incentive row",
    );
    expect(incentive).toEqual({ amount: null, paid_on: null });
  });
});

describe("set_work_order_coordinators()", () => {
  type Change = { coordinator_id: string; change: string };
  const sorted = (changes: Change[] | null) =>
    (changes ?? [])
      .map((c) => `${c.change}:${c.coordinator_id}`)
      .sort();

  it("lets the office add, reorder and remove, with the first coordinator and the project's copy following", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Office Team ${RUN}` },
    });
    const admin = await signedInAs(USERS.admin);
    const set = (ids: string[]) =>
      admin.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: ids,
      });

    // Add.
    const added = await set([RAHUL, PRIYA]);
    expect(added.error).toBeNull();
    expect(sorted(added.data)).toEqual([`added:${PRIYA}`]);
    expect(await membersOf(workOrderId)).toEqual([RAHUL, PRIYA]);

    // Reorder: the first coordinator moves with the list, on the work order and
    // the project's deprecated copy.
    const reordered = await set([PRIYA, RAHUL]);
    expect(reordered.error).toBeNull();
    expect(reordered.data).toEqual([]);
    expect(await membersOf(workOrderId)).toEqual([PRIYA, RAHUL]);
    expect((await workOrderRow(workOrderId)).coordinator_id).toBe(PRIYA);
    expect(await projectCoordinator(projectId)).toBe(PRIYA);

    // Replace one coordinator with another in the same call.
    const swapped = await set([PRIYA, ARUN]);
    expect(swapped.error).toBeNull();
    expect(sorted(swapped.data)).toEqual([`added:${ARUN}`, `removed:${RAHUL}`]);
    expect(await membersOf(workOrderId)).toEqual([PRIYA, ARUN]);

    // Remove the first coordinator: the next one becomes first everywhere.
    const removed = await set([ARUN]);
    expect(removed.error).toBeNull();
    expect(sorted(removed.data)).toEqual([`removed:${PRIYA}`]);
    expect((await workOrderRow(workOrderId)).coordinator_id).toBe(ARUN);
    expect(await projectCoordinator(projectId)).toBe(ARUN);

    // De-duplicates and ignores NULLs: the first occurrence wins.
    const messy = await set([ARUN, RAHUL, ARUN, null as unknown as string]);
    expect(messy.error).toBeNull();
    expect(await membersOf(workOrderId)).toEqual([ARUN, RAHUL]);

    // Opened and closed incentive rows follow membership.
    const incentiveHolders = must(
      await svc
        .from("coordinator_incentives")
        .select("coordinator_id")
        .eq("work_order_id", workOrderId),
      "incentive rows",
    ).map((r) => r.coordinator_id);
    expect(incentiveHolders.sort()).toEqual([ARUN, RAHUL].sort());
  });

  it("is also open to a server context (the service role) as the office", async () => {
    const { workOrderId } = await fx.approvedProject();
    expect(await fx.team(workOrderId, [RAHUL, SNEHA])).toEqual({
      added: [SNEHA],
      removed: [],
    });
  });

  it("lets the first coordinator of a PENDING sale add partners — and only add", async () => {
    const workOrderId = await fx.workOrder({
      client_name: `Pending Team ${RUN}`,
      status: "pending",
    });
    const rahul = await signedInAs(USERS.rahul);
    const set = (ids: string[]) =>
      rahul.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: ids,
      });

    const added = await set([RAHUL, PRIYA]);
    expect(added.error).toBeNull();
    expect(sorted(added.data)).toEqual([`added:${PRIYA}`]);
    expect(await membersOf(workOrderId)).toEqual([RAHUL, PRIYA]);

    // Partners are appended, whatever order was asked for: the first
    // coordinator never moves.
    const appended = await set([ARUN, PRIYA, RAHUL]);
    expect(appended.error).toBeNull();
    expect(sorted(appended.data)).toEqual([`added:${ARUN}`]);
    expect(await membersOf(workOrderId)).toEqual([RAHUL, PRIYA, ARUN]);
    expect((await workOrderRow(workOrderId)).coordinator_id).toBe(RAHUL);

    // Taking anyone off is the office's call.
    const removal = await set([RAHUL, PRIYA]);
    expect(removal.error?.code).toBe("42501");
    expect(removal.error?.message).toMatch(
      /only the office can take a coordinator off/i,
    );
    const emptied = await set([]);
    expect(emptied.error?.code).toBe("42501");
    expect(await membersOf(workOrderId)).toEqual([RAHUL, PRIYA, ARUN]);
  });

  it("lets a coordinator add only other coordinators — an admin or the SuperAdmin is the office's to add", async () => {
    // A partner is not asked, and sharing a sale opens their profile row to the
    // others on it, so a coordinator must not be able to pull the office's or
    // the owner's account onto a sale of their own.
    const workOrderId = await fx.workOrder({
      client_name: `Pending Office Accounts ${RUN}`,
      status: "pending",
    });
    const rahul = await signedInAs(USERS.rahul);
    const set = (ids: string[]) =>
      rahul.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: ids,
      });

    const byAdmin = await set([RAHUL, USERS.admin.id]);
    expect(byAdmin.error?.code).toBe("42501");
    expect(byAdmin.error?.message).toMatch(
      /only the office can add an office account to a sale: BSS Admin$/i,
    );
    const bySuperAdmin = await set([RAHUL, USERS.superadmin.id]);
    expect(bySuperAdmin.error?.code).toBe("42501");
    expect(bySuperAdmin.error?.message).toMatch(
      /only the office can add an office account to a sale: BSS SuperAdmin$/i,
    );

    // All or nothing: the coordinator named in the same call is not added either.
    const mixed = await set([RAHUL, PRIYA, USERS.admin.id, USERS.superadmin.id]);
    expect(mixed.error?.code).toBe("42501");
    expect(mixed.error?.message).toMatch(/BSS Admin, BSS SuperAdmin$/);
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);

    // Another coordinator is still just added.
    const added = await set([RAHUL, PRIYA]);
    expect(added.error).toBeNull();
    expect(sorted(added.data)).toEqual([`added:${PRIYA}`]);

    // The office adds an admin and the SuperAdmin without trouble…
    const office = await signedInAs(USERS.admin);
    const byOffice = await office.rpc("set_work_order_coordinators", {
      p_work_order_id: workOrderId,
      p_coordinator_ids: [RAHUL, PRIYA, USERS.admin.id, USERS.superadmin.id],
    });
    expect(byOffice.error).toBeNull();
    expect(sorted(byOffice.data)).toEqual(
      [`added:${USERS.admin.id}`, `added:${USERS.superadmin.id}`].sort(),
    );

    // …and who is already on the sale is not judged again: the first
    // coordinator can go on adding coordinators next to them.
    const later = await set([RAHUL, PRIYA, USERS.admin.id, USERS.superadmin.id, ARUN]);
    expect(later.error).toBeNull();
    expect(sorted(later.data)).toEqual([`added:${ARUN}`]);
    expect(await membersOf(workOrderId)).toEqual([
      RAHUL,
      PRIYA,
      USERS.admin.id,
      USERS.superadmin.id,
      ARUN,
    ]);
  });

  it("refuses a partner, and a first coordinator once the sale is approved", async () => {
    const pending = await fx.workOrder({
      client_name: `Pending Partner ${RUN}`,
      status: "pending",
    });
    await fx.team(pending, [RAHUL, PRIYA]);
    const priya = await signedInAs(USERS.priya);
    const byPartner = await priya.rpc("set_work_order_coordinators", {
      p_work_order_id: pending,
      p_coordinator_ids: [RAHUL, PRIYA, ARUN],
    });
    expect(byPartner.error?.code).toBe("42501");
    expect(byPartner.error?.message).toMatch(
      /only the office or the coordinator who logged this work order/i,
    );

    const { workOrderId } = await fx.approvedProject();
    const rahul = await signedInAs(USERS.rahul);
    const afterApproval = await rahul.rpc("set_work_order_coordinators", {
      p_work_order_id: workOrderId,
      p_coordinator_ids: [RAHUL, PRIYA],
    });
    expect(afterApproval.error?.code).toBe("42501");
    expect(afterApproval.error?.message).toMatch(
      /only the office can change who shares an approved or rejected/i,
    );
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);
    expect(await membersOf(pending)).toEqual([RAHUL, PRIYA]);
  });

  it("does not tell a stranger the work order exists", async () => {
    const { workOrderId } = await fx.approvedProject();
    for (const user of [USERS.arun, USERS.anil]) {
      const client = await signedInAs(user);
      const { error } = await client.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: [user.id],
      });
      expect(error?.code, user.email).toBe("P0002");
    }
    const missing = await (await signedInAs(USERS.admin)).rpc(
      "set_work_order_coordinators",
      { p_work_order_id: randomUUID(), p_coordinator_ids: [RAHUL] },
    );
    expect(missing.error?.code).toBe("P0002");
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);
  });

  it("is closed to a signed-out caller", async () => {
    const { workOrderId } = await fx.approvedProject();
    const { error } = await anonClient().rpc("set_work_order_coordinators", {
      p_work_order_id: workOrderId,
      p_coordinator_ids: [RAHUL, PRIYA],
    });
    expect(error?.code).toBe("42501");
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);
  });

  it("refuses a service engineer, an unknown account, an empty list and too many people", async () => {
    const { workOrderId } = await fx.approvedProject();
    const admin = await signedInAs(USERS.admin);
    const set = (ids: string[]) =>
      admin.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: ids,
      });

    const engineer = await set([RAHUL, USERS.anil.id]);
    expect(engineer.error?.code).toBe("23514");
    expect(engineer.error?.message).toMatch(
      /only coordinator or office accounts can share a sale: Anil Kumar/i,
    );
    const stranger = await set([RAHUL, randomUUID()]);
    expect(stranger.error?.code).toBe("23514");

    const empty = await set([]);
    expect(empty.error?.code).toBe("22023");
    expect(empty.error?.message).toMatch(/needs at least one coordinator/i);

    // Six accounts can own a sale (the office, the SuperAdmin and four
    // coordinators): one more than the limit.
    const everyone = [
      USERS.admin,
      USERS.superadmin,
      USERS.rahul,
      USERS.priya,
      USERS.arun,
      USERS.sneha,
    ].map((u) => u.id);
    expect(everyone).toHaveLength(MAX_SALE_COORDINATORS + 1);
    const tooMany = await set(everyone);
    expect(tooMany.error?.code).toBe("22023");
    expect(tooMany.error?.message).toMatch(/at most 5 coordinators/i);
    const justEnough = await set(everyone.slice(0, MAX_SALE_COORDINATORS));
    expect(justEnough.error).toBeNull();

    // Every refusal left the team as it was before the last success.
    expect(await membersOf(workOrderId)).toEqual(
      everyone.slice(0, MAX_SALE_COORDINATORS),
    );
  });

  it("will not take someone off while an incentive is set for them", async () => {
    const { workOrderId } = await fx.approvedProject({ partners: [PRIYA] });
    await fx.incentive(workOrderId, PRIYA, { amount: 1500 });
    const admin = await signedInAs(USERS.admin);
    const set = (ids: string[]) =>
      admin.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: ids,
      });

    const refused = await set([RAHUL]);
    expect(refused.error?.code).toBe("23514");
    expect(refused.error?.message).toMatch(
      /Priya Suresh still has an incentive on this sale/,
    );
    expect(await membersOf(workOrderId)).toEqual([RAHUL, PRIYA]);

    // A paid incentive counts too — the money record never vanishes with the member.
    await fx.incentive(workOrderId, PRIYA, { amount: 1500, paid_on: "2026-10-01" });
    expect((await set([RAHUL])).error?.code).toBe("23514");

    // Cleared by the office first, the removal goes through.
    await fx.incentive(workOrderId, PRIYA, { amount: null });
    const removed = await set([RAHUL]);
    expect(removed.error).toBeNull();
    expect(sorted(removed.data)).toEqual([`removed:${PRIYA}`]);
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);
  });

  it("keeps a partner's incentive when the order of the team changes", async () => {
    const { workOrderId } = await fx.approvedProject({ partners: [PRIYA] });
    await fx.incentive(workOrderId, PRIYA, { amount: 2500 });
    await fx.team(workOrderId, [PRIYA, RAHUL]);
    const row = must(
      await svc
        .from("coordinator_incentives")
        .select("amount")
        .eq("work_order_id", workOrderId)
        .eq("coordinator_id", PRIYA)
        .single(),
      "incentive",
    );
    expect(row.amount).toBe(2500);
  });
});

describe("writing around the RPC", () => {
  it("refuses a direct insert, update or delete of memberships — even from the office", async () => {
    const { workOrderId } = await fx.approvedProject();
    for (const user of [USERS.rahul, USERS.admin, USERS.superadmin]) {
      const client = await signedInAs(user);

      const insert = await client.from("work_order_coordinators").insert({
        work_order_id: workOrderId,
        coordinator_id: PRIYA,
        sort_order: 2,
      });
      expect(insert.error?.code, `insert as ${user.email}`).toBe("42501");

      const update = await client
        .from("work_order_coordinators")
        .update({ sort_order: 9 })
        .eq("work_order_id", workOrderId);
      expect(update.error?.code, `update as ${user.email}`).toBe("42501");

      const remove = await client
        .from("work_order_coordinators")
        .delete()
        .eq("work_order_id", workOrderId);
      expect(remove.error?.code, `delete as ${user.email}`).toBe("42501");
    }
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);
  });

  it("refuses an office update of work_orders.coordinator_id that is not the first member", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      partners: [PRIYA],
    });
    const admin = await signedInAs(USERS.admin);

    const { error } = await admin
      .from("work_orders")
      .update({ coordinator_id: ARUN })
      .eq("id", workOrderId);
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/set_work_order_coordinators/);

    // Naming the current first coordinator is a no-op, not an error.
    const same = await admin
      .from("work_orders")
      .update({ coordinator_id: RAHUL })
      .eq("id", workOrderId);
    expect(same.error).toBeNull();

    expect((await workOrderRow(workOrderId)).coordinator_id).toBe(RAHUL);
    expect(await projectCoordinator(projectId)).toBe(RAHUL);
    expect(await membersOf(workOrderId)).toEqual([RAHUL, PRIYA]);
  });

  it("refuses to hand a sale to a service engineer, even as the service role", async () => {
    const { workOrderId } = await fx.approvedProject();
    const reassigned = await svc
      .from("work_orders")
      .update({ coordinator_id: USERS.vineeth.id })
      .eq("id", workOrderId);
    // The owner-role check comes before the first-coordinator check.
    expect(reassigned.error?.code).toBe("23514");
    expect(reassigned.error?.message).toMatch(
      /owned by a coordinator or office staff/,
    );

    // A membership row cannot name one either.
    await withDb(async (db) => {
      await expect(
        db.query(
          `insert into public.work_order_coordinators
             (work_order_id, coordinator_id, sort_order)
           values ($1, $2, 2)`,
          [workOrderId, USERS.vineeth.id],
        ),
      ).rejects.toThrow(/owned by a coordinator or office staff/);
    });
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);
  });

  it("refuses to re-point a membership row", async () => {
    const { workOrderId } = await fx.approvedProject({ partners: [PRIYA] });
    await withDb(async (db) => {
      await expect(
        db.query(
          `update public.work_order_coordinators set coordinator_id = $2
            where work_order_id = $1 and coordinator_id = $3`,
          [workOrderId, ARUN, PRIYA],
        ),
      ).rejects.toThrow(/add or remove a coordinator instead of changing one/i);
    });
    expect(await membersOf(workOrderId)).toEqual([RAHUL, PRIYA]);
  });

  it("refuses a direct change of projects.coordinator_id and coerces one on insert", async () => {
    const { projectId } = await fx.approvedProject({ partners: [PRIYA] });
    const direct = await svc
      .from("projects")
      .update({ coordinator_id: PRIYA })
      .eq("id", projectId);
    expect(direct.error?.code).toBe("23514");
    expect(direct.error?.message).toMatch(/change them on the work order/i);
    expect(await projectCoordinator(projectId)).toBe(RAHUL);

    // A project is always created with its work order's coordinator, whatever
    // the caller says.
    const other = await fx.workOrder({
      client_name: `Coerced Project ${RUN}`,
      coordinator_id: ARUN,
    });
    const inserted = must(
      await svc
        .from("projects")
        .insert({ work_order_id: other, coordinator_id: SNEHA })
        .select("coordinator_id")
        .single(),
      "coerced project",
    );
    expect(inserted.coordinator_id).toBe(ARUN);
  });

  it("refuses to leave a sale without a coordinator, at commit", async () => {
    const { workOrderId } = await fx.approvedProject();
    await withDb(async (db) => {
      await db.query("begin");
      await db.query(
        "delete from public.work_order_coordinators where work_order_id = $1",
        [workOrderId],
      );
      // The check is deferred to the end of the transaction.
      await expect(db.query("commit")).rejects.toThrow(
        /needs at least one coordinator/i,
      );
    });
    expect(await membersOf(workOrderId)).toEqual([RAHUL]);

    // Deleting the work order itself (members cascade with it) is fine.
    const del = await svc.from("work_orders").delete().eq("id", workOrderId);
    expect(del.error).toBeNull();
    expect(await membersOf(workOrderId)).toEqual([]);
  });

  it("lets a sale swap its only coordinator in one transaction", async () => {
    const { workOrderId } = await fx.approvedProject();
    await withDb(async (db) => {
      await db.query("begin");
      await db.query(
        "select * from public.set_work_order_coordinators($1, array[$2]::uuid[])",
        [workOrderId, PRIYA],
      );
      await db.query("commit");
    });
    expect(await membersOf(workOrderId)).toEqual([PRIYA]);
    expect((await workOrderRow(workOrderId)).coordinator_id).toBe(PRIYA);
  });
});

/**
 * The app reads a sale's team, incentives and cancelling profile through
 * PostgREST embeds. Two foreign keys to the same table make an unhinted embed
 * ambiguous (PGRST201), and a direct foreign key from coordinator_incentives to
 * work_orders would turn it into a junction — so every embed names its foreign
 * key, and these are the exact shapes the repositories use.
 */
describe("PostgREST embeds", () => {
  const TEAM = `coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(
    coordinator_id, sort_order, created_at,
    profile:profiles!work_order_coordinators_coordinator_id_fkey(id, full_name),
    incentive:coordinator_incentives(amount, paid_on))`;

  it("read a work order's team in order, each person with their own incentive", async () => {
    const sale = await sharedSale();
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 4000 });
    await fx.incentive(sale.workOrderId, PRIYA, { amount: 2500, paid_on: "2026-10-01" });

    const read = async (client: Awaited<ReturnType<typeof signedInAs>>) =>
      must(
        await client
          .from("work_orders")
          .select(`id, plan_type, projects(id, current_stage, is_completed, cancellation), ${TEAM}`)
          .eq("id", sale.workOrderId)
          .single(),
        "work order with its team",
      );

    const office = await read(await signedInAs(USERS.admin));
    // projects.work_order_id is unique, so the embed is one object, not a list.
    expect(office.projects).toMatchObject({ is_completed: false, cancellation: null });
    const team = [...office.coordinators].sort((a, b) => a.sort_order - b.sort_order);
    expect(
      team.map((m) => [m.profile?.full_name, m.incentive?.amount ?? null]),
    ).toEqual([
      ["Rahul Menon", 4000],
      ["Priya Suresh", 2500],
    ]);

    // A partner sees the whole team, and only their own incentive.
    const asPriya = await read(await signedInAs(USERS.priya));
    const byName = Object.fromEntries(
      asPriya.coordinators.map((m) => [m.profile?.full_name, m.incentive?.amount ?? null]),
    );
    expect(byName).toEqual({ "Rahul Menon": null, "Priya Suresh": 2500 });
  });

  it("read a project's detail with its cancelling profile, and keep the old hinted embeds working", async () => {
    const { workOrderId, projectId } = await fx.approvedProject({
      workOrder: { client_name: `Embeds ${RUN}` },
      partners: [PRIYA],
      project: { cancellation: "cancelled", cancelled_on: "2026-09-20" },
    });
    await svc
      .from("projects")
      .update({ cancellation_remarks: "Embed check" })
      .eq("id", projectId);
    const admin = await signedInAs(USERS.admin);

    const detail = must(
      await admin
        .from("projects")
        .select(
          `id, cancellation,
           cancelled_by_profile:profiles!projects_cancelled_by_fkey(full_name),
           work_order:work_orders!projects_work_order_id_fkey(id, plan_type, ${TEAM})`,
        )
        .eq("id", projectId)
        .single(),
      "project detail",
    );
    expect(detail.cancellation).toBe("cancelled");
    expect(detail.work_order?.coordinators).toHaveLength(2);
    // The service role recorded it, so there is nobody to name.
    expect(detail.cancelled_by_profile).toBeNull();

    // The embeds the build before this release uses are still unambiguous.
    const oldWorkOrder = must(
      await admin
        .from("work_orders")
        .select("id, coordinator:profiles!work_orders_coordinator_id_fkey(full_name), projects(id)")
        .eq("id", workOrderId)
        .single(),
      "old work order embed",
    );
    expect(oldWorkOrder.coordinator).toEqual({ full_name: "Rahul Menon" });
    const oldProject = must(
      await admin
        .from("projects")
        .select("id, coordinator:profiles!projects_coordinator_id_fkey(full_name)")
        .eq("id", projectId)
        .single(),
      "old project embed",
    );
    expect(oldProject.coordinator).toEqual({ full_name: "Rahul Menon" });
  });
});

describe("accounts and roles", () => {
  /** A throwaway coordinator account — only ever inside a rolled-back transaction. */
  async function newAccount(db: pg.Client): Promise<string> {
    const id = randomUUID();
    await db.query(
      `insert into auth.users
         (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
               'authenticated', $2, '{"full_name":"Temp Partner"}', now(), now())`,
      [id, `temp-${RUN}@bsssolar.test`],
    );
    return id;
  }

  it("will not make someone who only shares a sale a service engineer", async () => {
    const { workOrderId } = await fx.approvedProject();
    await rolledBack(async (db) => {
      const id = await newAccount(db);
      await db.query(
        `insert into public.work_order_coordinators (work_order_id, coordinator_id, sort_order)
         values ($1, $2, 2)`,
        [workOrderId, id],
      );
      await expect(
        db.query(
          "update public.profiles set role = 'service_engineer' where id = $1",
          [id],
        ),
      ).rejects.toThrow(/still owns or shares work orders or projects/i);
    });
  });

  it("will not delete an account that still shares a sale", async () => {
    const { workOrderId } = await fx.approvedProject();
    await rolledBack(async (db) => {
      const id = await newAccount(db);
      await db.query(
        `insert into public.work_order_coordinators (work_order_id, coordinator_id, sort_order)
         values ($1, $2, 2)`,
        [workOrderId, id],
      );
      await expect(
        db.query("delete from auth.users where id = $1", [id]),
      ).rejects.toThrow(/work_order_coordinators_coordinator_id_fkey/);
    });
  });

  it("lists who can own a sale: names and roles only, nothing for engineers", async () => {
    const owners = [
      USERS.admin,
      USERS.superadmin,
      USERS.rahul,
      USERS.priya,
      USERS.arun,
      USERS.sneha,
    ];
    for (const user of [USERS.rahul, USERS.admin]) {
      const rows = must(
        await (await signedInAs(user)).rpc("coordinator_directory"),
        "directory",
      );
      expect(rows.map((r) => r.id).sort(), user.email).toEqual(
        owners.map((u) => u.id).sort(),
      );
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(["full_name", "id", "role"]);
      }
    }

    expect(
      must(await (await signedInAs(USERS.anil)).rpc("coordinator_directory"), "engineer"),
    ).toEqual([]);
    // A server context sees everyone who can own a sale.
    const server = must(await svc.rpc("coordinator_directory"), "server");
    expect(server.map((r) => r.id).sort()).toEqual(owners.map((u) => u.id).sort());
    expect(
      (await anonClient().rpc("coordinator_directory")).error?.code,
    ).toBe("42501");
  });

  it("gives the account directory, with e-mails, to the office only", async () => {
    const admin = await signedInAs(USERS.admin);
    const rows = must(await admin.rpc("account_directory"), "directory");
    expect(rows.find((r) => r.id === RAHUL)).toMatchObject({
      full_name: "Rahul Menon",
      email: "coord@bsssolar.test",
      role: "coordinator",
    });
    // Engineers are in it, so an import row can say "that is an engineer".
    expect(rows.find((r) => r.id === USERS.anil.id)).toMatchObject({
      email: "engineer@bsssolar.test",
      role: "service_engineer",
    });

    for (const user of [USERS.rahul, USERS.anil]) {
      const { error } = await (await signedInAs(user)).rpc("account_directory");
      expect(error?.code, user.email).toBe("42501");
    }
    expect((await anonClient().rpc("account_directory")).error?.code).toBe(
      "42501",
    );
    expect(must(await svc.rpc("account_directory"), "server").length).toBe(
      rows.length,
    );
  });
});

describe("the legacy incentive columns (deployed-build compatibility)", () => {
  it("is cleared from projects when the team changes, while the real incentive stays", async () => {
    const { workOrderId, projectId } = await fx.approvedProject();
    const admin = await signedInAs(USERS.admin);

    // The previous build writes the project's own columns; the temporary mirror
    // carries it to the first coordinator's row.
    const legacy = await admin
      .from("projects")
      .update({ coordinator_incentive: 7000, incentive_paid_on: "2026-10-02" })
      .eq("id", projectId);
    expect(legacy.error).toBeNull();
    const row = async () =>
      must(
        await svc
          .from("coordinator_incentives")
          .select("amount, paid_on")
          .eq("work_order_id", workOrderId)
          .eq("coordinator_id", RAHUL)
          .single(),
        "incentive",
      );
    expect(await row()).toEqual({ amount: 7000, paid_on: "2026-10-02" });

    // A partner joins: proj_select is membership-based, so the legacy values
    // must not stay readable on projects…
    await fx.team(workOrderId, [RAHUL, PRIYA]);
    const priya = await signedInAs(USERS.priya);
    const seen = must(
      await priya
        .from("projects")
        .select("coordinator_incentive, incentive_paid_on")
        .eq("id", projectId)
        .single(),
      "partner's view",
    );
    expect(seen).toEqual({ coordinator_incentive: null, incentive_paid_on: null });
    // …but the first coordinator's real incentive row is untouched.
    expect(await row()).toEqual({ amount: 7000, paid_on: "2026-10-02" });

    // The mirror switch is transaction-local: it is off again, so a later
    // legacy write still reaches the first coordinator's row.
    await admin
      .from("projects")
      .update({ coordinator_incentive: 7500, incentive_paid_on: null })
      .eq("id", projectId);
    expect(await row()).toEqual({ amount: 7500, paid_on: null });
  });
});

describe("re-running the sale_coordinators migration", () => {
  const MIGRATION = fileURLToPath(
    new URL(
      "../../supabase/migrations/20261022120000_sale_coordinators.sql",
      import.meta.url,
    ),
  );

  /** The migration as shipped, minus its own BEGIN/COMMIT, with line endings normalised. */
  function migrationBody(): string {
    const sql = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
    const lines = sql.match(/^(begin|commit);$/gm) ?? [];
    expect(lines, "the migration's own transaction lines").toEqual([
      "begin;",
      "commit;",
    ]);
    return sql.replace(/^(begin|commit);$/gm, "");
  }

  it("changes nothing an office already set, and backfills only untouched rows", async () => {
    const { workOrderId: touched, projectId: touchedProject } =
      await fx.approvedProject({ workOrder: { client_name: `Rerun Set ${RUN}` } });
    const { workOrderId: untouched, projectId: untouchedProject } =
      await fx.approvedProject({ workOrder: { client_name: `Rerun Open ${RUN}` } });
    await fx.incentive(touched, RAHUL, { amount: 3000 });

    await rolledBack(async (db) => {
      // As the database looked before the mirror existed: stale legacy values.
      await db.query("select set_config('bss.skip_legacy_mirror', 'on', true)");
      await db.query(
        "update public.projects set coordinator_incentive = 9999 where id = $1",
        [touchedProject],
      );
      await db.query(
        "update public.projects set coordinator_incentive = 1234 where id = $1",
        [untouchedProject],
      );
      await db.query("select set_config('bss.skip_legacy_mirror', 'off', true)");
      const before = await db.query<{ n: number }>(
        "select count(*)::int as n from public.work_order_coordinators",
      );

      await db.query(migrationBody());

      const amounts = await db.query<{ work_order_id: string; amount: string | null }>(
        `select work_order_id, amount::text from public.coordinator_incentives
          where work_order_id = any ($1)`,
        [[touched, untouched]],
      );
      const byWorkOrder = Object.fromEntries(
        amounts.rows.map((r) => [r.work_order_id, r.amount]),
      );
      // The office's own figure survives; the untouched row takes the legacy one.
      expect(byWorkOrder[touched]).toBe("3000.00");
      expect(byWorkOrder[untouched]).toBe("1234.00");

      const after = await db.query<{ n: number }>(
        "select count(*)::int as n from public.work_order_coordinators",
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    // Rolled back: the stored database is exactly as it was.
    const stored = must(
      await svc
        .from("coordinator_incentives")
        .select("work_order_id, amount")
        .in("work_order_id", [touched, untouched]),
      "incentive rows",
    );
    expect(Object.fromEntries(stored.map((r) => [r.work_order_id, r.amount]))).toEqual({
      [touched]: 3000,
      [untouched]: null,
    });
  });
});
