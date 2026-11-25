import { randomUUID } from "node:crypto";
import type pg from "pg";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  anonClient,
  clientAs,
  rolledBack,
  serviceClient,
  signedInAs,
  USERS,
  type Db,
  type SeedUser,
} from "./helpers";
import { createAccounts, createFixtures, must, uniqueTag } from "./fixtures";

/**
 * Who may delete (migration 20261125120000). can_delete() is the one database
 * switch: the SuperAdmin and, for now, the Admin. It gates work orders,
 * projects, payments and profiles, the bulk delete_work_orders() and
 * delete_coordinator_incentive(). People carry their own limits on top: the
 * SuperAdmin's seat is never deletable, nobody deletes themselves, and an
 * Admin deletes coordinators and engineers only — and cannot demote another
 * Admin first, since only the SuperAdmin changes an Admin's role
 * (guard_profile_role). Coordinators and engineers delete none of it.
 *
 * Attempts on seeded accounts run over a direct connection, as the API role,
 * inside a transaction that is always rolled back: a policy that wrongly let
 * one through would otherwise destroy the seed.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const people = createAccounts(svc);
const RUN = uniqueTag();

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

// What these deletes log (deletion-log.test.ts pins that) is removed again at
// the end, by id watermark: the integration files run one after another.
let logWatermark = 0;

beforeAll(async () => {
  const last = must(
    await svc.from("deleted_records").select("id").order("id", { ascending: false }).limit(1),
    "log watermark",
  );
  logWatermark = last[0]?.id ?? 0;
});

afterAll(async () => {
  await fx.cleanup();
  await people.cleanup();
  await svc.from("deleted_records").delete().gt("id", logWatermark);
});

/** Statements from here on run through RLS as this user (as PostgREST does). */
async function actAs(db: pg.Client, userId: string): Promise<void> {
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
}

async function exists(
  table: "work_orders" | "projects" | "payments" | "service_tickets" | "profiles",
  id: string,
): Promise<boolean> {
  const rows = must(await svc.from(table).select("id").eq("id", id), `${table} lookup`);
  return rows.length === 1;
}

async function incentiveRow(workOrderId: string, coordinatorId: string) {
  return must(
    await svc
      .from("coordinator_incentives")
      .select("amount, paid_on")
      .eq("work_order_id", workOrderId)
      .eq("coordinator_id", coordinatorId),
    "incentive",
  );
}

async function instalmentCount(workOrderId: string, coordinatorId: string): Promise<number> {
  return must(
    await svc
      .from("coordinator_incentive_payments")
      .select("id")
      .eq("work_order_id", workOrderId)
      .eq("coordinator_id", coordinatorId),
    "instalments",
  ).length;
}

describe("can_delete()", () => {
  it.each([
    ["the SuperAdmin", USERS.superadmin, true],
    ["an admin", USERS.admin, true],
    ["a coordinator", USERS.rahul, false],
    ["a service engineer", USERS.anil, false],
  ] as const)("is %s → %s", async (_who, user, expected) => {
    const client = await signedInAs(user);
    const { data, error } = await client.rpc("can_delete");
    expect(error).toBeNull();
    expect(data).toBe(expected);
  });

  it("is false for anyone signed out, and for a server context", async () => {
    const anon = await anonClient().rpc("can_delete");
    expect(anon.error).toBeNull();
    expect(anon.data).toBe(false);
    const server = await svc.rpc("can_delete");
    expect(server.data).toBe(false);
  });
});

describe("the office deletes records", () => {
  it.each([
    ["an admin", USERS.admin],
    ["the SuperAdmin", USERS.superadmin],
  ] as const)("%s deletes a work order, a project, a payment and a ticket", async (_who, user) => {
    const client = await signedInAs(user);
    const sale = await fx.approvedProject({ workOrder: { client_name: `Office ${RUN}` } });
    const payment = await fx.payment(sale.workOrderId);
    const ticket = await fx.ticket({ project_id: sale.projectId });

    for (const [table, id] of [
      ["payments", payment],
      ["service_tickets", ticket],
      ["projects", sale.projectId],
      ["work_orders", sale.workOrderId],
    ] as const) {
      const { data, error } = await client.from(table).delete().eq("id", id).select("id");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([{ id }]);
      expect(await exists(table, id), table).toBe(false);
    }
  });
});

