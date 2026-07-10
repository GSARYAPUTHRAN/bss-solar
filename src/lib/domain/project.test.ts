import { describe, it, expect } from "vitest";
import { deriveProjectStage, projectProgress } from "./project";
import type { StageMilestone } from "./project";

const M = (
  stage: string,
  sort_order: number,
  status: "pending" | "in_progress" | "completed",
): StageMilestone => ({
  stage: stage as StageMilestone["stage"],
  sort_order,
  status,
});

describe("deriveProjectStage", () => {
  it("returns null for an empty milestone set", () => {
    expect(deriveProjectStage([])).toBeNull();
  });

  it("points to the first stage when nothing is started", () => {
    const res = deriveProjectStage([
      M("site_feasibility_survey", 1, "pending"),
      M("kseb_portal_registration", 2, "pending"),
    ]);
    expect(res).toEqual({
      currentStage: "site_feasibility_survey",
      isCompleted: false,
    });
  });

  it("points to the first NON-completed (active) stage, not the furthest touched", () => {
    // stage 1 completed, stage 2 in_progress, stage 3 pending -> active is 2.
    const res = deriveProjectStage([
      M("site_feasibility_survey", 1, "completed"),
      M("kseb_portal_registration", 2, "in_progress"),
      M("kseb_feasibility_clearance", 3, "pending"),
    ]);
    expect(res?.currentStage).toBe("kseb_portal_registration");
    expect(res?.isCompleted).toBe(false);
  });

  it("does not jump ahead when a later milestone was touched out of order", () => {
    // stage 1 pending but stage 3 in_progress -> active must still be stage 1.
    const res = deriveProjectStage([
      M("site_feasibility_survey", 1, "pending"),
      M("kseb_portal_registration", 2, "pending"),
      M("kseb_feasibility_clearance", 3, "in_progress"),
    ]);
    expect(res?.currentStage).toBe("site_feasibility_survey");
  });

  it("marks complete and uses the last stage when all milestones are done", () => {
    const res = deriveProjectStage([
      M("site_feasibility_survey", 1, "completed"),
      M("plant_commissioning", 9, "completed"),
    ]);
    expect(res).toEqual({ currentStage: "plant_commissioning", isCompleted: true });
  });

  it("handles unsorted input", () => {
    const res = deriveProjectStage([
      M("kseb_portal_registration", 2, "pending"),
      M("site_feasibility_survey", 1, "completed"),
    ]);
    expect(res?.currentStage).toBe("kseb_portal_registration");
  });
});

describe("projectProgress", () => {
  it("counts completed milestones over the total", () => {
    expect(
      projectProgress({
        milestones: [
          { status: "completed" },
          { status: "completed" },
          { status: "pending" },
        ],
      }),
    ).toEqual({ done: 2, total: 3, pct: 67 });
  });

  it("falls back to the 9-stage denominator when milestones are absent", () => {
    const p = projectProgress({ milestones: null });
    expect(p.done).toBe(0);
    expect(p.total).toBe(9); // PROJECT_STAGES.length, never a stale magic 8
    expect(p.pct).toBe(0);
  });
});
