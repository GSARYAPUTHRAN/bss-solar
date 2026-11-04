import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import pg from "pg";
import {
  anonClient,
  localDbUrl,
  rolledBack,
  serviceClient,
  signedInAs,
  USERS,
  type Db,
  type SeedUser,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";
import type { TablesUpdate } from "@/lib/supabase/database.types";

/**
 * Incentives are paid in dated instalments (migration 20261104120100):
 * `coordinator_incentives.amount` is the AGREED incentive and
 * `coordinator_incentive_payments` the instalments paid against it, so
 * paid = Σ instalments and pending = amount − paid. The incentive's `paid_on` is
 * DERIVED from them (the date it was settled in full, else NULL), which keeps
 * every older reader working. The office records, corrects and removes
 * instalments; a coordinator reads only their own.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

afterAll(() => fx.cleanup());

type Instalment = { amount: number; paid_on: string; note?: string | null };

/** What the office does on the project page, as the admin (through RLS). */
async function pay(
  workOrderId: string,
  coordinatorId: string,
  ...rows: Instalment[]
) {
  const admin = await signedInAs(USERS.admin);
  for (const row of rows) {
    must(
      await admin
        .from("coordinator_incentive_payments")
        .insert({
          work_order_id: workOrderId,
          coordinator_id: coordinatorId,
          ...row,
        })
        .select("id")
        .single(),
      "instalment",
    );
  }
}

async function incentive(workOrderId: string, coordinatorId: string) {
  return must(
    await svc
      .from("coordinator_incentives")
      .select("amount, paid_on, updated_by")
      .eq("work_order_id", workOrderId)
      .eq("coordinator_id", coordinatorId)
      .single(),
    "incentive row",
  );
}

async function instalments(workOrderId: string, coordinatorId?: string) {
  let query = svc
    .from("coordinator_incentive_payments")
    .select("id, coordinator_id, amount, paid_on, note, recorded_by")
    .eq("work_order_id", workOrderId)
    .order("paid_on")
    .order("amount");
  if (coordinatorId) query = query.eq("coordinator_id", coordinatorId);
  return must(await query, "instalments");
}

/** A sale Rahul and Priya share. */
async function sharedSale(name: string) {
  return fx.approvedProject({
    workOrder: { client_name: `${name} ${RUN}` },
    partners: [PRIYA],
  });
}

describe("an instalment", () => {
  it("is recorded by the office against an agreed amount, who is recorded as having done so", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });

    for (const user of [USERS.admin, USERS.superadmin]) {
      const client = await signedInAs(user);
      const { data, error } = await client
        .from("coordinator_incentive_payments")
        .insert({
          work_order_id: workOrderId,
          coordinator_id: RAHUL,
          amount: 1000,
          paid_on: "2026-10-05",
          note: `by ${user.email}`,
        })
        .select("recorded_by, note")
        .single();
      expect(error, user.email).toBeNull();
      expect(data).toEqual({ recorded_by: user.id, note: `by ${user.email}` });
    }
  });

  it("needs the agreed amount first", async () => {
    const { workOrderId } = await fx.approvedProject();
    const admin = await signedInAs(USERS.admin);
    const { error } = await admin
      .from("coordinator_incentive_payments")
      .insert({
        work_order_id: workOrderId,
        coordinator_id: RAHUL,
        amount: 100,
        paid_on: "2026-10-05",
      });
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/Set the incentive amount first/);
    expect(await instalments(workOrderId)).toEqual([]);
  });

  it("belongs to someone on the sale", async () => {
    const { workOrderId } = await fx.approvedProject();
    const { error } = await svc.from("coordinator_incentive_payments").insert({
      work_order_id: workOrderId,
      coordinator_id: PRIYA,
      amount: 100,
      paid_on: "2026-10-05",
    });
    expect(error?.code).toBe("23503");
  });

  it.each([0, -50])("must be a positive amount (%d is not)", async (amount) => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    const { error } = await svc.from("coordinator_incentive_payments").insert({
      work_order_id: workOrderId,
      coordinator_id: RAHUL,
      amount,
      paid_on: "2026-10-05",
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(
      /coordinator_incentive_payments_amount_positive/,
    );
  });

  it("must say when it was paid", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    const { error } = await svc.from("coordinator_incentive_payments").insert({
      work_order_id: workOrderId,
      coordinator_id: RAHUL,
      amount: 100,
      // @ts-expect-error — paid_on is NOT NULL; the generated Insert type agrees.
      paid_on: null,
    });
    expect(error?.code).toBe("23502");
  });

  it("can never take the instalments past the agreed amount", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 3000, paid_on: "2026-10-01" });

    const admin = await signedInAs(USERS.admin);
    const over = await admin.from("coordinator_incentive_payments").insert({
      work_order_id: workOrderId,
      coordinator_id: RAHUL,
      amount: 2000.01,
      paid_on: "2026-10-02",
    });
    expect(over.error?.code).toBe("23514");
    expect(over.error?.message).toMatch(/Instalments exceed the incentive/);

    // The last rupee is fine: exactly the amount.
    await pay(workOrderId, RAHUL, { amount: 2000, paid_on: "2026-10-02" });
    expect((await instalments(workOrderId)).map((r) => r.amount)).toEqual([
      3000, 2000,
    ]);

    // Correcting an instalment upwards past the cap is refused too, downwards allowed.
    const [first] = await instalments(workOrderId);
    const raise = await admin
      .from("coordinator_incentive_payments")
      .update({ amount: 3000.01 })
      .eq("id", first.id);
    expect(raise.error?.code).toBe("23514");
    const lower = await admin
      .from("coordinator_incentive_payments")
      .update({ amount: 2500 })
      .eq("id", first.id);
    expect(lower.error).toBeNull();
  });

  it("serialises two instalments recorded at once: only one fits under the cap", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    const insert =
      "insert into public.coordinator_incentive_payments (work_order_id, coordinator_id, amount, paid_on) values ($1, $2, 3000, '2026-10-01')";

    const first = new pg.Client({ connectionString: localDbUrl() });
    const second = new pg.Client({ connectionString: localDbUrl() });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await first.query("begin");
      await first.query(insert, [workOrderId, RAHUL]);
      // The second one waits for the first's lock on the incentive…
      const racing = second.query(insert, [workOrderId, RAHUL]).then(
        () => "recorded",
        (error: Error) => error.message,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await first.query("commit");
      // …and then sees it: 3,000 + 3,000 is more than 5,000.
      expect(await racing).toMatch(/Instalments exceed the incentive/);
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
    expect(await instalments(workOrderId)).toHaveLength(1);
  });

  it("is attributed from the session, never from the request", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    const admin = await signedInAs(USERS.admin);

    // recorded_by, created_at and id are not columns a client may write.
    for (const extra of [
      { recorded_by: USERS.rahul.id },
      { created_at: "2020-01-01T00:00:00Z" },
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    ]) {
      const { error } = await admin
        .from("coordinator_incentive_payments")
        .insert({
          work_order_id: workOrderId,
          coordinator_id: RAHUL,
          amount: 100,
          paid_on: "2026-10-05",
          ...extra,
        });
      expect(error?.code, JSON.stringify(extra)).toBe("42501");
    }

    // Nor can an existing one be re-attributed, moved or restamped.
    await pay(workOrderId, RAHUL, { amount: 100, paid_on: "2026-10-05" });
    const [row] = await instalments(workOrderId);
    for (const change of [
      { recorded_by: USERS.rahul.id },
      { coordinator_id: PRIYA },
      { work_order_id: workOrderId },
      { updated_at: "2020-01-01T00:00:00Z" },
    ]) {
      const { error } = await admin
        .from("coordinator_incentive_payments")
        .update(change)
        .eq("id", row.id);
      expect(error?.code, JSON.stringify(change)).toBe("42501");
    }
    expect((await instalments(workOrderId))[0].recorded_by).toBe(
      USERS.admin.id,
    );
  });

  it("cannot be moved to another incentive, even past the column grants", async () => {
    const { workOrderId } = await sharedSale("Instalment Move");
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await fx.incentive(workOrderId, PRIYA, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 100, paid_on: "2026-10-05" });
    const [row] = await instalments(workOrderId);
    const { error } = await svc
      .from("coordinator_incentive_payments")
      .update({ coordinator_id: PRIYA })
      .eq("id", row.id);
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/cannot move to another incentive/);
  });

  it("moves updated_at when corrected", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 100, paid_on: "2026-10-05" });
    const before = must(
      await svc
        .from("coordinator_incentive_payments")
        .select("id, updated_at")
        .eq("work_order_id", workOrderId)
        .single(),
      "before",
    );
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("coordinator_incentive_payments")
      .update({ note: "Corrected" })
      .eq("id", before.id)
      .select("updated_at, note")
      .single();
    expect(error).toBeNull();
    expect(data?.note).toBe("Corrected");
    expect(Date.parse(data!.updated_at)).toBeGreaterThan(
      Date.parse(before.updated_at),
    );
  });
});