describe("coordinators and engineers delete nothing", () => {
  it.each([
    ["a coordinator on the sale", USERS.rahul],
    ["a service engineer holding its ticket", USERS.anil],
  ] as const)("%s", async (_who, user) => {
    const sale = await fx.approvedProject({ workOrder: { client_name: `No Delete ${RUN}` } });
    const payment = await fx.payment(sale.workOrderId);
    const ticket = await fx.ticket({ project_id: sale.projectId, assigned_to: USERS.anil.id });
    const target = await people.account();
    const client = await signedInAs(user);

    for (const [table, id] of [
      ["payments", payment],
      ["service_tickets", ticket],
      ["projects", sale.projectId],
      ["work_orders", sale.workOrderId],
      ["profiles", target.id],
    ] as const) {
      const { data } = await client.from(table).delete().eq("id", id).select("id");
      expect(data ?? [], table).toEqual([]);
      expect(await exists(table, id), table).toBe(true);
    }
  });
});

describe("who may delete whom", () => {
  it("an admin deletes a coordinator or an engineer who owns nothing", async () => {
    const coordinator = await people.account("coordinator");
    const engineer = await people.account("service_engineer");
    const admin = await signedInAs(USERS.admin);
    for (const person of [coordinator, engineer]) {
      const { data, error } = await admin
        .from("profiles")
        .delete()
        .eq("id", person.id)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([{ id: person.id }]);
    }
  });

  it("an admin cannot delete another admin; the SuperAdmin can", async () => {
    const other = await people.account("admin");
    const admin = await signedInAs(USERS.admin);
    const refused = await admin.from("profiles").delete().eq("id", other.id).select("id");
    expect(refused.error).toBeNull();
    expect(refused.data ?? []).toEqual([]);
    expect(await exists("profiles", other.id)).toBe(true);

    const su = await signedInAs(USERS.superadmin);
    const { data, error } = await su.from("profiles").delete().eq("id", other.id).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: other.id }]);
  });

  it("an admin cannot demote another admin to delete them; the SuperAdmin can demote", async () => {
    const other = await people.account("admin");
    const admin = await signedInAs(USERS.admin);

    const demoted = await admin
      .from("profiles")
      .update({ role: "coordinator" })
      .eq("id", other.id)
      .select("id");
    expect(demoted.error?.code).toBe("42501");
    expect(demoted.error?.message).toBe("Only the Super Admin can change an admin's role");
    // To an engineer neither: any change of an admin's role is refused.
    const engineer = await admin
      .from("profiles")
      .update({ role: "service_engineer" })
      .eq("id", other.id);
    expect(engineer.error?.code).toBe("42501");

    // Still an admin, so the delete that would have followed removes nothing.
    const role = must(await svc.from("profiles").select("role").eq("id", other.id), "role");
    expect(role).toEqual([{ role: "admin" }]);
    const deleted = await admin.from("profiles").delete().eq("id", other.id).select("id");
    expect(deleted.error).toBeNull();
    expect(deleted.data ?? []).toEqual([]);
    expect(await exists("profiles", other.id)).toBe(true);

    const su = await signedInAs(USERS.superadmin);
    const down = await su
      .from("profiles")
      .update({ role: "coordinator" })
      .eq("id", other.id)
      .select("role");
    expect(down.error).toBeNull();
    expect(down.data).toEqual([{ role: "coordinator" }]);
  });

  it("an admin cannot change their own role either; promoting a coordinator still works", async () => {
    const self = await people.account("admin");
    const client = await clientAs(self.email, self.password);
    const own = await client
      .from("profiles")
      .update({ role: "coordinator" })
      .eq("id", self.id);
    expect(own.error?.code).toBe("42501");
    expect(own.error?.message).toBe("Only the Super Admin can change an admin's role");
    expect(must(await svc.from("profiles").select("role").eq("id", self.id), "role")).toEqual([
      { role: "admin" },
    ]);

    const coordinator = await people.account("coordinator");
    const up = await client
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", coordinator.id)
      .select("role");
    expect(up.error).toBeNull();
    expect(up.data).toEqual([{ role: "admin" }]);
  });

  it("nobody deletes the SuperAdmin's profile — not an admin, not the SuperAdmin", async () => {
    for (const actor of [USERS.admin, USERS.superadmin]) {
      await rolledBack(async (db) => {
        await actAs(db, actor.id);
        const { rows } = await db.query(
          "delete from public.profiles where id = $1 returning id",
          [USERS.superadmin.id],
        );
        expect(rows, actor.email).toEqual([]);
      });
    }
  });

  it("nobody deletes their own profile", async () => {
    const disposableAdmin = await people.account("admin");
    for (const actor of [USERS.admin.id, USERS.superadmin.id, disposableAdmin.id]) {
      await rolledBack(async (db) => {
        await actAs(db, actor);
        const { rows } = await db.query(
          "delete from public.profiles where id = $1 returning id",
          [actor],
        );
        expect(rows, actor).toEqual([]);
      });
    }
    // The same through the API, for an account a slip could not hurt.
    const self = await clientAs(disposableAdmin.email, disposableAdmin.password);
    const { data } = await self
      .from("profiles")
      .delete()
      .eq("id", disposableAdmin.id)
      .select("id");
    expect(data ?? []).toEqual([]);
    expect(await exists("profiles", disposableAdmin.id)).toBe(true);
  });

  it("an admin cannot delete the seeded admin or SuperAdmin through any filter", async () => {
    await rolledBack(async (db) => {
      await actAs(db, USERS.admin.id);
      const { rows } = await db.query(
        "delete from public.profiles where role::text in ('admin', 'superadmin') returning id",
      );
      expect(rows).toEqual([]);
    });
  });
});

