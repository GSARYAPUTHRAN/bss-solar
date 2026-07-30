import { describe, it, expect } from "vitest";
import { IMPORT_HEADERS, IMPORT_TEMPLATE, normalizeStage, parseImportRecord } from "./import";
import { parseCsvRecords } from "@/lib/csv";
import { paymentSummary } from "./payment";

describe("normalizeStage", () => {
  it("accepts a stage value", () => {
    expect(normalizeStage("material_dispatch")).toBe("material_dispatch");
  });
  it("accepts a human label (case-insensitive)", () => {
    expect(normalizeStage("Plant Commissioning")).toBe("plant_commissioning");
  });
  it("defaults empty to the first stage", () => {
    expect(normalizeStage("")).toBe("site_feasibility_survey");
  });
  it("returns null for an unknown stage", () => {
    expect(normalizeStage("nonsense")).toBeNull();
  });
});

describe("parseImportRecord", () => {
  const base = {
    client_name: "Anand Kumar",
    plant_capacity: "3kW",
    total_cost: "195000",
    order_date: "2026-01-15",
    current_stage: "material_dispatch",
  };

  it("parses a valid record", () => {
    const res = parseImportRecord(base);
    expect("data" in res).toBe(true);
    if ("data" in res) {
      expect(res.data.client_name).toBe("Anand Kumar");
      expect(res.data.total_cost).toBe(195000);
      expect(res.data.current_stage).toBe("material_dispatch");
      expect(res.data.is_completed).toBe(false);
      expect(res.data.advance_amount).toBe(0);
    }
  });

  it("requires client_name / plant_capacity / valid total", () => {
    expect(parseImportRecord({ ...base, client_name: "" })).toHaveProperty("error");
    expect(parseImportRecord({ ...base, plant_capacity: "" })).toHaveProperty("error");
    expect(parseImportRecord({ ...base, total_cost: "abc" })).toHaveProperty("error");
    expect(parseImportRecord({ ...base, total_cost: "-5" })).toHaveProperty("error");
  });

  it("rejects a malformed date", () => {
    expect(parseImportRecord({ ...base, order_date: "15/01/2026" })).toHaveProperty(
      "error",
    );
  });

  it("forces stage to plant_commissioning when is_completed", () => {
    const res = parseImportRecord({ ...base, is_completed: "true", current_stage: "material_dispatch" });
    expect("data" in res && res.data.is_completed).toBe(true);
    expect("data" in res && res.data.current_stage).toBe("plant_commissioning");
  });

  it("rejects an unknown stage", () => {
    expect(parseImportRecord({ ...base, current_stage: "bogus" })).toHaveProperty(
      "error",
    );
  });
});

describe("parseImportRecord — consumer / KSEB / loan / payment columns", () => {
  const base = {
    client_name: "Anand Kumar",
    plant_capacity: "3kW",
    total_cost: "195000",
    order_date: "2026-01-15",
    current_stage: "material_dispatch",
  };

  it("carries every new column through", () => {
    const res = parseImportRecord({
      ...base,
      advance_amount: "20000",
      consumer_number: "1156789012345",
      kseb_section: "Vytilla",
      loan_bank_name: "State Bank of India",
      notes: "Scaffolding needed",
      first_payment_amount: "80000",
      first_payment_date: "2026-02-10",
      second_payment_amount: "50000",
      second_payment_date: "2026-03-10",
    });
    expect("data" in res).toBe(true);
    if (!("data" in res)) return;
    expect(res.data.consumer_number).toBe("1156789012345");
    expect(res.data.kseb_section).toBe("Vytilla");
    expect(res.data.loan_bank_name).toBe("State Bank of India");
    expect(res.data.notes).toBe("Scaffolding needed");
    expect(res.data.first_payment_amount).toBe(80000);
    expect(res.data.first_payment_date).toBe("2026-02-10");
    expect(res.data.second_payment_amount).toBe(50000);
    expect(res.data.second_payment_date).toBe("2026-03-10");
    // The row feeds the payment maths directly.
    expect(paymentSummary(res.data).received).toBe(150000);
    expect(paymentSummary(res.data).balanceDue).toBe(45000);
  });

  it("leaves blank optional columns null rather than zero", () => {
    const res = parseImportRecord(base);
    expect("data" in res).toBe(true);
    if (!("data" in res)) return;
    expect(res.data.consumer_number).toBeNull();
    expect(res.data.kseb_section).toBeNull();
    expect(res.data.loan_bank_name).toBeNull();
    expect(res.data.notes).toBeNull();
    expect(res.data.first_payment_amount).toBeNull();
    expect(res.data.first_payment_date).toBeNull();
    expect(res.data.second_payment_amount).toBeNull();
    expect(res.data.second_payment_date).toBeNull();
  });

  it("rejects a negative or non-numeric instalment", () => {
    expect(
      parseImportRecord({ ...base, first_payment_amount: "-1" }),
    ).toHaveProperty("error");
    expect(
      parseImportRecord({ ...base, second_payment_amount: "soon" }),
    ).toHaveProperty("error");
  });

  it("rejects a malformed instalment date", () => {
    expect(
      parseImportRecord({ ...base, first_payment_date: "10/02/2026" }),
    ).toHaveProperty("error");
    expect(
      parseImportRecord({ ...base, second_payment_date: "2026-2-10" }),
    ).toHaveProperty("error");
  });
});

describe("IMPORT_TEMPLATE", () => {
  it("stays parseable and aligned with the documented headers", () => {
    const parsed = parseCsvRecords(IMPORT_TEMPLATE);
    expect("records" in parsed).toBe(true);
    if (!("records" in parsed)) return;
    expect(parsed.records).toHaveLength(2);
    for (const record of parsed.records) {
      expect(Object.keys(record)).toEqual([...IMPORT_HEADERS]);
      expect(parseImportRecord(record)).toHaveProperty("data");
    }
  });

  it("ships a commissioned-but-unpaid example (the flagged business case)", () => {
    const parsed = parseCsvRecords(IMPORT_TEMPLATE);
    if (!("records" in parsed)) throw new Error("template did not parse");
    const rows = parsed.records
      .map(parseImportRecord)
      .flatMap((r) => ("data" in r ? [r.data] : []));
    const flagged = rows.filter(
      (r) => r.is_completed && paymentSummary(r).balanceDue > 0,
    );
    expect(flagged).toHaveLength(1);
  });
});
