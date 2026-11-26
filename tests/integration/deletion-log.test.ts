import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
} from "./helpers";
import { createAccounts, createFixtures, must, uniqueTag } from "./fixtures";

/**
 * The deletion log (migration 20261125120000): every delete made by a signed-in
 * user lands in deleted_records with a full snapshot of the row, who did it
 * (id and name) and when; a delete and everything that cascaded from it share
 * one tx — for a sale, enough to put it back whole: its project (with the ids
 * of the tickets that were linked to it), milestones, ledger, who shared it and
 * their incentives. Server contexts (service role, SQL by the owner, the wipe
 * and reset scripts) are not logged. Deleters read the log, and
 * recent_deletion_txs() names its latest deletes; nobody writes it through the
 * API.
 *
 * The rows this file logs are removed again at the end (by id watermark; the
 * integration files run one after another).
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const people = createAccounts(svc);
const RUN = uniqueTag();

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

type LogRow = {
  id: number;
  table_name: string;
  record_id: string;
  snapshot: Record<string, unknown>;
  deleted_by: string | null;
  deleted_by_name: string | null;
  deleted_at: string;
  tx: number;
};

let watermark = 0;
const names = new Map<string, string>();

beforeAll(async () => {
  const last = must(
    await svc.from("deleted_records").select("id").order("id", { ascending: false }).limit(1),
    "log watermark",
  );
  watermark = last[0]?.id ?? 0;
  for (const p of must(
    await svc.from("profiles").select("id, full_name").in("id", [USERS.admin.id, USERS.superadmin.id]),
    "office names",
  )) {
    names.set(p.id, p.full_name);
  }
});

afterAll(async () => {
  await fx.cleanup();
  await people.cleanup();
  await svc.from("deleted_records").delete().gt("id", watermark);
});

/** What the log holds for these records (read past RLS), oldest first. */
async function logged(recordIds: readonly string[]): Promise<LogRow[]> {
  return must(
    await svc
      .from("deleted_records")
      .select("*")
      .in("record_id", [...recordIds])
      .gt("id", watermark)
      .order("id"),
    "log",
  ) as LogRow[];
}

const tablesOf = (rows: LogRow[]) => rows.map((r) => r.table_name).sort();

/** The ids of a project's milestones (the 9 KSEB stages it was seeded with). */
async function milestoneIds(projectId: string): Promise<string[]> {
  return must(
    await svc.from("project_milestones").select("id").eq("project_id", projectId),
    "milestones",
  ).map((m) => m.id);
}