describe("an instalment's recorded_by", () => {
  it("is left NULL — and nothing else about the payment changes — when the account that recorded it is deleted", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 3000 });
    await rolledBack(async (db) => {
      const account = randomUUID();
      await db.query(
        `insert into auth.users
           (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
                 'authenticated', $2, '{"full_name":"Temp Admin"}', now(), now())`,
        [account, `temp-recorder-${RUN}@bsssolar.test`],
      );
      await db.query(
        "update public.profiles set role = 'admin' where id = $1",
        [account],
      );
      const actAs = (id: string) =>
        db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: id, role: "authenticated" }),
        ]);

      await actAs(account);
      await db.query(
        `insert into public.coordinator_incentive_payments (work_order_id, coordinator_id, amount, paid_on)
         values ($1, $2, 3000, '2026-10-01')`,
        [workOrderId, RAHUL],
      );
      const read = async () =>
        (
          await db.query(
            `select p.recorded_by, p.amount::float8 as amount, p.paid_on::text as paid_on,
                    i.paid_on::text as settled_on, i.updated_by
               from public.coordinator_incentive_payments p
               join public.coordinator_incentives i
                 on i.work_order_id = p.work_order_id and i.coordinator_id = p.coordinator_id
              where p.work_order_id = $1`,
            [workOrderId],
          )
        ).rows[0];
      expect(await read()).toMatchObject({
        recorded_by: account,
        updated_by: account,
      });

      // Deleted while somebody else is the current actor: a trigger that
      // re-attributed the row would leave that person's id behind.
      await actAs(USERS.admin.id);
      await db.query("delete from auth.users where id = $1", [account]);
      expect(await read()).toEqual({
        recorded_by: null,
        amount: 3000,
        paid_on: "2026-10-01",
        settled_on: "2026-10-01",
        updated_by: null,
      });
    });
  });
});

