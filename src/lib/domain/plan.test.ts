import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/constants";
import { CAPACITY_PROBLEM } from "./capacity";
import {
  HANDOVER_STAGE,
  PLAN_LABEL_MAX,
  PLAN_TYPE,
  PLAN_TYPES,
  completionLabel,
  hasKsebProcess,
  isCustomPlan,
  isPlanType,
  planLabelProblem,
  stageLabel,
  stagesFor,
} from "./plan";

const CUSTOM_PROBLEM =
  "Describe what was sold (up to 120 characters), e.g. 1 panel or Inverter + panel.";

describe("PLAN_TYPES / PLAN_TYPE", () => {
  it("offers solar and custom, each with a label and a badge", () => {
    expect([...PLAN_TYPES]).toEqual(["solar", "custom"]);
    expect(PLAN_TYPE.solar.label).toBe("Solar plant");
    expect(PLAN_TYPE.custom.label).toBe("Custom plan");
    for (const plan of PLAN_TYPES) expect(PLAN_TYPE[plan].badgeClass).toMatch(/^bg-/);
  });

  it("bounds a custom label at 120 characters", () => {
    expect(PLAN_LABEL_MAX).toBe(120);
  });
});

describe("isPlanType / isCustomPlan / hasKsebProcess", () => {
  it("recognises only the two plan values", () => {
    expect(isPlanType("solar")).toBe(true);
    expect(isPlanType("custom")).toBe(true);
    for (const v of ["", "Solar", "other", null, undefined]) expect(isPlanType(v)).toBe(false);
  });

  it("calls a row custom only when it says so", () => {
    expect(isCustomPlan({ plan_type: "custom" })).toBe(true);
    expect(isCustomPlan({ plan_type: "solar" })).toBe(false);
    expect(isCustomPlan({ plan_type: null })).toBe(false);
    expect(isCustomPlan({})).toBe(false);
  });

  it("gives every plan but custom (and rows from before plans) the KSEB process", () => {
    expect(hasKsebProcess("solar")).toBe(true);
    expect(hasKsebProcess(null)).toBe(true);
    expect(hasKsebProcess(undefined)).toBe(true);
    expect(hasKsebProcess("custom")).toBe(false);
  });
});

describe("stagesFor", () => {
  it("is the nine KSEB stages for solar, in order", () => {
    expect(stagesFor("solar")).toEqual(STAGE_ORDER);
    expect(stagesFor("solar")).toHaveLength(9);
  });

  it("is the single Handover stage for a custom plan", () => {
    expect(stagesFor("custom")).toEqual(["plant_commissioning"]);
    expect(stagesFor("custom")).toEqual([HANDOVER_STAGE]);
  });

  it("returns a copy a caller may change", () => {
    stagesFor("solar").pop();
    stagesFor("custom").pop();
    expect(stagesFor("solar")).toHaveLength(9);
    expect(stagesFor("custom")).toHaveLength(1);
  });

  it("ends every plan on its completion stage", () => {
    expect(stagesFor("solar").at(-1)).toBe(HANDOVER_STAGE);
    expect(stagesFor("custom").at(-1)).toBe(HANDOVER_STAGE);
  });
});