describe("a signed-in delete", () => {
  it("is logged with the row, the actor and their name", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { client_name: `Log Payment ${RUN}` },
    });
    const payment = await fx.payment(workOrderId, { amount: 50000, paid_on: "2025-03-03" });
    const admin = await signedInAs(USERS.admin);
    must(await admin.from("payments").delete().eq("id", payment).select("id"), "delete");

    const rows = await logged([payment]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      table_name: "payments",
      record_id: payment,
      deleted_by: USERS.admin.id,
      deleted_by_name: names.get(USERS.admin.id),
    });
    expect(row.snapshot).toMatchObject({
      id: payment,
      work_order_id: workOrderId,
      amount: 50000,
      paid_on: "2025-03-03",
      purpose: "contract",
    });
    expect(Math.abs(Date.parse(row.deleted_at) - Date.now())).toBeLessThan(10 * 60_000);
    expect(row.tx).toBeGreaterThan(0);
  });

  it("logs a whole sale and everything that went with it under one tx", async () => {
    const sale = await fx.approvedProject({
      workOrder: { client_name: `Log Sale ${RUN}`, total_cost: 235000 },
      partners: [PRIYA],
    });
    const payments = [
      await fx.payment(sale.workOrderId, { amount: 20000 }),
      await fx.payment(sale.workOrderId, { amount: 800, purpose: "write_off", notes: "Waived" }),
    ];
    // Rahul's incentive is agreed and part-paid; Priya's has no amount.
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 6000 });
    const instalment = await fx.incentivePayment(sale.workOrderId, RAHUL, {
      amount: 2000,
      paid_on: "2025-03-02",
    });
    const ticket = await fx.ticket({ project_id: sale.projectId });
    const milestones = await milestoneIds(sale.projectId);
    const rahulIncentive = `${sale.workOrderId}:${RAHUL}`;
    const priyaIncentive = `${sale.workOrderId}:${PRIYA}`;

    const su = await signedInAs(USERS.superadmin);
    must(
      await su.from("work_orders").delete().eq("id", sale.workOrderId).select("id"),
      "delete sale",
    );

    const rows = await logged([
      sale.workOrderId,
      sale.projectId,
      ...milestones,
      ...payments,
      instalment,
      rahulIncentive,
      priyaIncentive,
      ticket,
    ]);
    expect(tablesOf(rows)).toEqual(
      [
        "coordinator_incentive_payments",
        "coordinator_incentives",
        "payments",
        "payments",
        "projects",
        ...milestones.map(() => "project_milestones"),
        "work_order_coordinators",
        "work_order_coordinators",
        "work_orders",
      ].sort(),
    );
    expect(milestones).toHaveLength(9);
    // One event: the same transaction, the same actor.
    expect(new Set(rows.map((r) => r.tx)).size).toBe(1);
    for (const row of rows) {
      expect(row.deleted_by, row.table_name).toBe(USERS.superadmin.id);
      expect(row.deleted_by_name, row.table_name).toBe(names.get(USERS.superadmin.id));
    }
    const byTable = Object.fromEntries(rows.map((r) => [r.table_name, r]));
    expect(byTable.work_orders.snapshot).toMatchObject({
      client_name: `Log Sale ${RUN}`,
      total_cost: 235000,
    });
    expect(byTable.projects.snapshot).toMatchObject({ work_order_id: sale.workOrderId });
    // A composite key reads '<work_order_id>:<coordinator_id>'; one with no
    // amount (Priya's) is not logged.
    expect(byTable.coordinator_incentives.record_id).toBe(rahulIncentive);
    expect(byTable.coordinator_incentives.snapshot).toMatchObject({
      work_order_id: sale.workOrderId,
      coordinator_id: RAHUL,
      amount: 6000,
    });
    // Both members, Priya included although she had no incentive amount.
    expect(
      rows
        .filter((r) => r.table_name === "work_order_coordinators")
        .map((r) => [r.record_id, r.snapshot.sort_order]),
    ).toEqual([
      [rahulIncentive, 1],
      [priyaIncentive, 2],
    ]);
    // The ticket stays (it only loses its project), so it is not in the log —
    // but the project's snapshot says it was linked.
    expect(rows.some((r) => r.record_id === ticket)).toBe(false);
    expect(byTable.projects.snapshot.service_ticket_ids).toEqual([ticket]);
  });

  it("keeps what a restore needs: milestone progress, the sale's team and its ticket links", async () => {
    const sale = await fx.approvedProject({
      workOrder: { client_name: `Log Whole ${RUN}` },
      partners: [PRIYA, USERS.arun.id],
    });
    const [first, second] = [await fx.ticket(), await fx.ticket()];
    must(
      await svc
        .from("service_tickets")
        .update({ project_id: sale.projectId })
        .in("id", [first, second])
        .select("id"),
      "link tickets",
    );
    const survey = must(
      await svc
        .from("project_milestones")
        .update({
          status: "completed",
          notes: "Roof measured",
          completed_at: "2025-03-04T05:30:00+00:00",
        })
        .eq("project_id", sale.projectId)
        .eq("stage", "site_feasibility_survey")
        .select("id"),
      "survey done",
    )[0].id;

    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.rpc("delete_work_orders", { p_ids: [sale.workOrderId] });
    expect(error).toBeNull();

    const rows = await logged([
      sale.workOrderId,
      sale.projectId,
      ...[RAHUL, PRIYA, USERS.arun.id].map((c) => `${sale.workOrderId}:${c}`),
      survey,
    ]);
    expect(new Set(rows.map((r) => r.tx)).size).toBe(1);
    const project = rows.find((r) => r.table_name === "projects")!;
    expect([...(project.snapshot.service_ticket_ids as string[])].sort()).toEqual(
      [first, second].sort(),
    );
    // The tickets themselves are kept, unlinked.
    const tickets = must(
      await svc.from("service_tickets").select("project_id").in("id", [first, second]),
      "tickets",
    );
    expect(tickets).toEqual([{ project_id: null }, { project_id: null }]);
    expect(rows.find((r) => r.record_id === survey)?.snapshot).toMatchObject({
      project_id: sale.projectId,
      stage: "site_feasibility_survey",
      status: "completed",
      notes: "Roof measured",
    });
    expect(
      rows
        .filter((r) => r.table_name === "work_order_coordinators")
        .map((r) => [r.snapshot.coordinator_id, r.snapshot.sort_order]),
    ).toEqual([
      [RAHUL, 1],
      [PRIYA, 2],
      [USERS.arun.id, 3],
    ]);
  });

  it("logs a project deleted on its own with its milestones and the tickets it had", async () => {
    const sale = await fx.approvedProject({ workOrder: { client_name: `Log Project ${RUN}` } });
    const ticket = await fx.ticket({ project_id: sale.projectId });
    const milestones = await milestoneIds(sale.projectId);
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("projects")
      .delete()
      .eq("id", sale.projectId)
      .select("id");
    expect(error).toBeNull();
    // Logged BEFORE the delete, and the delete still happens.
    expect(data).toEqual([{ id: sale.projectId }]);
    expect(
      must(await svc.from("projects").select("id").eq("id", sale.projectId), "project"),
    ).toEqual([]);

    const rows = await logged([sale.workOrderId, sale.projectId, ...milestones, ticket]);
    expect(tablesOf(rows)).toEqual(
      ["projects", ...milestones.map(() => "project_milestones")].sort(),
    );
    expect(new Set(rows.map((r) => r.tx)).size).toBe(1);
    expect(rows.find((r) => r.table_name === "projects")?.snapshot).toMatchObject({
      id: sale.projectId,
      work_order_id: sale.workOrderId,
      service_ticket_ids: [ticket],
    });
    for (const row of rows) expect(row.deleted_by, row.table_name).toBe(USERS.admin.id);
  });

  it("lists no tickets for a project that had none", async () => {
    const sale = await fx.approvedProject();
    const admin = await signedInAs(USERS.admin);
    must(await admin.from("projects").delete().eq("id", sale.projectId).select("id"), "delete");
    const [row] = await logged([sale.projectId]);
    expect(row.snapshot.service_ticket_ids).toEqual([]);
  });

  it("a project delete that fails leaves nothing in the log", async () => {
    const sale = await fx.approvedProject();
    await rolledBack(async (db) => {
      // In this transaction only: the project's milestones refuse to go.
      await db.query(`
        create function public.deletion_log_probe() returns trigger language plpgsql as $$
        begin
          raise exception 'probe: this milestone stays';
        end $$;
        create trigger deletion_log_probe before delete on public.project_milestones
          for each row execute function public.deletion_log_probe();
      `);
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USERS.admin.id, role: "authenticated" }),
      ]);
      await db.query("set local role authenticated");
      await db.query("savepoint attempt");
      await expect(
        db.query("delete from public.projects where id = $1", [sale.projectId]),
      ).rejects.toThrow(/probe: this milestone stays/);
      await db.query("rollback to savepoint attempt");
      await db.query("reset role");
      const { rows } = await db.query(
        "select 1 from public.deleted_records where record_id = $1",
        [sale.projectId],
      );
      expect(rows).toEqual([]);
    });
  });

  it("logs a separate delete under a different tx", async () => {
    const { workOrderId } = await fx.approvedProject();
    const first = await fx.payment(workOrderId);
    const second = await fx.payment(workOrderId);
    const admin = await signedInAs(USERS.admin);
    must(await admin.from("payments").delete().eq("id", first).select("id"), "first");
    must(await admin.from("payments").delete().eq("id", second).select("id"), "second");
    const rows = await logged([first, second]);
    expect(rows).toHaveLength(2);
    expect(rows[0].tx).not.toBe(rows[1].tx);
  });

  it("logs a bulk delete of sales as one event", async () => {
    const a = await fx.approvedProject({ workOrder: { client_name: `Log Bulk A ${RUN}` } });
    const b = await fx.approvedProject({ workOrder: { client_name: `Log Bulk B ${RUN}` } });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.rpc("delete_work_orders", {
      p_ids: [a.workOrderId, b.workOrderId],
    });
    expect(error).toBeNull();
    const rows = await logged([a.workOrderId, b.workOrderId, a.projectId, b.projectId]);
    expect(tablesOf(rows)).toEqual(["projects", "projects", "work_orders", "work_orders"]);
    expect(new Set(rows.map((r) => r.tx)).size).toBe(1);
  });

  it("logs a ticket", async () => {
    const ticket = await fx.ticket();
    const admin = await signedInAs(USERS.admin);
    must(await admin.from("service_tickets").delete().eq("id", ticket).select("id"), "delete");
    const [row] = await logged([ticket]);
    expect(row.table_name).toBe("service_tickets");
    expect(row.snapshot).toMatchObject({ id: ticket, ticket_type: "adhoc" });
    expect(String(row.snapshot.ticket_no)).toMatch(/^BSS-/);
  });

  it("logs an incentive deleted from the project page: its instalments and the agreed amount", async () => {
    const sale = await fx.approvedProject({ workOrder: { client_name: `Log Incentive ${RUN}` } });
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 15000 });
    const instalments = [
      await fx.incentivePayment(sale.workOrderId, RAHUL, { amount: 4000, paid_on: "2025-03-02" }),
      await fx.incentivePayment(sale.workOrderId, RAHUL, { amount: 1000, paid_on: "2025-03-09" }),
    ];
    const key = `${sale.workOrderId}:${RAHUL}`;
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.rpc("delete_coordinator_incentive", {
      p_work_order_id: sale.workOrderId,
      p_coordinator_id: RAHUL,
    });
    expect(error).toBeNull();

    const rows = await logged([key, ...instalments]);
    expect(tablesOf(rows)).toEqual([
      "coordinator_incentive_payments",
      "coordinator_incentive_payments",
      "coordinator_incentives",
    ]);
    expect(new Set(rows.map((r) => r.tx)).size).toBe(1);
    const incentive = rows.find((r) => r.table_name === "coordinator_incentives")!;
    expect(incentive.record_id).toBe(key);
    expect(incentive.snapshot).toMatchObject({ coordinator_id: RAHUL, amount: 15000 });
    expect(incentive.deleted_by).toBe(USERS.admin.id);
  });

  it("logs an instalment removed on its own", async () => {
    const sale = await fx.approvedProject();
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 5000 });
    const instalment = await fx.incentivePayment(sale.workOrderId, RAHUL, {
      amount: 4000,
      paid_on: "2025-03-02",
    });
    const admin = await signedInAs(USERS.admin);
    must(
      await admin.from("coordinator_incentive_payments").delete().eq("id", instalment).select("id"),
      "delete",
    );
    const rows = await logged([instalment, `${sale.workOrderId}:${RAHUL}`]);
    expect(tablesOf(rows)).toEqual(["coordinator_incentive_payments"]);
    expect(rows[0].snapshot).toMatchObject({ amount: 4000, paid_on: "2025-03-02" });
  });

  it("logs a team member deleted through the API", async () => {
    const person = await people.account("service_engineer");
    const admin = await signedInAs(USERS.admin);
    must(await admin.from("profiles").delete().eq("id", person.id).select("id"), "delete");
    const [row] = await logged([person.id]);
    expect(row.table_name).toBe("profiles");
    expect(row.snapshot).toMatchObject({
      id: person.id,
      full_name: person.fullName,
      role: "service_engineer",
    });
  });

  it("leaves no noise when a member with no incentive leaves a sale", async () => {
    // Changing who shares a sale that stays is an edit: the membership is
    // logged only when the sale itself goes.
    const sale = await fx.approvedProject({ partners: [PRIYA] });
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin.rpc("set_work_order_coordinators", {
      p_work_order_id: sale.workOrderId,
      p_coordinator_ids: [RAHUL],
    });
    expect(error).toBeNull();
    expect(await logged([`${sale.workOrderId}:${PRIYA}`])).toEqual([]);
  });

  it("keeps the actor's name after the actor's own account is deleted", async () => {
    const actor = await people.account("admin");
    const { workOrderId } = await fx.approvedProject();
    const payment = await fx.payment(workOrderId);
    const client = await clientAs(actor.email, actor.password);
    must(await client.from("payments").delete().eq("id", payment).select("id"), "delete");
    expect((await logged([payment]))[0]).toMatchObject({
      deleted_by: actor.id,
      deleted_by_name: actor.fullName,
    });

    // The team page's path: the auth admin API (service role) — not logged here.
    const { error } = await svc.auth.admin.deleteUser(actor.id);
    expect(error).toBeNull();
    expect((await logged([payment]))[0]).toMatchObject({
      deleted_by: null,
      deleted_by_name: actor.fullName,
    });
    expect(await logged([actor.id])).toEqual([]);
  });
});

