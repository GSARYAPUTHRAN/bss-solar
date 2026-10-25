import { describe, it, expect } from "vitest";
import { parseCsvRecords } from "@/lib/csv";
import { todayISO } from "@/lib/format";
import { CoordinatorDirectory } from "./coordinator-match";
import { IMPORT_HEADERS, planImport, validateImportHeaders } from "./import";
import { IMPORT_TEMPLATE } from "./import-template";
import { ledgerTotals, paymentSummary } from "./payment";

/** After every date in the template; the template is validated as of this day. */
const TODAY = "2026-10-10";

// The people the template names, as the demo accounts are: Rahul by e-mail too.
const RAHUL = { id: "id-rahul", fullName: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" as const };
const PRIYA = { id: "id-priya", fullName: "Priya Suresh", email: "priya@bsssolar.test", role: "coordinator" as const };
const DIRECTORY = new CoordinatorDirectory([RAHUL, PRIYA]);

/** No default coordinator: every row must stand on its own. */
const options = (today: string) => ({ today, directory: DIRECTORY, defaultCoordinatorId: null });

describe("IMPORT_TEMPLATE", () => {
  const plan = planImport(IMPORT_TEMPLATE, options(TODAY));
  if (!plan.ok) throw new Error(`template rejected: ${plan.error}`);
  const rows = plan.data.rows.map((r) => {
    if (!r.parsed.ok) throw new Error(`template row ${r.rowNo}: ${r.parsed.error}`);
    return r.parsed.data;
  });

  it("parses with the documented columns and four payment groups", () => {
    const csv = parseCsvRecords(IMPORT_TEMPLATE);
    if ("error" in csv) throw new Error(csv.error);
    expect(csv.headers.slice(0, IMPORT_HEADERS.length)).toEqual([...IMPORT_HEADERS]);
    expect(validateImportHeaders(csv.headers)).toMatchObject({
      ok: true,
      data: { paymentSlots: [1, 2, 3, 4] },
    });
  });

  it("validates every row with zero errors, against a directory, with no default coordinator", () => {
    expect(rows).toHaveLength(6);
    expect(plan.data.coordinatorMatches.every((m) => m.account !== null)).toBe(true);
    expect(plan.data.rows.every((r) => !r.defaulted)).toBe(true);
  });

  it("is valid on the day it is downloaded (no example dated in the future)", () => {
    const now = planImport(IMPORT_TEMPLATE, options(todayISO()));
    expect(now.ok && now.data.rows.every((r) => r.parsed.ok)).toBe(true);
  });

  it("ships an in-progress bank-loan project paid in four stages", () => {
    const loan = rows[0];
    expect(loan.financing_type).toBe("loan");
    expect(loan.is_completed).toBe(false);
    expect(loan.feasibility_date).not.toBeNull();
    expect(loan.payments).toHaveLength(4);
    expect(loan.payments.some((p) => p.purpose === "kseb_fees")).toBe(true);
    expect(loan.incentives).toEqual([{ coordinator_id: RAHUL.id, amount: 5000, paid_on: null }]);
  });

  it("ships a commissioned self-financed project with a balance still due", () => {
    const due = rows[1];
    expect(due.financing_type).toBe("self");
    expect(due.is_completed).toBe(true);
    expect(due.commissioned_on).not.toBeNull();
    const { balanceDue } = paymentSummary({
      total_cost: due.total_cost,
      advance_amount: due.advance_amount,
      payments_total: ledgerTotals(due.payments).contract,
    });
    expect(balanceDue).toBe(50000);
    expect(due.incentives[0]).toMatchObject({ coordinator_id: PRIYA.id, paid_on: "2026-05-20" });
  });

  it("ships a fresh project that names its coordinator by e-mail", () => {
    const fresh = rows[2];
    expect(fresh.current_stage).toBe("site_feasibility_survey");
    expect(fresh.payments).toEqual([]);
    expect(fresh.coordinator_ids).toEqual([RAHUL.id]);
  });

  it("ships a sale shared by two coordinators, with a sum for its price and no incentive", () => {
    const shared = rows[3];
    expect(shared.coordinator_ids).toEqual([RAHUL.id, PRIYA.id]);
    expect(shared.total_cost).toBe(258500);
    expect(shared.incentives).toEqual([]);
    expect(shared).toMatchObject({ is_completed: true, current_stage: "plant_commissioning" });
  });

  it("ships a custom plan handed over", () => {
    const custom = rows[4];
    expect(custom).toMatchObject({
      plan_type: "custom",
      plant_capacity: "Inverter + panel",
      is_completed: true,
      current_stage: "plant_commissioning",
      feasibility_date: null,
    });
  });

  it("ships a refunded sale with its date and remarks", () => {
    const refunded = rows[5];
    expect(refunded).toMatchObject({
      cancellation: "refunded",
      cancelled_on: "2026-02-20",
    });
    expect(refunded.cancellation_remarks).toMatch(/refunded/i);
    expect(refunded.payments).toHaveLength(1);
  });

  it("warns that its rows without a consumer number would import again, and nothing else", () => {
    expect(plan.data.warnings).toHaveLength(1);
    expect(plan.data.warnings[0]).toMatch(/^3 rows have no consumer_number/);
  });
});