describe("delete_work_orders()", () => {
  async function sales(n: number, label: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const { workOrderId } = await fx.approvedProject({
        workOrder: { client_name: `${label} ${i + 1} ${RUN}` },
      });
      await fx.payment(workOrderId);
      ids.push(workOrderId);
    }
    return ids;
  }

  it("deletes the office's selection in one call and returns what went, with everything attached", async () => {
    const ids = await sales(3, "Bulk");
    const { data: projects } = await svc
      .from("projects")
      .select("id")
      .in("work_order_id", ids);
    expect(projects).toHaveLength(3);
    const admin = await signedInAs(USERS.admin);

    const { data, error } = await admin.rpc("delete_work_orders", { p_ids: ids });
    expect(error).toBeNull();
    expect([...(data ?? [])].sort()).toEqual([...ids].sort());

    for (const table of ["work_orders", "payments", "projects"] as const) {
      const column = table === "work_orders" ? "id" : "work_order_id";
      const { data: left } = await svc.from(table).select("id").in(column, ids);
      expect(left ?? [], table).toEqual([]);
    }
  });

  it("skips ids that are already gone or never existed, and repeats", async () => {
    const [kept] = await sales(1, "Skip");
    const su = await signedInAs(USERS.superadmin);
    const { data, error } = await su.rpc("delete_work_orders", {
      p_ids: [kept, kept, randomUUID()],
    });
    expect(error).toBeNull();
    expect(data).toEqual([kept]);

    const again = await su.rpc("delete_work_orders", { p_ids: [kept] });
    expect(again.error).toBeNull();
    expect(again.data).toEqual([]);

    const none = await su.rpc("delete_work_orders", { p_ids: [] });
    expect(none.error).toBeNull();
    expect(none.data).toEqual([]);
  });

  it.each([
    ["a coordinator on the sales", USERS.rahul],
    ["a service engineer", USERS.anil],
  ] as const)("respects RLS: %s gets {} and nothing goes", async (_who, user: SeedUser) => {
    const ids = await sales(2, "No Bulk");
    const client = await signedInAs(user);
    const { data, error } = await client.rpc("delete_work_orders", { p_ids: ids });
    expect(error).toBeNull();
    expect(data).toEqual([]);
    for (const id of ids) expect(await exists("work_orders", id)).toBe(true);
  });

  it("is refused to anyone signed out", async () => {
    const [id] = await sales(1, "Anon Bulk");
    const { error } = await anonClient().rpc("delete_work_orders", { p_ids: [id] });
    expect(error?.code).toBe("42501");
    expect(await exists("work_orders", id)).toBe(true);
  });

  it("takes at most 500 ids", async () => {
    const [id] = await sales(1, "Cap");
    const admin = await signedInAs(USERS.admin);
    const tooMany = [id, ...Array.from({ length: 500 }, () => randomUUID())];
    const refused = await admin.rpc("delete_work_orders", { p_ids: tooMany });
    expect(refused.error?.code).toBe("22023");
    expect(refused.error?.message).toMatch(/at most 500/i);
    expect(await exists("work_orders", id)).toBe(true);

    const atTheCap = await admin.rpc("delete_work_orders", { p_ids: tooMany.slice(0, 500) });
    expect(atTheCap.error).toBeNull();
    expect(atTheCap.data).toEqual([id]);
  });

  it("is all or nothing: one sale that cannot go keeps every other one", async () => {
    const ids = await sales(3, "Atomic");
    await rolledBack(async (db) => {
      // In this transaction only: the last sale's ledger refuses to be deleted.
      await db.query(`
        create function public.office_deletes_probe() returns trigger language plpgsql as $$
        begin
          if old.work_order_id = '${ids[2]}' then
            raise exception 'probe: this payment stays';
          end if;
          return old;
        end $$;
        create trigger office_deletes_probe before delete on public.payments
          for each row execute function public.office_deletes_probe();
      `);
      await actAs(db, USERS.admin.id);
      await db.query("savepoint attempt");
      await expect(
        db.query("select public.delete_work_orders($1::uuid[])", [ids]),
      ).rejects.toThrow(/probe: this payment stays/);
      await db.query("rollback to savepoint attempt");
      await db.query("reset role");
      const { rows } = await db.query<{ id: string }>(
        "select id from public.work_orders where id = any ($1::uuid[])",
        [ids],
      );
      expect(rows).toHaveLength(3);
    });
  });
});

