import { describe, it, expect, afterAll } from "vitest";
import {
  anonClient,
  serviceClient,
  signedInAs,
  USERS,
  withDb,
} from "./helpers";
import { createFixtures, must, uniqueTag } from "./fixtures";

/**
 * Refunds, write-offs, KSEB fees paid by the office and the advance's details
 * (migrations 20261104120000 / 20261104120100). A refund is money handed BACK to
 * the customer, a write-off a balance the office gives up (its reason is
 * required), and neither kind of KSEB fee counts towards the contract:
 *
 *   net received = advance + Σ contract − Σ refund
 *   balance due  = total − net received − Σ write-off
 *
 * The office records them (RLS), the list views and KPIs agree with the maths,
 * and the advance's method / date / reference follow the advance's lock.
 */
const svc = serviceClient();
const fx = createFixtures(svc);
const RUN = uniqueTag();

const RAHUL = USERS.rahul.id;
const PRIYA = USERS.priya.id;

afterAll(() => fx.cleanup());

/** A commissioned sale, total ₹1,00,000 with a ₹20,000 advance. */
async function commissionedSale(
  name: string,
  workOrder: Record<string, unknown> = {},
) {
  return fx.approvedProject({
    workOrder: {
      client_name: `${name} ${RUN}`,
      total_cost: 100000,
      advance_amount: 20000,
      ...workOrder,
    },
    project: {
      is_completed: true,
      current_stage: "plant_commissioning",
      completed_at: "2026-03-01T06:30:00Z",
    },
  });
}

type Entry = {
  amount: number;
  purpose?: "contract" | "kseb_fees" | "refund" | "write_off";
  paid_by_office?: boolean;
  notes?: string | null;
  paid_on?: string;
};

/** Ledger entries recorded the way the office does (as the admin, through RLS). */
async function record(workOrderId: string, ...entries: Entry[]) {
  const admin = await signedInAs(USERS.admin);
  for (const entry of entries) {
    must(
      await admin
        .from("payments")
        .insert({
          work_order_id: workOrderId,
          paid_on: "2026-02-10",
          method: "bank_transfer",
          recorded_by: USERS.admin.id,
          ...entry,
        })
        .select("id")
        .single(),
      `record ${entry.purpose ?? "contract"}`,
    );
  }
}

const MONEY_COLUMNS =
  "payments_total, payment_count, last_payment_on, refunded_total, written_off_total, kseb_fees_collected, kseb_fees_by_office, amount_received, balance_due";

describe("the payment purposes", () => {
  it("are contract, kseb_fees, refund and write_off, in that order", async () => {
    const labels = await withDb(async (db) => {
      const { rows } = await db.query<{ labels: string }>(
        "select enum_range(null::public.payment_purpose)::text as labels",
      );
      return rows[0].labels;
    });
    expect(labels).toBe("{contract,kseb_fees,refund,write_off}");
  });

  it("let the office record a refund on a live, a commissioned and a cancelled sale", async () => {
    const live = await fx.approvedProject({
      workOrder: { client_name: `Refund Live ${RUN}` },
    });
    const done = await commissionedSale("Refund Done");
    const cancelled = await fx.approvedProject({
      workOrder: { client_name: `Refund Cancelled ${RUN}` },
      project: { cancellation: "cancelled" },
    });
    const admin = await signedInAs(USERS.admin);
    const superadmin = await signedInAs(USERS.superadmin);

    for (const [sale, client] of [
      [live, admin],
      [done, admin],
      [cancelled, superadmin],
    ] as const) {
      const { data, error } = await client
        .from("payments")
        .insert({
          work_order_id: sale.workOrderId,
          amount: 5000,
          paid_on: "2026-02-10",
          purpose: "refund",
          method: "upi",
          reference: "UPI 4410",
          notes: "Returned the excess",
        })
        .select("purpose, method, paid_by_office, amount")
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({
        purpose: "refund",
        method: "upi",
        paid_by_office: false,
        amount: 5000,
      });
    }
  });

  it("let the office record a write-off with its reason", async () => {
    const { workOrderId } = await commissionedSale("Write-off Reason");
    const admin = await signedInAs(USERS.admin);
    const { data, error } = await admin
      .from("payments")
      .insert({
        work_order_id: workOrderId,
        amount: 800,
        paid_on: "2026-02-10",
        purpose: "write_off",
        notes: "Customer short by 800 at handover",
      })
      .select("purpose, notes")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({
      purpose: "write_off",
      notes: "Customer short by 800 at handover",
    });
  });

  it("keep the old defaults: a plain entry is a contract payment the customer made", async () => {
    const { workOrderId } = await fx.approvedProject();
    const id = await fx.payment(workOrderId);
    const row = must(
      await svc
        .from("payments")
        .select("purpose, paid_by_office")
        .eq("id", id)
        .single(),
      "payment",
    );
    expect(row).toEqual({ purpose: "contract", paid_by_office: false });
  });
});