describe("server contexts are not logged", () => {
  it("a service-role delete", async () => {
    const { workOrderId, projectId } = await fx.approvedProject();
    const payment = await fx.payment(workOrderId);
    must(await svc.from("work_orders").delete().eq("id", workOrderId).select("id"), "delete");
    expect(await logged([workOrderId, projectId, payment])).toEqual([]);
  });

  it("SQL run by the owner", async () => {
    const { workOrderId } = await fx.approvedProject();
    const payment = await fx.payment(workOrderId);
    await rolledBack(async (db: pg.Client) => {
      await db.query("delete from public.payments where id = $1", [payment]);
      const { rows } = await db.query(
        "select 1 from public.deleted_records where record_id = $1",
        [payment],
      );
      expect(rows).toEqual([]);
    });
  });
});

describe("who reads and writes the log", () => {
  let payment: string;

  beforeAll(async () => {
    const { workOrderId } = await fx.approvedProject();
    payment = await fx.payment(workOrderId);
    const admin = await signedInAs(USERS.admin);
    must(await admin.from("payments").delete().eq("id", payment).select("id"), "delete");
  });

  it.each([
    ["an admin", USERS.admin, 1],
    ["the SuperAdmin", USERS.superadmin, 1],
    ["a coordinator on the sale", USERS.rahul, 0],
    ["a service engineer", USERS.anil, 0],
  ] as const)("%s reads %s row(s)", async (_who, user, expected) => {
    const client = await signedInAs(user);
    const { data, error } = await client
      .from("deleted_records")
      .select("record_id")
      .eq("record_id", payment);
    expect(error).toBeNull();
    expect(data).toHaveLength(expected);
  });

  it("is closed to anyone signed out", async () => {
    const { data, error } = await anonClient()
      .from("deleted_records")
      .select("record_id")
      .eq("record_id", payment);
    expect(error?.code).toBe("42501");
    expect(data ?? []).toEqual([]);
  });

  it.each([
    ["an admin", USERS.admin],
    ["the SuperAdmin", USERS.superadmin],
    ["a coordinator", USERS.rahul],
  ] as const)("cannot be written by %s — no insert, update or delete", async (_who, user) => {
    const client: Db = await signedInAs(user);
    const before = await logged([payment]);
    expect(before).toHaveLength(1);

    const inserted = await client.from("deleted_records").insert({
      table_name: "payments",
      record_id: `forged-${RUN}`,
      snapshot: {},
    });
    expect(inserted.error?.code, "insert").toBe("42501");

    const updated = await client
      .from("deleted_records")
      .update({ deleted_by_name: "Someone else" })
      .eq("record_id", payment);
    expect(updated.error?.code, "update").toBe("42501");

    const removed = await client.from("deleted_records").delete().eq("record_id", payment);
    expect(removed.error?.code, "delete").toBe("42501");

    expect(await logged([payment])).toEqual(before);
    expect(await logged([`forged-${RUN}`])).toEqual([]);
  });
});

