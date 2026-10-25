import { randomUUID } from "node:crypto";
import type pg from "pg";
import { describe, it, expect, afterEach } from "vitest";
import {
  istToday,
  rolledBack,
  serviceClient,
  signedInAs,
  USERS,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import { addDays } from "@/lib/domain/dates";
import { KSEB_FEES, feasibilityStatus } from "@/lib/domain/kseb";
import { CANCELLATION_REMARKS_MAX } from "@/lib/domain/cancellation";

/**
 * The office can mark a project cancelled or refunded, with remarks, and
 * reinstate it (migrations 20261022120100 / 20261022120200). The money ledger
 * is never rewritten; the project leaves "payment pending", and its KSEB
 * feasibility clock stops on the day it was cancelled. The same rules exist in
 * `lib/domain/kseb.ts`, so the two are pinned together here.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

afterEach(() => fx.cleanup());

const ADMIN = USERS.admin.id;

/** A project, optionally with the cancellation columns set on insert. */
async function project(
  name: string,
  values: {
    feasibility_date?: string | null;
    completed_at?: string | null;
    cancellation?: "cancelled" | "refunded" | null;
    cancelled_on?: string | null;
    cancellation_remarks?: string | null;
  } = {},
  workOrder: { total_cost?: number; advance_amount?: number } = {},
) {
  const { completed_at, ...rest } = values;
  return fx.approvedProject({
    workOrder: { client_name: `${name} ${RUN}`, ...workOrder },
    project: {
      ...rest,
      ...(completed_at && {
        is_completed: true,
        current_stage: "plant_commissioning",
        completed_at,
      }),
    },
  });
}

async function stored(projectId: string) {
  return must(
    await svc
      .from("projects")
      .select(
        "cancellation, cancelled_on, cancelled_by, cancellation_remarks, feasibility_date",
      )
      .eq("id", projectId)
      .single(),
    "project",
  );
}

async function listRow(projectId: string) {
  return must(
    await svc
      .from("projects_list")
      .select(
        "is_completed, completed_at, feasibility_date, cancellation, cancelled_on, cancellation_remarks, payment_pending, balance_due, feasibility_periods, feasibility_renewals, feasibility_valid_until, feasibility_days_left, feasibility_extension_cost",
      )
      .eq("id", projectId)
      .single(),
    "projects_list",
  );
}

describe("marking a project cancelled or refunded", () => {
  it("is the office's to do, and reversible", async () => {
    const { projectId } = await project("Office Cancels", {
      feasibility_date: "2026-09-01",
    });
    const admin = await signedInAs(USERS.admin);

    const cancelled = await admin
      .from("projects")
      .update({
        cancellation: "cancelled",
        cancelled_on: "2026-09-20",
        cancellation_remarks: "Customer changed their mind",
      })
      .eq("id", projectId)
      .select("id");
    expect(cancelled.error).toBeNull();
    expect(cancelled.data).toHaveLength(1);
    expect(await stored(projectId)).toMatchObject({
      cancellation: "cancelled",
      cancelled_on: "2026-09-20",
      cancelled_by: ADMIN,
      cancellation_remarks: "Customer changed their mind",
    });

    // Cancelled → refunded, with the refund written into the remarks.
    const refunded = await admin
      .from("projects")
      .update({
        cancellation: "refunded",
        cancellation_remarks: "Refunded ₹50,000 by bank transfer on 2026-09-25",
      })
      .eq("id", projectId);
    expect(refunded.error).toBeNull();
    expect(await stored(projectId)).toMatchObject({
      cancellation: "refunded",
      cancelled_on: "2026-09-20",
      cancellation_remarks: "Refunded ₹50,000 by bank transfer on 2026-09-25",
    });

    // Reinstating clears the status, the date and who recorded it, and keeps
    // the remarks as the history note.
    const reinstated = await admin
      .from("projects")
      .update({ cancellation: null, cancelled_on: null })
      .eq("id", projectId);
    expect(reinstated.error).toBeNull();
    expect(await stored(projectId)).toEqual({
      cancellation: null,
      cancelled_on: null,
      cancelled_by: null,
      cancellation_remarks: "Refunded ₹50,000 by bank transfer on 2026-09-25",
      feasibility_date: "2026-09-01",
    });
  });

  it("is not a coordinator's — their update changes nothing", async () => {
    const { projectId } = await project("Coordinator Cancels");
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul
      .from("projects")
      .update({ cancellation: "cancelled", cancelled_on: "2026-09-20" })
      .eq("id", projectId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await stored(projectId)).cancellation).toBeNull();
  });

  it("stays visible to the coordinators of the sale, read-only", async () => {
    const { projectId } = await fx.approvedProject({
      workOrder: { client_name: `Cancelled Visible ${RUN}` },
      partners: [USERS.priya.id],
      project: {
        cancellation: "refunded",
        cancelled_on: "2026-09-20",
        cancellation_remarks: "Refunded in full",
      },
    });
    for (const user of [USERS.rahul, USERS.priya]) {
      const row = must(
        await (await signedInAs(user))
          .from("projects_list")
          .select("cancellation, cancellation_remarks")
          .eq("id", projectId)
          .single(),
        "member's view",
      );
      expect(row, user.email).toEqual({
        cancellation: "refunded",
        cancellation_remarks: "Refunded in full",
      });
    }
  });

  it("is carried by the work orders list too", async () => {
    const { workOrderId } = await project("Cancelled On List", {
      cancellation: "cancelled",
      cancelled_on: "2026-09-20",
    });
    const row = must(
      await svc
        .from("work_orders_list")
        .select("status, cancellation, cancelled_on")
        .eq("id", workOrderId)
        .single(),
      "work_orders_list",
    );
    expect(row).toEqual({
      status: "approved",
      cancellation: "cancelled",
      cancelled_on: "2026-09-20",
    });
  });
});