describe("the incentive's paid date follows its instalments", () => {
  it("is empty while any of it is unpaid, and the date of the last instalment once it is settled", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 24720 });

    // The sheet's example: 20000 + 2360 + 2360 on three dates.
    await pay(workOrderId, RAHUL, { amount: 20000, paid_on: "2025-05-15" });
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBeNull();
    await pay(workOrderId, RAHUL, { amount: 2360, paid_on: "2025-05-16" });
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBeNull();
    await pay(workOrderId, RAHUL, { amount: 2360, paid_on: "2025-05-21" });
    expect(await incentive(workOrderId, RAHUL)).toMatchObject({
      amount: 24720,
      paid_on: "2025-05-21",
    });
  });

  it("is the latest date even when instalments are entered out of order", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 3000 });
    await pay(
      workOrderId,
      RAHUL,
      { amount: 1000, paid_on: "2026-09-20" },
      { amount: 1000, paid_on: "2026-09-01" },
      { amount: 1000, paid_on: "2026-09-10" },
    );
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBe("2026-09-20");
  });

  it("goes back to empty when an instalment is removed, and follows a corrected date or amount", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 3000 });
    await pay(
      workOrderId,
      RAHUL,
      { amount: 1000, paid_on: "2026-09-01" },
      { amount: 2000, paid_on: "2026-09-10" },
    );
    const admin = await signedInAs(USERS.admin);
    const [early, late] = await instalments(workOrderId);
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBe("2026-09-10");

    // The date of the last instalment is corrected.
    await admin
      .from("coordinator_incentive_payments")
      .update({ paid_on: "2026-09-12" })
      .eq("id", late.id);
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBe("2026-09-12");
    // Moving it before the other: the settling date is now the other's.
    await admin
      .from("coordinator_incentive_payments")
      .update({ paid_on: "2026-08-01" })
      .eq("id", late.id);
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBe("2026-09-01");
    // An instalment lowered: no longer settled.
    await admin
      .from("coordinator_incentive_payments")
      .update({ amount: 1900 })
      .eq("id", late.id);
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBeNull();
    await admin
      .from("coordinator_incentive_payments")
      .update({ amount: 2000 })
      .eq("id", late.id);
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBe("2026-09-01");

    // Removed: unpaid again.
    const removed = await admin
      .from("coordinator_incentive_payments")
      .delete()
      .eq("id", early.id);
    expect(removed.error).toBeNull();
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBeNull();
  });

  it("keeps each coordinator's own: a payment to one never settles the other", async () => {
    const { workOrderId } = await sharedSale("Instalment Own");
    await fx.incentive(workOrderId, RAHUL, { amount: 4000 });
    await fx.incentive(workOrderId, PRIYA, { amount: 4000 });
    await pay(workOrderId, RAHUL, { amount: 4000, paid_on: "2026-10-01" });
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBe("2026-10-01");
    expect((await incentive(workOrderId, PRIYA)).paid_on).toBeNull();
  });

  it("stamps the incentive only when its paid date changes, by whoever recorded the settling instalment", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 3000 });
    await rolledBack(async (db) => {
      const where = "work_order_id = $1 and coordinator_id = $2";
      const args = [workOrderId, RAHUL];
      const stamp = async () =>
        (
          await db.query<{ updated_at: string; updated_by: string | null }>(
            `select updated_at::text, updated_by from public.coordinator_incentives where ${where}`,
            args,
          )
        ).rows[0];
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
        USERS.admin.id,
      ]);
      await db.query(
        `update public.coordinator_incentives set updated_at = '2020-01-01 00:00:00+00', updated_by = null where ${where}`,
        args,
      );
      const add = (amount: number, paidOn: string) =>
        db.query(
          `insert into public.coordinator_incentive_payments (work_order_id, coordinator_id, amount, paid_on)
           values ($1, $2, $3, $4)`,
          [workOrderId, RAHUL, amount, paidOn],
        );

      // A part-payment changes nothing about the incentive's own record.
      await add(1000, "2026-10-01");
      expect(await stamp()).toEqual({
        updated_at: "2020-01-01 00:00:00+00",
        updated_by: null,
      });
      // The settling one does, attributed to the person who recorded it.
      await add(2000, "2026-10-02");
      const settled = await stamp();
      expect(settled.updated_at).not.toBe("2020-01-01 00:00:00+00");
      expect(settled.updated_by).toBe(USERS.admin.id);
    });
  });
});