describe("delete_coordinator_incentive()", () => {
  /** Rahul and Priya share a sale; each has an agreed incentive. */
  async function sharedSale(label: string) {
    const sale = await fx.approvedProject({
      workOrder: { client_name: `${label} ${RUN}` },
      partners: [PRIYA],
    });
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 6000 });
    await fx.incentivePayment(sale.workOrderId, RAHUL, { amount: 2000, paid_on: "2026-10-01" });
    await fx.incentivePayment(sale.workOrderId, RAHUL, { amount: 4000, paid_on: "2026-10-20" });
    await fx.incentive(sale.workOrderId, PRIYA, { amount: 3000 });
    await fx.incentivePayment(sale.workOrderId, PRIYA, { amount: 1000, paid_on: "2026-10-05" });
    return sale;
  }

  it.each([
    ["an admin", USERS.admin],
    ["the SuperAdmin", USERS.superadmin],
  ] as const)(
    "%s removes the agreed amount and every instalment; the membership and the partner's incentive stay",
    async (_who, user) => {
      const { workOrderId } = await sharedSale("Incentive Delete");
      // Settled in full, so it carries a derived paid date too.
      expect(await incentiveRow(workOrderId, RAHUL)).toEqual([
        { amount: 6000, paid_on: "2026-10-20" },
      ]);
      const client = await signedInAs(user);

      const { data, error } = await client.rpc("delete_coordinator_incentive", {
        p_work_order_id: workOrderId,
        p_coordinator_id: RAHUL,
      });
      expect(error).toBeNull();
      expect(data).toBeNull();

      expect(await incentiveRow(workOrderId, RAHUL)).toEqual([{ amount: null, paid_on: null }]);
      expect(await instalmentCount(workOrderId, RAHUL)).toBe(0);
      const members = must(
        await svc
          .from("work_order_coordinators")
          .select("coordinator_id")
          .eq("work_order_id", workOrderId)
          .order("sort_order"),
        "members",
      );
      expect(members.map((m) => m.coordinator_id)).toEqual([RAHUL, PRIYA]);
      // Priya's is untouched.
      expect(await incentiveRow(workOrderId, PRIYA)).toEqual([{ amount: 3000, paid_on: null }]);
      expect(await instalmentCount(workOrderId, PRIYA)).toBe(1);
    },
  );

  it("leaves an incentive that can be agreed and paid again", async () => {
    const { workOrderId } = await sharedSale("Incentive Again");
    const admin = await signedInAs(USERS.admin);
    const deleted = await admin.rpc("delete_coordinator_incentive", {
      p_work_order_id: workOrderId,
      p_coordinator_id: RAHUL,
    });
    expect(deleted.error).toBeNull();
    const set = await admin
      .from("coordinator_incentives")
      .update({ amount: 2500 })
      .eq("work_order_id", workOrderId)
      .eq("coordinator_id", RAHUL)
      .select("amount");
    expect(set.error).toBeNull();
    expect(set.data).toEqual([{ amount: 2500 }]);
    const paid = await admin
      .from("coordinator_incentive_payments")
      .insert({
        work_order_id: workOrderId,
        coordinator_id: RAHUL,
        amount: 2500,
        paid_on: "2026-11-01",
      })
      .select("id");
    expect(paid.error).toBeNull();
    expect(await incentiveRow(workOrderId, RAHUL)).toEqual([
      { amount: 2500, paid_on: "2026-11-01" },
    ]);
  });

  it("clears a zero incentive, and does nothing to one with no amount", async () => {
    const sale = await fx.approvedProject({
      workOrder: { client_name: `Incentive Zero ${RUN}` },
      partners: [PRIYA],
    });
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 0 });
    const admin = await signedInAs(USERS.admin);
    for (const coordinator of [RAHUL, PRIYA]) {
      const { error } = await admin.rpc("delete_coordinator_incentive", {
        p_work_order_id: sale.workOrderId,
        p_coordinator_id: coordinator,
      });
      expect(error, coordinator).toBeNull();
      expect(await incentiveRow(sale.workOrderId, coordinator)).toEqual([
        { amount: null, paid_on: null },
      ]);
    }
  });

  it("explains an incentive that does not exist", async () => {
    const { workOrderId } = await sharedSale("Incentive Missing");
    const admin = await signedInAs(USERS.admin);
    for (const [wo, co] of [
      [randomUUID(), RAHUL],
      [workOrderId, USERS.arun.id],
    ]) {
      const { error } = await admin.rpc("delete_coordinator_incentive", {
        p_work_order_id: wo,
        p_coordinator_id: co,
      });
      expect(error?.code).toBe("P0002");
      expect(error?.message).toBe("That incentive was not found");
    }
  });

  it.each([
    ["the coordinator it belongs to", USERS.rahul],
    ["a partner on the sale", USERS.priya],
    ["a service engineer", USERS.anil],
  ] as const)("is office-only: %s is refused and nothing changes", async (_who, user) => {
    const { workOrderId } = await sharedSale("Incentive Refused");
    const client: Db = await signedInAs(user);
    const { error } = await client.rpc("delete_coordinator_incentive", {
      p_work_order_id: workOrderId,
      p_coordinator_id: RAHUL,
    });
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("Only the office can delete an incentive");
    expect(await incentiveRow(workOrderId, RAHUL)).toEqual([
      { amount: 6000, paid_on: "2026-10-20" },
    ]);
    expect(await instalmentCount(workOrderId, RAHUL)).toBe(2);
  });

  it("is refused to anyone signed out, and to a server context", async () => {
    const { workOrderId } = await sharedSale("Incentive Anon");
    const anon = await anonClient().rpc("delete_coordinator_incentive", {
      p_work_order_id: workOrderId,
      p_coordinator_id: RAHUL,
    });
    expect(anon.error?.code).toBe("42501");
    const server = await svc.rpc("delete_coordinator_incentive", {
      p_work_order_id: workOrderId,
      p_coordinator_id: RAHUL,
    });
    expect(server.error?.code).toBe("42501");
    expect(await instalmentCount(workOrderId, RAHUL)).toBe(2);
  });
});