describe("the three CHECK constraints", () => {
  it("refuse a date without a status", async () => {
    const { projectId } = await project("Check Date");
    const { error } = await svc
      .from("projects")
      .update({ cancelled_on: "2026-09-20" })
      .eq("id", projectId);
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/projects_cancelled_on_needs_cancellation/);
  });

  it("refuse cancelling a project whose feasibility clock runs without saying when it stopped", async () => {
    const running = await project("Check Clock", { feasibility_date: "2026-09-01" });
    const stopped = await svc
      .from("projects")
      .update({ cancellation: "cancelled" })
      .eq("id", running.projectId);
    expect(stopped.error?.code).toBe("23514");
    expect(stopped.error?.message).toMatch(/projects_cancellation_stops_clock/);

    // No clock, no date needed (an import that has none to give).
    const noClock = await project("Check No Clock");
    const ok = await svc
      .from("projects")
      .update({ cancellation: "refunded" })
      .eq("id", noClock.projectId);
    expect(ok.error).toBeNull();
    expect((await stored(noClock.projectId)).cancelled_on).toBeNull();
  });

  it("refuse remarks longer than the limit", async () => {
    const { projectId } = await project("Check Remarks");
    const tooLong = await svc
      .from("projects")
      .update({
        cancellation: "cancelled",
        cancellation_remarks: "x".repeat(CANCELLATION_REMARKS_MAX + 1),
      })
      .eq("id", projectId);
    expect(tooLong.error?.code).toBe("23514");
    expect(tooLong.error?.message).toMatch(/projects_cancellation_remarks_length/);

    const exactly = await svc
      .from("projects")
      .update({
        cancellation: "cancelled",
        cancellation_remarks: "x".repeat(CANCELLATION_REMARKS_MAX),
      })
      .eq("id", projectId);
    expect(exactly.error).toBeNull();
  });
});