describe("ledger integrity", () => {
  it.each([
    ["no reason", { notes: null }],
    ["an empty reason", { notes: "" }],
    ["a blank reason", { notes: "   " }],
  ])("refuses a write-off with %s", async (_what, reason) => {
    const { workOrderId } = await fx.approvedProject();
    const { error } = await svc.from("payments").insert({
      work_order_id: workOrderId,
      amount: 800,
      paid_on: "2026-02-10",
      purpose: "write_off",
      ...reason,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toMatch(/payments_write_off_needs_reason/);
  });

  it("takes the reason from notes only (a reference alone is not one)", async () => {
    const { workOrderId } = await fx.approvedProject();
    const { error } = await svc.from("payments").insert({
      work_order_id: workOrderId,
      amount: 800,
      paid_on: "2026-02-10",
      purpose: "write_off",
      reference: "waived",
    });
    expect(error?.code).toBe("23514");
  });

  it("does not ask a refund or a contract payment for a reason", async () => {
    const { workOrderId } = await fx.approvedProject();
    for (const purpose of ["refund", "contract", "kseb_fees"] as const) {
      const { error } = await svc
        .from("payments")
        .insert({
          work_order_id: workOrderId,
          amount: 100,
          paid_on: "2026-02-10",
          purpose,
        });
      expect(error, purpose).toBeNull();
    }
  });

  it("never lets a write-off lose its reason, or a payment become one without a reason", async () => {
    const { workOrderId } = await fx.approvedProject();
    const writeOff = await fx.payment(workOrderId, {
      amount: 800,
      purpose: "write_off",
      notes: "Waived",
    });
    const blank = await svc
      .from("payments")
      .update({ notes: "  " })
      .eq("id", writeOff);
    expect(blank.error?.code).toBe("23514");
    expect(blank.error?.message).toMatch(/payments_write_off_needs_reason/);

    const plain = await fx.payment(workOrderId, { amount: 800 });
    const flipped = await svc
      .from("payments")
      .update({ purpose: "write_off" })
      .eq("id", plain);
    expect(flipped.error?.code).toBe("23514");
    // With a reason in the same statement it is fine.
    const ok = await svc
      .from("payments")
      .update({ purpose: "write_off", notes: "Waived" })
      .eq("id", plain);
    expect(ok.error).toBeNull();
  });

  it.each([0, -1])(
    "still refuses an amount of %d on a refund or a write-off",
    async (amount) => {
      const { workOrderId } = await fx.approvedProject();
      for (const purpose of ["refund", "write_off"] as const) {
        const { error } = await svc.from("payments").insert({
          work_order_id: workOrderId,
          amount,
          paid_on: "2026-02-10",
          purpose,
          notes: "reason",
        });
        expect(error?.code, purpose).toBe("23514");
        expect(error?.message, purpose).toMatch(/payments_amount_positive/);
      }
    },
  );

  it("allows paid_by_office on a KSEB fee only", async () => {
    const { workOrderId } = await fx.approvedProject();
    const fee = await svc
      .from("payments")
      .insert({
        work_order_id: workOrderId,
        amount: 4720,
        paid_on: "2026-02-10",
        purpose: "kseb_fees",
        paid_by_office: true,
      })
      .select("paid_by_office")
      .single();
    expect(fee.error).toBeNull();
    expect(fee.data?.paid_by_office).toBe(true);

    for (const purpose of ["contract", "refund", "write_off"] as const) {
      const { error } = await svc.from("payments").insert({
        work_order_id: workOrderId,
        amount: 100,
        paid_on: "2026-02-10",
        purpose,
        notes: "reason",
        paid_by_office: true,
      });
      expect(error?.code, purpose).toBe("23514");
      expect(error?.message, purpose).toMatch(
        /payments_paid_by_office_only_kseb/,
      );
    }

    // An office-paid fee cannot be re-purposed into the contract.
    const repurposed = await svc
      .from("payments")
      .update({ purpose: "contract" })
      .eq("work_order_id", workOrderId)
      .eq("paid_by_office", true);
    expect(repurposed.error?.code).toBe("23514");
  });
});

describe("who may record and read them", () => {
  it("a coordinator cannot record a refund, a write-off or an office-paid fee, even on their own sale", async () => {
    const { workOrderId } = await fx.approvedProject();
    const rahul = await signedInAs(USERS.rahul);
    for (const entry of [
      { purpose: "refund" as const },
      { purpose: "write_off" as const, notes: "mine" },
      { purpose: "kseb_fees" as const, paid_by_office: true },
    ]) {
      const { error } = await rahul
        .from("payments")
        .insert({
          work_order_id: workOrderId,
          amount: 100,
          paid_on: "2026-02-10",
          ...entry,
        });
      expect(error?.code, entry.purpose).toBe("42501");
    }
  });

  it("a coordinator reads them on their own sales; a partner too; nobody else does", async () => {
    const { workOrderId } = await fx.approvedProject({ partners: [PRIYA] });
    await record(
      workOrderId,
      { amount: 5000, purpose: "refund" },
      { amount: 800, purpose: "write_off", notes: "Waived" },
      { amount: 3000, purpose: "kseb_fees", paid_by_office: true },
    );
    const seenBy = async (client: Awaited<ReturnType<typeof signedInAs>>) =>
      must(
        await client
          .from("payments")
          .select("purpose, paid_by_office")
          .eq("work_order_id", workOrderId)
          .order("purpose"),
        "ledger",
      );
    const all = [
      { purpose: "kseb_fees", paid_by_office: true },
      { purpose: "refund", paid_by_office: false },
      { purpose: "write_off", paid_by_office: false },
    ];
    expect(await seenBy(await signedInAs(USERS.rahul))).toEqual(all);
    expect(await seenBy(await signedInAs(USERS.priya))).toEqual(all);
    expect(await seenBy(await signedInAs(USERS.admin))).toEqual(all);
    expect(await seenBy(await signedInAs(USERS.arun))).toEqual([]);
    expect(await seenBy(await signedInAs(USERS.anil))).toEqual([]);

    const anon = await anonClient()
      .from("payments")
      .select("id")
      .eq("work_order_id", workOrderId);
    expect(anon.data ?? []).toEqual([]);
  });

  it("a coordinator cannot edit or delete one", async () => {
    const { workOrderId } = await fx.approvedProject();
    const id = await fx.payment(workOrderId, {
      amount: 5000,
      purpose: "refund",
    });
    const rahul = await signedInAs(USERS.rahul);
    const edited = await rahul
      .from("payments")
      .update({ amount: 1 })
      .eq("id", id)
      .select("id");
    expect(edited.data ?? []).toHaveLength(0);
    const removed = await rahul
      .from("payments")
      .delete()
      .eq("id", id)
      .select("id");
    expect(removed.data ?? []).toHaveLength(0);
    expect(
      must(
        await svc.from("payments").select("amount").eq("id", id).single(),
        "after",
      ).amount,
    ).toBe(5000);
  });

  it("only the SuperAdmin deletes a refund or a write-off", async () => {
    const { workOrderId } = await fx.approvedProject();
    const refund = await fx.payment(workOrderId, {
      amount: 5000,
      purpose: "refund",
    });
    const writeOff = await fx.payment(workOrderId, {
      amount: 800,
      purpose: "write_off",
      notes: "Waived",
    });
    const admin = await signedInAs(USERS.admin);
    for (const id of [refund, writeOff]) {
      const refused = await admin
        .from("payments")
        .delete()
        .eq("id", id)
        .select("id");
      expect(refused.data ?? []).toHaveLength(0);
    }
    const superadmin = await signedInAs(USERS.superadmin);
    const gone = await superadmin
      .from("payments")
      .delete()
      .in("id", [refund, writeOff])
      .select("id");
    expect(gone.error).toBeNull();
    expect(gone.data).toHaveLength(2);
  });
});

describe("the list views and the KPIs follow the new maths", () => {
  it("net received, balance and the four new totals — in both views", async () => {
    const sale = await commissionedSale("Views Net");
    await record(
      sale.workOrderId,
      { amount: 50000, paid_on: "2026-02-10" },
      { amount: 10000, purpose: "refund", paid_on: "2026-03-05" },
      {
        amount: 800,
        purpose: "write_off",
        notes: "Customer short",
        paid_on: "2026-03-06",
      },
      { amount: 2000, purpose: "kseb_fees", paid_on: "2026-01-20" },
      {
        amount: 1500,
        purpose: "kseb_fees",
        paid_by_office: true,
        paid_on: "2026-01-21",
      },
    );
    const expected = {
      // The refund and the fees are not contract stages, and never "the last payment".
      payments_total: 50000,
      payment_count: 1,
      last_payment_on: "2026-02-10",
      refunded_total: 10000,
      written_off_total: 800,
      kseb_fees_collected: 2000,
      kseb_fees_by_office: 1500,
      // 20,000 advance + 50,000 − 10,000 refunded
      amount_received: 60000,
      // 1,00,000 − 60,000 − 800 written off
      balance_due: 39200,
    };
    const work = must(
      await svc
        .from("work_orders_list")
        .select(MONEY_COLUMNS)
        .eq("id", sale.workOrderId)
        .single(),
      "work_orders_list",
    );
    expect(work).toEqual(expected);
    const project = must(
      await svc
        .from("projects_list")
        .select(`${MONEY_COLUMNS}, payment_pending`)
        .eq("id", sale.projectId)
        .single(),
      "projects_list",
    );
    expect(project).toEqual({ ...expected, payment_pending: true });
  });

  it("a refund reopens a settled commissioned sale; a write-off closes it again", async () => {
    const sale = await commissionedSale("Views Reopen");
    await record(sale.workOrderId, { amount: 80000 });
    const state = async () =>
      must(
        await svc
          .from("projects_list")
          .select("balance_due, payment_pending, amount_received")
          .eq("id", sale.projectId)
          .single(),
        "project",
      );
    const admin = await signedInAs(USERS.admin);
    const kpis = async () => {
      const m = must(
        await admin.rpc("dashboard_metrics").single(),
        "dashboard_metrics",
      );
      return {
        unpaid: Number(m.commissioned_unpaid),
        outstanding: Number(m.outstanding_amount),
      };
    };

    expect(await state()).toEqual({
      balance_due: 0,
      payment_pending: false,
      amount_received: 100000,
    });
    const settled = await kpis();

    await record(sale.workOrderId, {
      amount: 10000,
      purpose: "refund",
      paid_on: "2026-03-05",
    });
    expect(await state()).toEqual({
      balance_due: 10000,
      payment_pending: true,
      amount_received: 90000,
    });
    const reopened = await kpis();
    expect(reopened.unpaid).toBe(settled.unpaid + 1);
    expect(reopened.outstanding).toBe(settled.outstanding + 10000);

    await record(sale.workOrderId, {
      amount: 10000,
      purpose: "write_off",
      notes: "Customer keeps the credit",
      paid_on: "2026-03-06",
    });
    expect(await state()).toEqual({
      balance_due: 0,
      payment_pending: false,
      amount_received: 90000,
    });
    expect(await kpis()).toEqual(settled);
  });

  it("a cancelled or refunded sale is never payment pending, whatever its adjustments", async () => {
    const sale = await commissionedSale("Views Cancelled");
    // 20,000 advance + 70,000 − 5,000 refunded leaves 15,000 uncollected.
    await record(
      sale.workOrderId,
      { amount: 70000 },
      { amount: 5000, purpose: "refund" },
    );
    await svc
      .from("projects")
      .update({ cancellation: "refunded" })
      .eq("id", sale.projectId);
    const row = must(
      await svc
        .from("projects_list")
        .select("balance_due, payment_pending")
        .eq("id", sale.projectId)
        .single(),
      "project",
    );
    expect(row).toEqual({ balance_due: 15000, payment_pending: false });
  });

  it("every adjustment is visible to the sale's coordinator, in their own list", async () => {
    const sale = await commissionedSale("Views Rahul");
    await record(
      sale.workOrderId,
      { amount: 50000 },
      { amount: 1000, purpose: "refund" },
      { amount: 250, purpose: "write_off", notes: "Rounded off" },
      { amount: 900, purpose: "kseb_fees", paid_by_office: true },
    );
    const rahul = await signedInAs(USERS.rahul);
    const mine = must(
      await rahul
        .from("work_orders_list")
        .select(MONEY_COLUMNS)
        .eq("id", sale.workOrderId)
        .single(),
      "rahul's row",
    );
    const office = must(
      await svc
        .from("work_orders_list")
        .select(MONEY_COLUMNS)
        .eq("id", sale.workOrderId)
        .single(),
      "office row",
    );
    expect(mine).toEqual(office);
    expect(mine.refunded_total).toBe(1000);
    expect(mine.kseb_fees_by_office).toBe(900);

    // A coordinator not on the sale sees no row at all.
    const arun = await signedInAs(USERS.arun);
    const theirs = must(
      await arun
        .from("work_orders_list")
        .select("id")
        .eq("id", sale.workOrderId),
      "arun's rows",
    );
    expect(theirs).toEqual([]);
  });

  it("the seed holds a refunded overpayment, a written-off shortfall and both kinds of KSEB fee", async () => {
    const rows = must(
      await svc
        .from("projects_list")
        .select(
          "client_name, amount_received, balance_due, payment_pending, refunded_total, written_off_total, kseb_fees_collected, kseb_fees_by_office",
        )
        .in("client_name", ["Gopinathan Pillai", "Sathyan Nambiar"]),
      "seeded sales",
    );
    const byName = Object.fromEntries(rows.map((r) => [r.client_name, r]));
    // ₹3,10,000 collected, ₹10,000 sent back: exactly the contract.
    expect(byName["Gopinathan Pillai"]).toMatchObject({
      amount_received: 300000,
      balance_due: 0,
      payment_pending: false,
      refunded_total: 10000,
      written_off_total: 0,
      kseb_fees_collected: 4720,
      kseb_fees_by_office: 0,
    });
    // ₹800 short, written off: settled.
    expect(byName["Sathyan Nambiar"]).toMatchObject({
      amount_received: 174200,
      balance_due: 0,
      payment_pending: false,
      refunded_total: 0,
      written_off_total: 800,
      kseb_fees_collected: 0,
      kseb_fees_by_office: 5720,
    });
  });
});

describe("the advance's details", () => {
  const ADVANCE = {
    advance_method: "upi" as const,
    advance_paid_on: "2026-02-04",
    advance_reference: "UPI 4410021199",
  };

  async function advanceOf(id: string) {
    return must(
      await svc
        .from("work_orders")
        .select("advance_method, advance_paid_on, advance_reference")
        .eq("id", id)
        .single(),
      "advance",
    );
  }

  it("are optional: a work order without them is unchanged", async () => {
    const id = await fx.workOrder({ advance_amount: 10000 });
    expect(await advanceOf(id)).toEqual({
      advance_method: null,
      advance_paid_on: null,
      advance_reference: null,
    });
  });

  it("are set by a coordinator when logging a pending work order, and while it is pending", async () => {
    const rahul = await signedInAs(USERS.rahul);
    const { data, error } = await rahul
      .from("work_orders")
      .insert({
        coordinator_id: RAHUL,
        client_name: `Advance Pending ${RUN}`,
        plant_capacity: "3kW",
        total_cost: 150000,
        advance_amount: 10000,
        ...ADVANCE,
      })
      .select("id, status")
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("pending");
    fx.trackWorkOrder(data!.id);
    expect(await advanceOf(data!.id)).toEqual(ADVANCE);

    const edited = await rahul
      .from("work_orders")
      .update({ advance_method: "cash", advance_reference: "Receipt 17" })
      .eq("id", data!.id);
    expect(edited.error).toBeNull();
    expect(await advanceOf(data!.id)).toMatchObject({
      advance_method: "cash",
      advance_reference: "Receipt 17",
    });
  });

  it.each([
    ["method", { advance_method: "cash" as const }],
    ["date", { advance_paid_on: "2026-02-05" }],
    ["reference", { advance_reference: "UPI 0000" }],
  ])(
    "are locked like the advance once the order is approved: the owner cannot change the %s",
    async (_what, change) => {
      const { workOrderId } = await fx.approvedProject({
        workOrder: { advance_amount: 10000, ...ADVANCE },
      });
      const rahul = await signedInAs(USERS.rahul);

      const { error } = await rahul
        .from("work_orders")
        .update({ ...change, kseb_section: "Kakkanad" })
        .eq("id", workOrderId);
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/Only the office can change the amounts/);

      // Atomic: the detail edit in the same statement did not land either.
      const row = must(
        await svc
          .from("work_orders")
          .select(
            "advance_method, advance_paid_on, advance_reference, kseb_section",
          )
          .eq("id", workOrderId)
          .single(),
        "after",
      );
      expect(row).toEqual({ ...ADVANCE, kseb_section: null });
    },
  );

  it("cannot be added to an approved order by its coordinator either, but the edit form's re-send is accepted", async () => {
    const bare = await fx.approvedProject({
      workOrder: { advance_amount: 10000 },
    });
    const rahul = await signedInAs(USERS.rahul);
    const added = await rahul
      .from("work_orders")
      .update(ADVANCE)
      .eq("id", bare.workOrderId);
    expect(added.error?.code).toBe("42501");

    const set = await fx.approvedProject({
      workOrder: { advance_amount: 10000, ...ADVANCE },
    });
    const resend = await rahul
      .from("work_orders")
      .update({ ...ADVANCE, notes: "Details corrected" })
      .eq("id", set.workOrderId);
    expect(resend.error).toBeNull();
  });

  it("are the office's to change at any time", async () => {
    const { workOrderId } = await fx.approvedProject({
      workOrder: { advance_amount: 10000, ...ADVANCE },
    });
    for (const user of [USERS.admin, USERS.superadmin]) {
      const client = await signedInAs(user);
      const { error } = await client
        .from("work_orders")
        .update({
          advance_method: "bank_transfer",
          advance_reference: `UTR ${user.email}`,
        })
        .eq("id", workOrderId);
      expect(error, user.email).toBeNull();
    }
    expect(await advanceOf(workOrderId)).toMatchObject({
      advance_method: "bank_transfer",
      advance_reference: `UTR ${USERS.superadmin.email}`,
    });
  });

  it("accept only the payment methods the ledger knows", async () => {
    const { workOrderId } = await fx.approvedProject();
    const { error } = await svc
      .from("work_orders")
      // @ts-expect-error — not a payment_method
      .update({ advance_method: "barter" })
      .eq("id", workOrderId);
    expect(error?.code).toBe("22P02");
  });
});