describe("recent_deletion_txs()", () => {
  it("names the latest deletes, newest first, one entry for each however many rows it logged", async () => {
    const { workOrderId } = await fx.approvedProject();
    const payment = await fx.payment(workOrderId);
    const sale = await fx.approvedProject({ workOrder: { client_name: `Log Recent ${RUN}` } });
    await fx.payment(sale.workOrderId);
    const admin = await signedInAs(USERS.admin);
    must(await admin.from("payments").delete().eq("id", payment).select("id"), "older delete");
    must(
      await admin.from("work_orders").delete().eq("id", sale.workOrderId).select("id"),
      "newer delete",
    );
    const [older] = await logged([payment]);
    const [newer] = await logged([sale.workOrderId]);

    const { data, error } = await admin.rpc("recent_deletion_txs", { p_limit: 2 });
    expect(error).toBeNull();
    expect(data).toEqual([newer.tx, older.tx]);
  });

  it.each([
    ["a coordinator", USERS.rahul],
    ["a service engineer", USERS.anil],
  ] as const)("follows the log's RLS: %s gets none", async (_who, user) => {
    const office = await signedInAs(USERS.admin);
    const seen = await office.rpc("recent_deletion_txs", { p_limit: 1 });
    expect(seen.data).toHaveLength(1);

    const client = await signedInAs(user);
    const { data, error } = await client.rpc("recent_deletion_txs", { p_limit: 50 });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("is closed to anyone signed out", async () => {
    const { data, error } = await anonClient().rpc("recent_deletion_txs", { p_limit: 50 });
    expect(error?.code).toBe("42501");
    expect(data ?? []).toEqual([]);
  });

  it("orders by the latest row, breaks a tie by id, and keeps the count between 1 and 200", async () => {
    await rolledBack(async (db: pg.Client) => {
      // Deletes "in the future", so they are the newest in the log. Rows are
      // written as the owner, as only the trigger can.
      const log = (tx: number, at: string) =>
        db.query(
          `insert into public.deleted_records (table_name, record_id, snapshot, deleted_at, tx)
           values ('payments', $1, '{}', $2, $3)`,
          [`probe-${tx}-${RUN}`, at, tx],
        );
      const T = 9_000_000_000_000;
      await log(T + 1, "2999-01-01T00:00:00Z"); // a, then b at the same instant
      await log(T + 2, "2999-01-01T00:00:00Z");
      await log(T + 1, "2999-01-01T00:00:00Z"); // a's last row: a is now the latest
      await log(T + 3, "2998-06-01T00:00:00Z"); // c, earlier
      await log(T + 4, "2000-01-01T00:00:00Z"); // d: one old row …
      await log(T + 4, "2999-06-01T00:00:00Z"); // … and its latest, the newest of all
      for (let i = 0; i < 250; i++) await log(T + 100 + i, "2997-01-01T00:00:00Z");

      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USERS.admin.id, role: "authenticated" }),
      ]);
      await db.query("set local role authenticated");
      const recent = async (limit?: number | null) =>
        (
          await db.query<{ tx: string }>(
            limit === undefined
              ? "select public.recent_deletion_txs() as tx"
              : "select public.recent_deletion_txs($1::int) as tx",
            limit === undefined ? [] : [limit],
          )
        ).rows.map((r) => Number(r.tx));

      expect(await recent(4)).toEqual([T + 4, T + 1, T + 2, T + 3]);
      expect(await recent(1000)).toHaveLength(200);
      expect(await recent(0)).toEqual([T + 4]);
      expect(await recent(-5)).toEqual([T + 4]);
      expect(await recent(null)).toHaveLength(50);
      expect(await recent()).toHaveLength(50);
    });
  });
});