describe("cancelled_by", () => {
  it("is the signed-in user who recorded it, never a value from the request", async () => {
    const { projectId } = await project("Stamp");
    const admin = await signedInAs(USERS.admin);

    // A forged value in the same request is replaced by the real actor.
    const first = await admin
      .from("projects")
      .update({
        cancellation: "cancelled",
        cancelled_on: "2026-09-20",
        cancelled_by: USERS.rahul.id,
      })
      .eq("id", projectId);
    expect(first.error).toBeNull();
    expect((await stored(projectId)).cancelled_by).toBe(ADMIN);

    // Editing the remarks keeps who recorded it. Another office user — even
    // one who forges the column in the same request — does not take it over: a
    // forged value is put back, not re-stamped with the editor.
    const other = await signedInAs(USERS.superadmin);
    const edited = await other
      .from("projects")
      .update({
        cancellation_remarks: "Edited later",
        cancelled_by: USERS.priya.id,
      })
      .eq("id", projectId);
    expect(edited.error).toBeNull();
    expect(await stored(projectId)).toMatchObject({
      cancelled_by: ADMIN,
      cancellation_remarks: "Edited later",
    });
    const plain = await other
      .from("projects")
      .update({ cancellation_remarks: "Edited by the SuperAdmin" })
      .eq("id", projectId);
    expect(plain.error).toBeNull();
    expect((await stored(projectId)).cancelled_by).toBe(ADMIN);

    // …but changing the status itself is a new record, by whoever does it.
    await other
      .from("projects")
      .update({ cancellation: "refunded" })
      .eq("id", projectId);
    expect((await stored(projectId)).cancelled_by).toBe(USERS.superadmin.id);

    // Reinstating clears it.
    await other
      .from("projects")
      .update({ cancellation: null, cancelled_on: null })
      .eq("id", projectId);
    expect((await stored(projectId)).cancelled_by).toBeNull();
  });

  it("is empty when the service role records it (there is no signed-in user)", async () => {
    const { projectId } = await project("Stamp Service", {
      cancellation: "cancelled",
      cancelled_on: "2026-09-20",
    });
    expect((await stored(projectId)).cancelled_by).toBeNull();
  });

  it("is left NULL — not given to whoever deletes the account — when its account is deleted", async () => {
    await rolledBack(async (db) => {
      const accountId = await newAdmin(db);
      await setActor(db, accountId);
      // Seeded Anand's project; its clock runs, so it needs a stop date too.
      const projectId = "20000000-0000-0000-0000-000000000001";
      await db.query(
        `update public.projects
            set cancellation = 'cancelled', cancelled_on = current_date
          where id = $1`,
        [projectId],
      );
      const recorded = await db.query<{ cancelled_by: string }>(
        "select cancelled_by from public.projects where id = $1",
        [projectId],
      );
      expect(recorded.rows[0].cancelled_by).toBe(accountId);

      await deleteAccount(db, accountId);

      const { rows } = await db.query<{ cancelled_by: string | null; cancellation: string }>(
        "select cancelled_by, cancellation from public.projects where id = $1",
        [projectId],
      );
      expect(rows).toEqual([{ cancelled_by: null, cancellation: "cancelled" }]);
    });
  });
});

