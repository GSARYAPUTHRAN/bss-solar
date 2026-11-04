import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords, toCsv } from "@/lib/csv";
import { todayISO } from "@/lib/format";
import { CoordinatorDirectory } from "./coordinator-match";
import {
  IMPORT_HEADERS,
  INCENTIVE_FIELDS,
  PAYMENT_FIELDS,
  TEMPLATE_EXAMPLE_PROBLEM,
  incentiveColumn,
  paymentColumn,
  planImport,
  validateImportHeaders,
} from "./import";
import { IMPORT_TEMPLATE, TEMPLATE_COLUMNS } from "./import-template";
import { TEMPLATE_ROWS } from "./import-template-rows";
import { paymentSummary, withLedger } from "./payment";

/** After every date in the template; the template is validated as of this day. */
const TODAY = "2026-10-10";

// The people the template names, as the demo accounts are: Rahul by e-mail too.
const RAHUL = { id: "id-rahul", fullName: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" as const };
const PRIYA = { id: "id-priya", fullName: "Priya Suresh", email: "priya@bsssolar.test", role: "coordinator" as const };
const DIRECTORY = new CoordinatorDirectory([RAHUL, PRIYA]);

/** No default coordinator: every row must stand on its own. */
const options = (today: string) => ({ today, directory: DIRECTORY, defaultCoordinatorId: null });

/**
 * The template as a person would use it: every example deleted or renamed. The
 * rows are the same, only the client is someone else.
 */
function renamed(template: string): string {
  const csv = parseCsv(template);
  if ("error" in csv) throw new Error(csv.error);
  const [header, ...rows] = csv.rows;
  return toCsv([header, ...rows.map(([client, ...rest]) => [`${client} (copy)`, ...rest])]);
}

describe("IMPORT_TEMPLATE — as downloaded", () => {
  const plan = planImport(IMPORT_TEMPLATE, options(TODAY));
  if (!plan.ok) throw new Error(`template rejected: ${plan.error}`);

  it("refuses every one of its rows as an example left in the file, and nothing else", () => {
    expect(plan.data.rows).toHaveLength(6);
    expect(plan.data.rows.map((r) => r.parsed)).toEqual(
      Array.from({ length: 6 }, () => ({ ok: false, error: TEMPLATE_EXAMPLE_PROBLEM })),
    );
    expect(plan.data.coordinatorMatches).toEqual([]);
  });

  it("knows each example by what identifies it, so none can be changed without the old copies slipping by", () => {
    // Name + consumer number, or name + cost + order date: these cells are the identity.
    const identity = TEMPLATE_ROWS.map((r) => [
      r.client_name,
      r.consumer_number ?? null,
      r.total_cost,
      r.order_date ?? null,
    ]);
    expect(identity).toEqual([
      ["Anand Kumar", "1156789012345", "195000", "2026-06-15"],
      ["Meera Nair", "1145678054321", "310000", "2026-03-02"],
      ["Sreeja Pillai", null, "130000", null],
      ["Joseph Mathew", "1167890123456", "235000+23500", "2026-02-10"],
      ["Rakesh Varma", null, "23500", "2026-04-20"],
      ["Suma Devi", null, "235000", "2026-01-13"],
    ]);
  });
});

describe("IMPORT_TEMPLATE — once the examples are renamed", () => {
  const plan = planImport(renamed(IMPORT_TEMPLATE), options(TODAY));
  if (!plan.ok) throw new Error(`template rejected: ${plan.error}`);
  const rows = plan.data.rows.map((r) => {
    if (!r.parsed.ok) throw new Error(`template row ${r.rowNo}: ${r.parsed.error}`);
    return r.parsed.data;
  });

  it("parses with the documented columns, three incentive groups and four payment groups", () => {
    const csv = parseCsvRecords(IMPORT_TEMPLATE);
    if ("error" in csv) throw new Error(csv.error);
    expect(csv.headers.slice(0, IMPORT_HEADERS.length)).toEqual([...IMPORT_HEADERS]);
    expect(csv.headers).toEqual(TEMPLATE_COLUMNS);
    expect(validateImportHeaders(csv.headers)).toMatchObject({
      ok: true,
      data: { paymentSlots: [1, 2, 3, 4], incentiveSlots: [1, 2, 3] },
    });
  });

  it("has every field of every group in the template", () => {
    for (const n of [1, 2, 3]) {
      for (const f of INCENTIVE_FIELDS) expect(TEMPLATE_COLUMNS).toContain(incentiveColumn(n, f));
    }
    for (const n of [1, 2, 3, 4]) {
      for (const f of PAYMENT_FIELDS) expect(TEMPLATE_COLUMNS).toContain(paymentColumn(n, f));
    }
  });

  it("validates every row with zero errors, against a directory, with no default coordinator", () => {
    expect(rows).toHaveLength(6);
    expect(plan.data.coordinatorMatches.every((m) => m.account !== null)).toBe(true);
    expect(plan.data.rows.every((r) => !r.defaulted)).toBe(true);
  });

  it("is valid on the day it is downloaded (no example dated in the future)", () => {
    const now = planImport(renamed(IMPORT_TEMPLATE), options(todayISO()));
    expect(now.ok && now.data.rows.every((r) => r.parsed.ok)).toBe(true);
  });

  it("ships an in-progress bank-loan project paid in four stages, the KSEB fee paid by the office, the advance described", () => {
    const loan = rows[0];
    expect(loan.financing_type).toBe("loan");
    expect(loan.is_completed).toBe(false);
    expect(loan.feasibility_date).not.toBeNull();
    expect(loan.payments).toHaveLength(4);
    const fee = loan.payments.find((p) => p.purpose === "kseb_fees");
    expect(fee).toMatchObject({ amount: 4540, paid_by_office: true });
    expect(loan.advance_method).toBe("upi");
    expect(loan.advance_paid_on).toBe("2026-06-15");
    expect(loan.advance_reference).toBe("UPI 440011");
    expect(loan.incentives).toEqual([{ coordinator_id: RAHUL.id, amount: 5000, payments: [] }]);
  });

  it("ships a commissioned self-financed project with a balance still due and its incentive paid in two instalments", () => {
    const due = rows[1];
    expect(due.financing_type).toBe("self");
    expect(due.is_completed).toBe(true);
    expect(due.commissioned_on).not.toBeNull();
    const { balanceDue } = paymentSummary(withLedger(due, due.payments));
    expect(balanceDue).toBe(50000);
    expect(due.incentives).toEqual([
      {
        coordinator_id: PRIYA.id,
        amount: 8000,
        payments: [
          { amount: 5000, paid_on: "2026-05-20", note: null },
          { amount: 3000, paid_on: "2026-06-10", note: null },
        ],
      },
    ]);
  });

  it("ships a fresh project that names its coordinator by e-mail", () => {
    const fresh = rows[2];
    expect(fresh.current_stage).toBe("site_feasibility_survey");
    expect(fresh.payments).toEqual([]);
    expect(fresh.coordinator_ids).toEqual([RAHUL.id]);
  });

  it("ships a sale shared by two coordinators, with a sum for its price and an incentive each — one part still to pay", () => {
    const shared = rows[3];
    expect(shared.coordinator_ids).toEqual([RAHUL.id, PRIYA.id]);
    expect(shared.total_cost).toBe(258500);
    expect(shared.incentives).toEqual([
      {
        coordinator_id: RAHUL.id,
        amount: 15000,
        payments: [{ amount: 12000, paid_on: "2026-03-20", note: null }],
      },
      {
        coordinator_id: PRIYA.id,
        amount: 8000,
        payments: [{ amount: 8000, paid_on: "2026-03-20", note: null }],
      },
    ]);
    expect(shared).toMatchObject({ is_completed: true, current_stage: "plant_commissioning" });
  });

  it("ships a custom plan handed over, the ₹800 the customer was short written off with its reason", () => {
    const custom = rows[4];
    expect(custom).toMatchObject({
      plan_type: "custom",
      plant_capacity: "Inverter + panel",
      is_completed: true,
      current_stage: "plant_commissioning",
      feasibility_date: null,
    });
    expect(custom.payments.map((p) => [p.purpose, p.amount])).toEqual([
      ["contract", 22700],
      ["write_off", 800],
    ]);
    expect(custom.payments[1].notes).toMatch(/short at handover/i);
    expect(paymentSummary(withLedger(custom, custom.payments))).toMatchObject({
      balanceDue: 0,
      writtenOff: 800,
    });
  });

  it("ships a refunded sale with its date and remarks, and the money going back as a refund of the ledger", () => {
    const refunded = rows[5];
    expect(refunded).toMatchObject({
      cancellation: "refunded",
      cancelled_on: "2026-02-20",
    });
    expect(refunded.cancellation_remarks).toMatch(/refunded/i);
    expect(refunded.payments.map((p) => [p.purpose, p.amount])).toEqual([
      ["contract", 10000],
      ["refund", 10000],
    ]);
  });

  it("warns that its rows without a consumer number would import again, and nothing else", () => {
    expect(plan.data.warnings).toHaveLength(1);
    expect(plan.data.warnings[0]).toMatch(/^3 rows have no consumer_number/);
    expect(plan.data.notes).toEqual([]);
  });
});
