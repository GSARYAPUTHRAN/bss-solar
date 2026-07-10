import { describe, it, expect } from "vitest";
import { normalizeStage, parseImportRecord } from "./import";

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