/** A throwaway office account, only ever inside a rolled-back transaction. */
async function newAdmin(db: pg.Client): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
             'authenticated', $2, '{"full_name":"Temp Admin"}', now(), now())`,
    [id, `temp-admin-${RUN}@bsssolar.test`],
  );
  await db.query("update public.profiles set role = 'admin' where id = $1", [id]);
  return id;
}

/** Statements from here on run as this user (auth.uid()), as the table owner. */
async function setActor(db: pg.Client, userId: string | null) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
  ]);
}

/**
 * Deletes the throwaway account while ANOTHER user (the seeded admin) is the
 * current actor, so that a trigger which wrongly re-stamped the row would
 * leave that admin's id behind instead of NULL.
 */
async function deleteAccount(db: pg.Client, id: string) {
  await setActor(db, ADMIN);
  await db.query("delete from auth.users where id = $1", [id]);
}

describe("an incentive's updated_by", () => {
  it("is left NULL, and updated_at untouched, when the account that set it is deleted", async () => {
    await rolledBack(async (db) => {
      const accountId = await newAdmin(db);
      await setActor(db, accountId);
      const where = `work_order_id = '10000000-0000-0000-0000-000000000001'
                 and coordinator_id = '${USERS.rahul.id}'`;
      await db.query(
        `update public.coordinator_incentives set amount = 3100 where ${where}`,
      );
      const set = await db.query<{ updated_by: string }>(
        `select updated_by from public.coordinator_incentives where ${where}`,
      );
      expect(set.rows[0].updated_by).toBe(accountId);

      // Age the stamp (the amount does not change, so nothing re-stamps it).
      await db.query(
        `update public.coordinator_incentives
            set updated_at = '2020-01-01 00:00:00+00' where ${where}`,
      );
      await deleteAccount(db, accountId);

      const { rows } = await db.query<{ updated_by: string | null; updated_at: string; amount: string }>(
        `select updated_by, updated_at::text, amount::text
           from public.coordinator_incentives where ${where}`,
      );
      expect(rows).toEqual([
        { updated_by: null, updated_at: "2020-01-01 00:00:00+00", amount: "3100.00" },
      ]);
    });
  });
});

describe("what a cancelled project does to the money views", () => {
  it("is no longer payment pending, though the ledger and balance are untouched", async () => {
    const { workOrderId, projectId } = await project(
      "Money Views",
      { completed_at: "2026-08-01T10:00:00Z" },
      { total_cost: 300000, advance_amount: 50000 },
    );
    await fx.payment(workOrderId, { amount: 100000 });

    const live = await listRow(projectId);
    expect(live).toMatchObject({ payment_pending: true, balance_due: 150000 });

    const admin = await signedInAs(USERS.admin);
    await admin
      .from("projects")
      .update({ cancellation: "refunded", cancelled_on: "2026-09-01" })
      .eq("id", projectId);

    const refunded = await listRow(projectId);
    expect(refunded).toMatchObject({ payment_pending: false, balance_due: 150000 });
    const ledger = must(
      await svc.from("payments").select("amount").eq("work_order_id", workOrderId),
      "ledger",
    );
    expect(ledger).toEqual([{ amount: 100000 }]);

    // Reinstated: payment pending again.
    await admin
      .from("projects")
      .update({ cancellation: null, cancelled_on: null })
      .eq("id", projectId);
    expect(await listRow(projectId)).toMatchObject({ payment_pending: true });
  });
});

describe("the feasibility clock of a cancelled project", () => {
  /** What the view reports, in the shape the app's rules produce it. */
  async function expectViewMatchesApp(projectId: string, today: string) {
    const row = await listRow(projectId);
    const app = feasibilityStatus({
      feasibilityDate: row.feasibility_date,
      completedAt: row.completed_at,
      isCompleted: row.is_completed,
      cancelledOn: row.cancelled_on,
      isCancelled: row.cancellation !== null,
      today,
    });
    expect({
      periods: row.feasibility_periods,
      renewals: row.feasibility_renewals ?? 0,
      validUntil: row.feasibility_valid_until,
      daysLeft: row.feasibility_days_left,
      extensionCost: Number(row.feasibility_extension_cost),
    }).toEqual({
      periods: app.periods,
      renewals: app.renewals,
      validUntil: app.validUntil,
      daysLeft: app.daysLeft,
      extensionCost: app.extensionCost,
    });
    return { row, app };
  }

  it("stops on the day it was cancelled, and agrees with the app", async () => {
    const today = await istToday();
    // 70 days in; stopped 50 days in → a second period, one renewal — where
    // the open clock would have been on a third, two renewals.
    const { projectId } = await project("Clock Frozen", {
      feasibility_date: addDays(today, -70),
      cancellation: "cancelled",
      cancelled_on: addDays(today, -20),
    });
    const { row, app } = await expectViewMatchesApp(projectId, today);
    expect(row.feasibility_days_left).toBeNull();
    expect(row.feasibility_renewals).toBe(1);
    expect(Number(row.feasibility_extension_cost)).toBe(
      KSEB_FEES.feasibilityRenewalFee,
    );
    expect(app.state).toBe("closed");
  });

  it("stops at the earlier of commissioning and cancellation", async () => {
    const today = await istToday();
    const start = addDays(today, -100);
    // Commissioned on day 40, cancelled on day 90: the clock stopped on day 40.
    const afterHandover = await project("Clock Commissioned First", {
      feasibility_date: start,
      completed_at: `${addDays(start, 40)}T06:30:00Z`,
      cancellation: "refunded",
      cancelled_on: addDays(start, 90),
    });
    const a = await expectViewMatchesApp(afterHandover.projectId, today);
    expect(a.row.feasibility_periods).toBe(2);

    // Cancelled on day 20, commissioned (as recorded) on day 60: day 20 wins.
    const beforeHandover = await project("Clock Cancelled First", {
      feasibility_date: start,
      completed_at: `${addDays(start, 60)}T06:30:00Z`,
      cancellation: "cancelled",
      cancelled_on: addDays(start, 20),
    });
    const b = await expectViewMatchesApp(beforeHandover.projectId, today);
    expect(b.row.feasibility_periods).toBe(1);
    expect(b.row.feasibility_extension_cost).toBe(0);
  });

  it("is not an alert any more, and its renewal cost stays counted", async () => {
    const today = await istToday();
    // Would be on its last day today if it were still running.
    const expiring = await project("Clock Expiring", {
      feasibility_date: addDays(today, -30),
    });
    const before = await listRow(expiring.projectId);
    expect(before.feasibility_days_left).toBe(0);

    const admin = await signedInAs(USERS.admin);
    await admin
      .from("projects")
      .update({ cancellation: "cancelled", cancelled_on: today })
      .eq("id", expiring.projectId);
    const after = await listRow(expiring.projectId);
    expect(after.feasibility_days_left).toBeNull();

    // The dashboard no longer counts it as expiring, but still counts what
    // BSS has paid in renewals on cancelled projects.
    const renewed = await project("Clock Renewed", {
      feasibility_date: addDays(today, -45),
      cancellation: "cancelled",
      cancelled_on: today,
    });
    const metrics = must(
      await admin.rpc("dashboard_metrics").single(),
      "dashboard_metrics",
    );
    const everyone = must(
      await svc.from("projects_list").select("feasibility_extension_cost, feasibility_days_left"),
      "projects_list",
    );
    expect(Number(metrics.feasibility_extension_cost)).toBe(
      everyone.reduce((sum, r) => sum + Number(r.feasibility_extension_cost), 0),
    );
    expect(Number(metrics.feasibility_expiring)).toBe(
      everyone.filter(
        (r) => r.feasibility_days_left !== null && r.feasibility_days_left <= 7,
      ).length,
    );
    expect(
      Number((await listRow(renewed.projectId)).feasibility_extension_cost),
    ).toBe(KSEB_FEES.feasibilityRenewalFee);
  });

  it("restarts on reinstating: renewals are counted to today on the old date, or from a new one", async () => {
    const today = await istToday();
    // Cancelled on day 20 of a feasibility that began 100 days ago.
    const { projectId } = await project("Clock Reinstated", {
      feasibility_date: addDays(today, -100),
      cancellation: "cancelled",
      cancelled_on: addDays(today, -80),
      cancellation_remarks: "Paused by the customer",
    });
    const frozen = await listRow(projectId);
    expect(frozen.feasibility_periods).toBe(1);
    expect(Number(frozen.feasibility_extension_cost)).toBe(0);

    const admin = await signedInAs(USERS.admin);

    // Reinstated on the old date: the cancelled months count as renewals BSS
    // paid — 100 days in is a fourth period, three renewals.
    await admin
      .from("projects")
      .update({ cancellation: null, cancelled_on: null })
      .eq("id", projectId);
    const reopened = await expectViewMatchesApp(projectId, today);
    expect(reopened.row.feasibility_periods).toBe(4);
    expect(Number(reopened.row.feasibility_extension_cost)).toBe(
      3 * KSEB_FEES.feasibilityRenewalFee,
    );
    expect(reopened.row.feasibility_days_left).toBe(20);
    // The remarks stay as the note from the earlier cancellation.
    expect((await stored(projectId)).cancellation_remarks).toBe(
      "Paused by the customer",
    );

    // Cancel again, then reinstate WITH a new feasibility date in the same
    // update: the clock counts from the new date, never from the old one.
    await admin
      .from("projects")
      .update({ cancellation: "cancelled", cancelled_on: addDays(today, -1) })
      .eq("id", projectId);
    await admin
      .from("projects")
      .update({
        cancellation: null,
        cancelled_on: null,
        feasibility_date: addDays(today, -5),
      })
      .eq("id", projectId);
    const fresh = await expectViewMatchesApp(projectId, today);
    expect(fresh.row.feasibility_periods).toBe(1);
    expect(Number(fresh.row.feasibility_extension_cost)).toBe(0);
    expect(fresh.row.feasibility_days_left).toBe(25);
  });

  it("has no clock at all when there is no feasibility date", async () => {
    const today = await istToday();
    const { projectId } = await project("Clock None", {
      cancellation: "refunded",
    });
    const { row } = await expectViewMatchesApp(projectId, today);
    expect(row).toMatchObject({
      feasibility_periods: null,
      feasibility_days_left: null,
      feasibility_extension_cost: 0,
    });
  });
});
