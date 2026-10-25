import { STAGE_LABELS, STAGE_ORDER } from "@/lib/constants";
import type { PlanType, ProjectStage } from "@/lib/types";
import { capacityProblem } from "./capacity";
import { TONES, type StatusRegistry } from "./status";

/**
 * What a sale is: a kW solar plant, or a custom plan.
 *
 * A custom plan ("1 panel", "Inverter + panel") is not a plant KSEB registers,
 * so it has no kW (the database leaves `plant_capacity_kw` NULL), no KSEB
 * registration estimate, no feasibility date and a single milestone —
 * "Handover". Everything else about a sale (payments, incentives, service
 * tickets, cancellation) is unchanged. The plan label lives in
 * `work_orders.plant_capacity`, so every surface that prints a capacity already
 * prints what a custom plan sold.
 *
 * The plan is fixed once the work order has a project (the milestones are
 * seeded from it), so nothing here ever has to reconcile a changed plan.
 */

export const PLAN_TYPES = ["solar", "custom"] as const satisfies readonly PlanType[];

export const PLAN_TYPE: StatusRegistry<PlanType> = {
  solar: { label: "Solar plant", badgeClass: TONES.amber },
  custom: { label: "Custom plan", badgeClass: TONES.indigo },
};

/** Longest plan label a custom plan may carry ("What was sold"). */
export const PLAN_LABEL_MAX = 120;

/** The only milestone of a custom plan, and the last of a solar plant's. */
export const HANDOVER_STAGE: ProjectStage = "plant_commissioning";

const CUSTOM_LABEL_PROBLEM = `Describe what was sold (up to ${PLAN_LABEL_MAX} characters), e.g. 1 panel or Inverter + panel.`;

export function isPlanType(value: string | null | undefined): value is PlanType {
  return value === "solar" || value === "custom";
}

export function isCustomPlan(p: { plan_type?: PlanType | null }): boolean {
  return p.plan_type === "custom";
}

/**
 * Whether the plan goes through KSEB (registration, feasibility, the eight
 * KSEB-driven stages). Rows from before plans existed carry none: solar.
 */
export function hasKsebProcess(plan: PlanType | null | undefined): boolean {
  return plan !== "custom";
}

/**
 * The milestones a project of this plan is seeded with, in order. Mirrors
 * `seed_project_milestones()` (migration 20261022120100); plan.test.ts reads
 * the migration and fails when the two drift. Change both together.
 */
export function stagesFor(plan: PlanType): ProjectStage[] {
  return plan === "custom" ? [HANDOVER_STAGE] : [...STAGE_ORDER];
}

/** The stage's name for this plan: a custom plan's only step is "Handover". */
export function stageLabel(
  stage: ProjectStage,
  plan: PlanType | null | undefined,
): string {
  return plan === "custom" && stage === HANDOVER_STAGE ? "Handover" : STAGE_LABELS[stage];
}

/** What finishing the project is called. */
export function completionLabel(
  plan: PlanType | null | undefined,
): "Commissioned" | "Handed over" {
  return plan === "custom" ? "Handed over" : "Commissioned";
}

/**
 * Why a plan label is not acceptable, or null.
 *
 * Solar: it must read as a kW capacity (`capacityProblem`; an unchanged legacy
 * label — `opts.previous` — still passes). Custom: free text of 1 to
 * `PLAN_LABEL_MAX` characters.
 */
export function planLabelProblem(
  plan: PlanType,
  label: string,
  opts: { previous?: string | null } = {},
): string | null {
  if (plan === "solar") return capacityProblem(label, opts);
  const text = label.trim();
  return text.length >= 1 && text.length <= PLAN_LABEL_MAX ? null : CUSTOM_LABEL_PROBLEM;
}