describe("the restore recipe in DEPLOY.md", () => {
  /** Step 2 of "Restoring a deleted sale", as documented, minus its own begin/commit. */
  function recipe(tx: string, saleId: string): string {
    const deploy = readFileSync(
      fileURLToPath(new URL("../../DEPLOY.md", import.meta.url)),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const section = deploy.slice(deploy.indexOf("## Restoring a deleted sale"));
    const block = section.match(/\*\*2\. Put it back\*\*[^\n]*\n\n```sql\n([\s\S]*?)\n```/);
    expect(block, "the recipe's SQL block").not.toBeNull();
    const lines = block![1].split("\n");
    expect(lines[0]).toBe("begin;");
    expect(lines[lines.length - 1]).toMatch(/^commit;/);
    const sql = lines
      .slice(1, -1)
      .join("\n")
      .replaceAll("<tx>", tx)
      .replaceAll("<sale id>", saleId);
    expect(sql).not.toMatch(/<[a-z ]+>/);
    return sql;
  }

  /** Everything of a sale that a restore must put back exactly. */
  async function state(db: pg.Client, saleId: string) {
    const { rows } = await db.query<{ v: Record<string, unknown> }>(
      `select jsonb_build_object(
         'work_order', (select to_jsonb(w) from public.work_orders w where w.id = $1),
         'members', (select jsonb_agg(to_jsonb(c) order by c.sort_order)
                       from public.work_order_coordinators c where c.work_order_id = $1),
         'incentives', (select jsonb_agg(jsonb_build_object(
                          'coordinator_id', i.coordinator_id, 'amount', i.amount, 'paid_on', i.paid_on)
                          order by i.coordinator_id)
                          from public.coordinator_incentives i where i.work_order_id = $1),
         'instalments', (select jsonb_agg(to_jsonb(p) order by p.id)
                           from public.coordinator_incentive_payments p where p.work_order_id = $1),
         'payments', (select jsonb_agg(to_jsonb(p) order by p.id)
                        from public.payments p where p.work_order_id = $1),
         -- The two deprecated incentive columns are left out of a restore on purpose.
         'project', (select to_jsonb(p) - 'coordinator_incentive' - 'incentive_paid_on'
                       from public.projects p where p.work_order_id = $1),
         'milestones', (select jsonb_agg(to_jsonb(m) order by m.sort_order)
                          from public.project_milestones m
                          join public.projects p on p.id = m.project_id
                         where p.work_order_id = $1),
         'tickets', (select jsonb_agg(t.id order by t.id)
                       from public.service_tickets t
                       join public.projects p on p.id = t.project_id
                      where p.work_order_id = $1)
       ) as v`,
      [saleId],
    );
    return rows[0].v;
  }

  it("puts a deleted sale back whole: team, milestones, ledger, incentives and ticket links", async () => {
    const ARUN = USERS.arun.id;
    const sale = await fx.approvedProject({
      workOrder: { client_name: `Log Restore ${RUN}`, total_cost: 280000 },
      partners: [PRIYA, ARUN],
    });
    // Deleted in the same bulk call, and must stay deleted.
    const other = await fx.approvedProject({
      workOrder: { client_name: `Log Restore Other ${RUN}` },
    });
    await fx.payment(other.workOrderId, { amount: 1000 });

    await fx.payment(sale.workOrderId, { amount: 50000, paid_on: "2025-03-03" });
    await fx.payment(sale.workOrderId, { amount: 800, purpose: "write_off", notes: "Waived" });
    // Rahul part-paid, Arun paid in full (a derived paid date), Priya with no amount.
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 6000 });
    await fx.incentivePayment(sale.workOrderId, RAHUL, { amount: 2000, paid_on: "2025-03-02" });
    await fx.incentive(sale.workOrderId, ARUN, { amount: 3000 });
    await fx.incentivePayment(sale.workOrderId, ARUN, { amount: 3000, paid_on: "2025-03-05" });
    const tickets = [await fx.ticket(), await fx.ticket()];
    must(
      await svc
        .from("service_tickets")
        .update({ project_id: sale.projectId })
        .in("id", tickets)
        .select("id"),
      "link tickets",
    );
    must(
      await svc
        .from("project_milestones")
        .update({
          status: "completed",
          notes: "Roof measured",
          completed_at: "2025-03-04T05:30:00+00:00",
        })
        .eq("project_id", sale.projectId)
        .eq("stage", "site_feasibility_survey")
        .select("id"),
      "survey done",
    );
    must(
      await svc
        .from("projects")
        .update({ current_stage: "kseb_portal_registration", feasibility_date: "2025-03-06" })
        .eq("id", sale.projectId)
        .select("id"),
      "progress",
    );

    await rolledBack(async (db) => {
      const before = await state(db, sale.workOrderId);
      expect((before.members as unknown[]).length).toBe(3);
      expect((before.tickets as unknown[]).length).toBe(2);

      // The office deletes both sales (as Find duplicates does)…
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USERS.admin.id, role: "authenticated" }),
      ]);
      await db.query("set local role authenticated");
      await db.query("select public.delete_work_orders($1::uuid[])", [
        [sale.workOrderId, other.workOrderId],
      ]);
      // …and the owner restores one in the SQL Editor: postgres, nobody signed in.
      await db.query("reset role");
      await db.query("select set_config('request.jwt.claims', '', true)");
      const { rows } = await db.query<{ tx: string }>(
        "select tx::text from public.deleted_records where table_name = 'work_orders' and record_id = $1",
        [sale.workOrderId],
      );
      expect(rows).toHaveLength(1);
      const logRows = async () => {
        const { rows: n } = await db.query<{ n: string }>(
          "select count(*) as n from public.deleted_records",
        );
        return Number(n[0].n);
      };
      const logged = await logRows();

      await db.query(recipe(rows[0].tx, sale.workOrderId));

      expect(await state(db, sale.workOrderId)).toEqual(before);
      // The other sale of that delete stays deleted, and the restore logged nothing.
      const { rows: others } = await db.query(
        "select 1 from public.work_orders where id = $1",
        [other.workOrderId],
      );
      expect(others).toEqual([]);
      expect(await logRows()).toBe(logged);
    });
  });
});