describe("the agreed amount", () => {
  it("can never drop below what has been paid out of it — nor be cleared", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 2000, paid_on: "2026-10-01" });
    const admin = await signedInAs(USERS.admin);
    const set = (amount: number | null) =>
      admin
        .from("coordinator_incentives")
        .update({ amount })
        .eq("work_order_id", workOrderId)
        .eq("coordinator_id", RAHUL);

    for (const amount of [1999.99, 0, null]) {
      const { error } = await set(amount);
      expect(error?.code, String(amount)).toBe("23514");
      expect(error?.message, String(amount)).toMatch(
        /cannot be less than the 2000\.00 already paid/,
      );
    }
    expect((await incentive(workOrderId, RAHUL)).amount).toBe(5000);
    expect((await set(2500)).error).toBeNull();
  });

  it("settles the incentive when lowered to exactly what has been paid, and re-opens it when raised", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 2000, paid_on: "2026-10-01" });
    const admin = await signedInAs(USERS.admin);
    const set = (amount: number) =>
      admin
        .from("coordinator_incentives")
        .update({ amount })
        .eq("work_order_id", workOrderId)
        .eq("coordinator_id", RAHUL);

    expect((await set(2000)).error).toBeNull();
    expect(await incentive(workOrderId, RAHUL)).toMatchObject({
      amount: 2000,
      paid_on: "2026-10-01",
    });
    expect((await set(2600)).error).toBeNull();
    expect(await incentive(workOrderId, RAHUL)).toMatchObject({
      amount: 2600,
      paid_on: null,
    });
  });

  it("is still the office's alone to set", async () => {
    const { workOrderId } = await fx.approvedProject();
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul
      .from("coordinator_incentives")
      .update({ amount: 99999 })
      .eq("work_order_id", workOrderId)
      .select("amount");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("the previous build's way of marking an incentive paid", () => {
  // The build live while this migration runs writes (amount, paid_on) in one
  // update on coordinator_incentives. It must keep working: the paid date is
  // recorded as the instalment that settles the rest.
  const write = (
    workOrderId: string,
    values: TablesUpdate<"coordinator_incentives">,
    client: Db = svc,
  ) =>
    client
      .from("coordinator_incentives")
      .update(values)
      .eq("work_order_id", workOrderId)
      .eq("coordinator_id", RAHUL)
      .select("amount, paid_on");

  it("becomes one settling instalment for the whole amount", async () => {
    const { workOrderId } = await fx.approvedProject();
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await write(
      workOrderId,
      { amount: 4500, paid_on: "2026-10-05" },
      admin,
    );
    expect(error).toBeNull();
    expect(data).toEqual([{ amount: 4500, paid_on: "2026-10-05" }]);
    expect(await instalments(workOrderId)).toEqual([
      expect.objectContaining({
        amount: 4500,
        paid_on: "2026-10-05",
        note: "Marked paid",
        recorded_by: USERS.admin.id,
      }),
    ]);
  });

  it("settles only what is still unpaid when instalments already exist", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 6000 });
    await pay(workOrderId, RAHUL, { amount: 2000, paid_on: "2026-10-20" });

    const { error } = await write(workOrderId, { paid_on: "2026-10-01" });
    expect(error).toBeNull();
    expect(
      (await instalments(workOrderId)).map((r) => [r.amount, r.paid_on]),
    ).toEqual([
      [4000, "2026-10-01"],
      [2000, "2026-10-20"],
    ]);
    // The incentive is settled, on the date of its latest instalment.
    expect((await incentive(workOrderId, RAHUL)).paid_on).toBe("2026-10-20");
  });

  it("does nothing for a zero incentive, and refuses a date without an amount", async () => {
    const { workOrderId } = await fx.approvedProject();
    expect(
      (await write(workOrderId, { amount: 0, paid_on: "2026-10-05" })).error,
    ).toBeNull();
    expect(await instalments(workOrderId)).toEqual([]);

    const bare = await fx.approvedProject();
    const refused = await write(bare.workOrderId, { paid_on: "2026-10-05" });
    expect(refused.error?.code).toBe("23514");
    expect(refused.error?.message).toMatch(
      /coordinator_incentives_paid_needs_amount/,
    );
  });

  it("refuses to clear or move the date of an incentive the instalments have settled", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 3000 });
    await pay(workOrderId, RAHUL, { amount: 3000, paid_on: "2026-10-05" });

    for (const paid_on of [null, "2026-10-09"]) {
      const { error } = await write(workOrderId, { paid_on });
      expect(error?.code, String(paid_on)).toBe("23514");
      expect(error?.message, String(paid_on)).toMatch(
        /paid date follows the incentive payments/,
      );
    }
    expect(await incentive(workOrderId, RAHUL)).toMatchObject({
      amount: 3000,
      paid_on: "2026-10-05",
    });
    expect(await instalments(workOrderId)).toHaveLength(1);
  });

  it("derives a stale date that is merely re-sent, or left behind by a changed amount", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 3000 });
    await pay(workOrderId, RAHUL, { amount: 3000, paid_on: "2026-10-05" });

    // The old form re-sends the figures it was showing: no change.
    expect(
      (await write(workOrderId, { amount: 3000, paid_on: "2026-10-05" })).error,
    ).toBeNull();
    // A raised amount with the old date left in the form: the rest is unpaid.
    const raised = await write(workOrderId, { amount: 3500 });
    expect(raised.error).toBeNull();
    expect(raised.data).toEqual([{ amount: 3500, paid_on: null }]);
    expect(await instalments(workOrderId)).toHaveLength(1);
  });
});