describe("seed_project_milestones() parity", () => {
  // The function exists twice: the migration that made it plan-aware, and the
  // fresh-provisioning schema. Both must seed what stagesFor() says.
  const FILES = [
    "supabase/migrations/20261022120100_custom_plans_and_cancellation.sql",
    "supabase/schema.sql",
  ];

  function seedFunction(sql: string): string {
    const start = sql.search(
      /create or replace function (?:public\.)?seed_project_milestones\(\)/i,
    );
    expect(start, "seed_project_milestones() not found").toBeGreaterThanOrEqual(0);
    const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
    // Without its comments, which may say "else" too.
    return sql.slice(start, end).replace(/--.*$/gm, "");
  }

  /** The `(new.id, 'stage', n)` rows of a SQL fragment, in text order. */
  function seeded(fragment: string): { stage: string; sort: number }[] {
    return [...fragment.matchAll(/\(\s*new\.id\s*,\s*'([a-z_]+)'\s*,\s*(\d+)\s*\)/g)].map(
      (m) => ({ stage: m[1], sort: Number(m[2]) }),
    );
  }

  it.each(FILES)("%s seeds the solar and custom milestones of stagesFor()", (file) => {
    const body = seedFunction(readFileSync(join(process.cwd(), file), "utf8"));
    const custom = body.search(/=\s*'custom'\s*then/i);
    const otherwise = body.search(/\belse\b/i);
    expect(custom).toBeGreaterThanOrEqual(0);
    expect(otherwise).toBeGreaterThan(custom);

    const customRows = seeded(body.slice(custom, otherwise));
    const solarRows = seeded(body.slice(otherwise));

    expect(solarRows.map((r) => r.stage)).toEqual(stagesFor("solar"));
    expect(solarRows.map((r) => r.sort)).toEqual(stagesFor("solar").map((_, i) => i + 1));
    expect(customRows.map((r) => r.stage)).toEqual(stagesFor("custom"));
    // The custom step keeps the position it has in the full process.
    expect(customRows.map((r) => r.sort)).toEqual([STAGE_ORDER.indexOf(HANDOVER_STAGE) + 1]);
  });
});

describe("stageLabel / completionLabel", () => {
  it("names a custom plan's only step Handover", () => {
    expect(stageLabel("plant_commissioning", "custom")).toBe("Handover");
  });

  it("keeps the KSEB names for solar, for rows from before plans, and for other stages", () => {
    for (const stage of STAGE_ORDER) {
      expect(stageLabel(stage, "solar")).toBe(STAGE_LABELS[stage]);
      expect(stageLabel(stage, null)).toBe(STAGE_LABELS[stage]);
      expect(stageLabel(stage, undefined)).toBe(STAGE_LABELS[stage]);
    }
    // A custom plan never reaches another stage; if one did, it reads as itself.
    expect(stageLabel("panel_installation", "custom")).toBe(STAGE_LABELS.panel_installation);
  });

  it("says handed over for a custom plan and commissioned for the rest", () => {
    expect(completionLabel("custom")).toBe("Handed over");
    expect(completionLabel("solar")).toBe("Commissioned");
    expect(completionLabel(null)).toBe("Commissioned");
    expect(completionLabel(undefined)).toBe("Commissioned");
  });
});

describe("planLabelProblem", () => {
  describe("solar", () => {
    it.each(["3kW", "5 kWp", "3000W", "3kW+inverter", "3", "3.5"])("accepts %j", (label) => {
      expect(planLabelProblem("solar", label)).toBeNull();
    });

    it.each(["1 panel", "Inverter+panel", "", "0 kW"])(
      "refuses %j and points to Custom plan",
      (label) => {
        expect(planLabelProblem("solar", label)).toBe(CAPACITY_PROBLEM);
        expect(CAPACITY_PROBLEM).toMatch(/Custom plan/);
      },
    );

    it("lets an unchanged legacy label through, but not an edit of it", () => {
      expect(planLabelProblem("solar", "1 panel", { previous: "1 panel" })).toBeNull();
      expect(planLabelProblem("solar", "2 panels", { previous: "1 panel" })).toBe(
        CAPACITY_PROBLEM,
      );
    });
  });

  describe("custom", () => {
    it.each(["1 panel", "Inverter + panel", "x", "a".repeat(PLAN_LABEL_MAX)])(
      "accepts %j",
      (label) => {
        expect(planLabelProblem("custom", label)).toBeNull();
      },
    );

    it("needs 1 to 120 characters once trimmed", () => {
      for (const label of ["", "   "]) {
        expect(planLabelProblem("custom", label)).toBe(CUSTOM_PROBLEM);
      }
      expect(planLabelProblem("custom", "a".repeat(PLAN_LABEL_MAX + 1))).toBe(CUSTOM_PROBLEM);
      // Surrounding spaces are not part of the label.
      expect(planLabelProblem("custom", ` ${"a".repeat(PLAN_LABEL_MAX)} `)).toBeNull();
    });

    it("does not apply the kW rule — a custom label need not name a capacity", () => {
      expect(planLabelProblem("custom", "1 panel")).toBeNull();
      expect(planLabelProblem("custom", "Inverter+panel")).toBeNull();
    });
  });
});
