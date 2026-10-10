import { describe, it, expect } from "vitest";
import { parseCsvRecords } from "@/lib/csv";
import { todayISO } from "@/lib/format";
import { IMPORT_HEADERS, planImport, validateImportHeaders } from "./import";
import { IMPORT_TEMPLATE } from "./import-template";
import { ledgerTotals, paymentSummary } from "./payment";

/** After every date in the template; the template is validated as of this day. */
const TODAY = "2026-10-10";

describe("IMPORT_TEMPLATE", () => {
  const plan = planImport(IMPORT_TEMPLATE, TODAY);
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

  it("validates every row with zero errors", () => {
    expect(rows).toHaveLength(3);
  });

  it("is valid on the day it is downloaded (no example dated in the future)", () => {
    const now = planImport(IMPORT_TEMPLATE, todayISO());
    expect(now.ok && now.data.rows.every((r) => r.parsed.ok)).toBe(true);
  });

  it("ships an in-progress bank-loan project paid in four stages", () => {
    const loan = rows[0];
    expect(loan.financing_type).toBe("loan");
    expect(loan.is_completed).toBe(false);
    expect(loan.feasibility_date).not.toBeNull();
    expect(loan.payments).toHaveLength(4);
    expect(loan.payments.some((p) => p.purpose === "kseb_fees")).toBe(true);
  });

  it("ships a commissioned self-financed project with a balance still due", () => {
    const due = rows[1];
    expect(due.financing_type).toBe("self");
    expect(due.is_completed).toBe(true);
    expect(due.commissioned_on).not.toBeNull();
    const { balanceDue } = paymentSummary({
      ...due,
      payments_total: ledgerTotals(due.payments).contract,
    });
    expect(balanceDue).toBe(50000);
  });

  it("ships a fresh project with only the required columns", () => {
    const fresh = rows[2];
    expect(fresh.current_stage).toBe("site_feasibility_survey");
    expect(fresh.payments).toEqual([]);
    expect(fresh.coordinator_email).toBeNull();
  });
});