describe("who may see and write instalments (RLS)", () => {
  async function seenBy(user: SeedUser, workOrderId: string) {
    const client = await signedInAs(user);
    return must(
      await client
        .from("coordinator_incentive_payments")
        .select("coordinator_id, amount")
        .eq("work_order_id", workOrderId)
        .order("coordinator_id"),
      `${user.email}'s instalments`,
    );
  }

  it("each coordinator reads their own and nobody else's; the office reads all", async () => {
    const { workOrderId } = await sharedSale("Instalment RLS");
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await fx.incentive(workOrderId, PRIYA, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 1000, paid_on: "2026-10-01" });
    await pay(workOrderId, PRIYA, { amount: 2000, paid_on: "2026-10-02" });

    expect(await seenBy(USERS.rahul, workOrderId)).toEqual([
      { coordinator_id: RAHUL, amount: 1000 },
    ]);
    expect(await seenBy(USERS.priya, workOrderId)).toEqual([
      { coordinator_id: PRIYA, amount: 2000 },
    ]);
    expect(
      (await seenBy(USERS.admin, workOrderId)).map((r) => r.amount),
    ).toEqual([1000, 2000]);
    expect(
      (await seenBy(USERS.superadmin, workOrderId)).map((r) => r.amount),
    ).toEqual([1000, 2000]);
    // A coordinator off the sale, and a service engineer: nothing.
    expect(await seenBy(USERS.arun, workOrderId)).toEqual([]);
    expect(await seenBy(USERS.anil, workOrderId)).toEqual([]);
  });

  it("nothing for an anonymous caller", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 1000, paid_on: "2026-10-01" });
    const { data, error } = await anonClient()
      .from("coordinator_incentive_payments")
      .select("id")
      .eq("work_order_id", workOrderId);
    // No grant at all for anon: refused outright, never a row.
    expect(data ?? []).toEqual([]);
    expect(error?.code).toBe("42501");
  });

  it("a coordinator can neither record, correct nor remove one — their own included", async () => {
    const { workOrderId } = await sharedSale("Instalment Write");
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await fx.incentive(workOrderId, PRIYA, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 1000, paid_on: "2026-10-01" });
    const [own] = await instalments(workOrderId, RAHUL);

    for (const user of [USERS.rahul, USERS.priya, USERS.arun, USERS.anil]) {
      const client = await signedInAs(user);
      const insert = await client
        .from("coordinator_incentive_payments")
        .insert({
          work_order_id: workOrderId,
          coordinator_id: user.id,
          amount: 100,
          paid_on: "2026-10-05",
        });
      expect(insert.error?.code, `insert as ${user.email}`).toBe("42501");

      const update = await client
        .from("coordinator_incentive_payments")
        .update({ amount: 1 })
        .eq("id", own.id)
        .select("id");
      expect(update.data ?? [], `update as ${user.email}`).toEqual([]);

      const remove = await client
        .from("coordinator_incentive_payments")
        .delete()
        .eq("id", own.id)
        .select("id");
      expect(remove.data ?? [], `delete as ${user.email}`).toEqual([]);
    }
    expect(await instalments(workOrderId)).toHaveLength(1);
    expect((await instalments(workOrderId))[0].amount).toBe(1000);
  });

  it("a coordinator cannot probe a partner's incentive through the instalment limits", async () => {
    // A BEFORE trigger runs ahead of the row policy: an insert aimed at a
    // partner's incentive must be refused exactly as an allowed-looking one is
    // (42501), whatever the incentive holds — never "exceed" or "set the amount".
    const { workOrderId } = await sharedSale("Instalment Probe");
    await fx.incentive(workOrderId, PRIYA, { amount: 15000 });
    await pay(workOrderId, PRIYA, { amount: 12000, paid_on: "2026-10-01" });
    // Rahul's own incentive has no amount yet — the "set the amount first" case.
    const rahul = await signedInAs(USERS.rahul);
    for (const [label, coordinator, amount] of [
      ["under the partner's remainder", PRIYA, 1],
      ["over the partner's remainder", PRIYA, 14999.99],
      ["against an incentive with no amount", RAHUL, 1],
    ] as const) {
      const { error } = await rahul.from("coordinator_incentive_payments").insert({
        work_order_id: workOrderId,
        coordinator_id: coordinator,
        amount,
        paid_on: "2026-10-05",
      });
      expect(error?.code, label).toBe("42501");
      expect(error?.message, label).toMatch(/row-level security/i);
    }
    expect(await instalments(workOrderId, PRIYA)).toHaveLength(1);
  });

  it("the office can remove one (it is not SuperAdmin-only, unlike a ledger payment)", async () => {
    const { workOrderId } = await fx.approvedProject();
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 1000, paid_on: "2026-10-01" });
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("coordinator_incentive_payments")
      .delete()
      .eq("work_order_id", workOrderId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("instalments and the sale they belong to", () => {
  it("go with the sale when a work order is deleted", async () => {
    const { workOrderId } = await sharedSale("Instalment Cascade");
    await fx.incentive(workOrderId, RAHUL, { amount: 5000 });
    await fx.incentive(workOrderId, PRIYA, { amount: 5000 });
    await pay(workOrderId, RAHUL, { amount: 1000, paid_on: "2026-10-01" });
    await pay(workOrderId, PRIYA, { amount: 2000, paid_on: "2026-10-02" });

    const superadmin = await signedInAs(USERS.superadmin);
    const { error } = await superadmin
      .from("work_orders")
      .delete()
      .eq("id", workOrderId);
    expect(error).toBeNull();
    expect(await instalments(workOrderId)).toEqual([]);
  });

  it("keep a coordinator on the sale until their incentive and its payments are cleared", async () => {
    const { workOrderId } = await sharedSale("Instalment Membership");
    await fx.incentive(workOrderId, PRIYA, { amount: 2500 });
    await pay(workOrderId, PRIYA, { amount: 500, paid_on: "2026-10-01" });
    const admin = await signedInAs(USERS.admin);
    const set = () =>
      admin.rpc("set_work_order_coordinators", {
        p_work_order_id: workOrderId,
        p_coordinator_ids: [RAHUL],
      });
    expect((await set()).error?.code).toBe("23514");

    await fx.clearIncentive(workOrderId, PRIYA);
    expect((await set()).error).toBeNull();
    expect(await instalments(workOrderId)).toEqual([]);
  });
});

describe("the project list, the summary and the KPIs count what is paid out", () => {
  /**
   * The sheet's shapes on one shared sale: Rahul's ₹24,720 paid in three
   * instalments, Priya's ₹5,000 with ₹2,000 paid so far.
   */
  async function sale() {
    const created = await sharedSale("Instalment Totals");
    await fx.incentive(created.workOrderId, RAHUL, { amount: 24720 });
    await fx.incentive(created.workOrderId, PRIYA, { amount: 5000 });
    await pay(
      created.workOrderId,
      RAHUL,
      { amount: 20000, paid_on: "2025-05-15" },
      { amount: 2360, paid_on: "2025-05-16" },
      { amount: 2360, paid_on: "2025-05-21" },
    );
    await pay(created.workOrderId, PRIYA, {
      amount: 2000,
      paid_on: "2025-05-18",
    });
    return created;
  }

  const COLUMNS =
    "incentive_total, incentive_paid, incentive_unpaid, incentive_count, incentive_unpaid_count, incentive_unpaid_coordinator_ids, incentive_paid_coordinator_ids, coordinator_incentive, incentive_paid_on";

  async function listFor(user: SeedUser, projectId: string) {
    return must(
      await (await signedInAs(user))
        .from("projects_list")
        .select(COLUMNS)
        .eq("id", projectId)
        .single(),
      `${user.email}'s list row`,
    );
  }

  it("projects_list: agreed, paid and unpaid per viewer, and 'paid' only when the instalments reach the amount", async () => {
    const { projectId } = await sale();

    // The office sees both: ₹29,720 agreed, ₹26,720 paid, ₹3,000 to pay.
    expect(await listFor(USERS.admin, projectId)).toEqual({
      incentive_total: 29720,
      incentive_paid: 26720,
      incentive_unpaid: 3000,
      incentive_count: 2,
      incentive_unpaid_count: 1,
      incentive_unpaid_coordinator_ids: [PRIYA],
      incentive_paid_coordinator_ids: [RAHUL],
      // The compat pair: the sale is "paid" only once every incentive is.
      coordinator_incentive: 29720,
      incentive_paid_on: null,
    });
    // Each coordinator sees only their own.
    expect(await listFor(USERS.rahul, projectId)).toEqual({
      incentive_total: 24720,
      incentive_paid: 24720,
      incentive_unpaid: 0,
      incentive_count: 1,
      incentive_unpaid_count: 0,
      incentive_unpaid_coordinator_ids: [],
      incentive_paid_coordinator_ids: [RAHUL],
      coordinator_incentive: 24720,
      incentive_paid_on: "2025-05-21",
    });
    expect(await listFor(USERS.priya, projectId)).toEqual({
      incentive_total: 5000,
      incentive_paid: 2000,
      incentive_unpaid: 3000,
      incentive_count: 1,
      incentive_unpaid_count: 1,
      incentive_unpaid_coordinator_ids: [PRIYA],
      incentive_paid_coordinator_ids: [],
      coordinator_incentive: 5000,
      incentive_paid_on: null,
    });
  });

  it("projects_list: a sale with no incentive set reads zeros, as before", async () => {
    const { projectId } = await fx.approvedProject();
    expect(await listFor(USERS.admin, projectId)).toEqual({
      incentive_total: null,
      incentive_paid: 0,
      incentive_unpaid: 0,
      incentive_count: 0,
      incentive_unpaid_count: 0,
      incentive_unpaid_coordinator_ids: [],
      incentive_paid_coordinator_ids: [],
      coordinator_incentive: null,
      incentive_paid_on: null,
    });
  });

  it("incentive_summary(): total agreed, paid in instalments, and the pending difference", async () => {
    const admin = await signedInAs(USERS.admin);
    const read = async (coordinator?: string) =>
      must(
        await admin
          .rpc(
            "incentive_summary",
            coordinator ? { p_coordinator: coordinator } : {},
          )
          .single(),
        "summary",
      );
    const before = await read();
    const beforePriya = await read(PRIYA);
    const rahulBefore = must(
      await (await signedInAs(USERS.rahul)).rpc("incentive_summary").single(),
      "rahul",
    );
    await sale();
    const after = await read();

    // One shared sale, two people: counted once.
    expect(after.projects).toBe(before.projects + 1);
    expect(after.pending_projects).toBe(before.pending_projects + 1);
    expect(after.total).toBe(before.total + 29720);
    expect(after.paid).toBe(before.paid + 26720);
    expect(after.pending).toBe(before.pending + 3000);
    expect(after.pending).toBe(after.total - after.paid);

    // Narrowed to Priya: ₹5,000 agreed, ₹2,000 paid.
    const priya = await read(PRIYA);
    expect(priya.total).toBe(beforePriya.total + 5000);
    expect(priya.paid).toBe(beforePriya.paid + 2000);
    expect(priya.pending).toBe(beforePriya.pending + 3000);
    expect(priya.pending_projects).toBe(beforePriya.pending_projects + 1);

    // A coordinator's own call counts only their own row: Rahul's is settled.
    const rahulSummary = async () =>
      must(
        await (await signedInAs(USERS.rahul)).rpc("incentive_summary").single(),
        "rahul",
      );
    const rahulAfter = await rahulSummary();
    expect(rahulAfter.total - rahulBefore.total).toBe(24720);
    expect(rahulAfter.paid - rahulBefore.paid).toBe(24720);
    expect(rahulAfter.pending).toBe(rahulBefore.pending);
    expect(rahulAfter.pending_projects).toBe(rahulBefore.pending_projects);
  });

  it("dashboard_metrics().incentive_pending: agreed minus paid, per viewer", async () => {
    const pendingFor = async (user: SeedUser) =>
      Number(
        must(
          await (await signedInAs(user)).rpc("dashboard_metrics").single(),
          "metrics",
        ).incentive_pending,
      );
    const before = {
      admin: await pendingFor(USERS.admin),
      rahul: await pendingFor(USERS.rahul),
      priya: await pendingFor(USERS.priya),
    };
    await sale();
    expect(await pendingFor(USERS.admin)).toBe(before.admin + 3000);
    expect(await pendingFor(USERS.priya)).toBe(before.priya + 3000);
    // Rahul's share is settled: nothing of this sale is pending for him.
    expect(await pendingFor(USERS.rahul)).toBe(before.rahul);
  });

  it("a part-payment moves the summary and the KPI by exactly its amount", async () => {
    const created = await sale();
    const admin = await signedInAs(USERS.admin);
    const pending = async () =>
      Number(
        must(await admin.rpc("dashboard_metrics").single(), "metrics")
          .incentive_pending,
      );
    const before = await pending();
    await pay(created.workOrderId, PRIYA, {
      amount: 1250,
      paid_on: "2025-05-25",
    });
    expect(await pending()).toBe(before - 1250);
    await pay(created.workOrderId, PRIYA, {
      amount: 1750,
      paid_on: "2025-05-30",
    });
    expect(await pending()).toBe(before - 3000);
    // Settled now.
    expect((await incentive(created.workOrderId, PRIYA)).paid_on).toBe(
      "2025-05-30",
    );
    expect(
      (await listFor(USERS.admin, created.projectId)).incentive_paid_on,
    ).toBe("2025-05-30");
  });
});

/**
 * The app reads each person's incentive with its instalments through a PostgREST
 * embed. The new table has two foreign keys (the incentive it belongs to, and
 * who recorded it): neither may make an existing embed ambiguous, and the
 * nested shape below — the one the repositories use — must read object-vs-array
 * the way the code expects.
 */
describe("PostgREST embeds", () => {
  const INSTALMENTS = `payments:coordinator_incentive_payments!coordinator_incentive_payments_incentive_fkey(
    id, amount, paid_on, note,
    recorder:profiles!coordinator_incentive_payments_recorded_by_fkey(full_name))`;
  const TEAM = `coordinators:work_order_coordinators!work_order_coordinators_work_order_id_fkey(
    coordinator_id, sort_order,
    profile:profiles!work_order_coordinators_coordinator_id_fkey(id, full_name),
    incentive:coordinator_incentives(amount, paid_on, ${INSTALMENTS}))`;

  it("read each person's incentive with its instalments, in the shape the repositories rely on", async () => {
    const sale = await sharedSale("Instalment Embeds");
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 5000 });
    await fx.incentive(sale.workOrderId, PRIYA, { amount: 3000 });
    await pay(
      sale.workOrderId,
      RAHUL,
      { amount: 2000, paid_on: "2026-10-01", note: "First" },
      { amount: 3000, paid_on: "2026-10-09" },
    );
    await pay(sale.workOrderId, PRIYA, { amount: 500, paid_on: "2026-10-03" });

    const read = async (user: SeedUser) =>
      must(
        await (await signedInAs(user))
          .from("work_orders")
          .select(`id, ${TEAM}`)
          .eq("id", sale.workOrderId)
          .single(),
        `${user.email}'s team`,
      );
    const summary = (row: Awaited<ReturnType<typeof read>>) =>
      Object.fromEntries(
        row.coordinators.map((m) => [
          m.profile?.full_name,
          m.incentive
            ? {
                amount: m.incentive.amount,
                paid_on: m.incentive.paid_on,
                payments: [...m.incentive.payments]
                  .sort((a, b) => a.paid_on.localeCompare(b.paid_on))
                  .map((p) => [
                    p.amount,
                    p.paid_on,
                    p.note,
                    p.recorder?.full_name ?? null,
                  ]),
              }
            : null,
        ]),
      );

    // The office sees everyone's, each with their own instalments, and who recorded them.
    expect(summary(await read(USERS.admin))).toEqual({
      "Rahul Menon": {
        amount: 5000,
        paid_on: "2026-10-09",
        payments: [
          [2000, "2026-10-01", "First", "BSS Admin"],
          [3000, "2026-10-09", null, "BSS Admin"],
        ],
      },
      "Priya Suresh": {
        amount: 3000,
        paid_on: null,
        payments: [[500, "2026-10-03", null, "BSS Admin"]],
      },
    });

    // A partner sees the whole team and only their own incentive and payments.
    expect(summary(await read(USERS.priya))).toEqual({
      "Rahul Menon": null,
      "Priya Suresh": {
        amount: 3000,
        paid_on: null,
        payments: [[500, "2026-10-03", null, null]],
      },
    });
  });

  it("an incentive nothing was paid on embeds an empty list, and the unhinted old embed is unchanged", async () => {
    const sale = await fx.approvedProject();
    await fx.incentive(sale.workOrderId, RAHUL, { amount: 1000 });
    const admin = await signedInAs(USERS.admin);
    const row = must(
      await admin
        .from("work_order_coordinators")
        .select(
          `coordinator_id, incentive:coordinator_incentives(amount, ${INSTALMENTS})`,
        )
        .eq("work_order_id", sale.workOrderId)
        .single(),
      "membership",
    );
    expect(row.incentive?.payments).toEqual([]);

    // The embed the repositories used before this release, unhinted, still resolves.
    const old = must(
      await admin
        .from("work_order_coordinators")
        .select(
          "coordinator_id, incentive:coordinator_incentives(amount, paid_on)",
        )
        .eq("work_order_id", sale.workOrderId)
        .single(),
      "old embed",
    );
    expect(old.incentive).toEqual({ amount: 1000, paid_on: null });
  });
});

describe("the seeded incentives", () => {
  it("the seed's paid incentives are one instalment each, and its partly paid one has two", async () => {
    const rows = must(
      await svc
        .from("coordinator_incentive_payments")
        .select("work_order_id, coordinator_id, amount, paid_on")
        .in("work_order_id", [
          "10000000-0000-0000-0000-000000000005", // Mary Jose: Rahul ₹5,000, paid
          "10000000-0000-0000-0000-000000000019", // Gopinathan: Rahul ₹6,000, ₹4,000 paid
        ]),
      "seeded instalments",
    );
    const paidOf = (workOrderId: string) =>
      rows.filter((r) => r.work_order_id === workOrderId).map((r) => r.amount);
    expect(paidOf("10000000-0000-0000-0000-000000000005")).toEqual([5000]);
    expect(paidOf("10000000-0000-0000-0000-000000000019").sort()).toEqual([
      2000, 2000,
    ]);
    const gopinathan = await incentive(
      "10000000-0000-0000-0000-000000000019",
      RAHUL,
    );
    expect(gopinathan).toMatchObject({ amount: 6000, paid_on: null });
  });
});
