import { describe, it, expect } from "vitest";
import {
  completionStamp,
  FEASIBILITY_CAPTURE_STAGE,
  isNewlyCompleted,
  progressEvents,
  shouldCaptureFeasibility,
} from "./project-progress";

const NOW = "2026-10-10T08:00:00.000Z";
const EARLIER = "2026-09-01T05:30:00.000Z";

describe("completionStamp", () => {
  it("stamps now when something becomes completed", () => {
    expect(completionStamp(null, true, NOW)).toBe(NOW);
  });

  it("keeps the original instant when an already-completed record is re-saved", () => {
    // A note edit on a commissioned project must not move completed_at — it
    // stops the feasibility clock.
    expect(completionStamp(EARLIER, true, NOW)).toBe(EARLIER);
  });

  it("clears the stamp when the record is no longer completed", () => {
    expect(completionStamp(EARLIER, false, NOW)).toBeNull();
    expect(completionStamp(null, false, NOW)).toBeNull();
  });
});

describe("isNewlyCompleted", () => {
  it.each([
    ["pending", "completed", true],
    ["in_progress", "completed", true],
    ["completed", "completed", false],
    ["pending", "in_progress", false],
    ["completed", "pending", false],
  ] as const)("%s → %s is %s", (before, after, expected) => {
    expect(isNewlyCompleted(before, after)).toBe(expected);
  });
});

describe("shouldCaptureFeasibility", () => {
  const base = {
    stage: FEASIBILITY_CAPTURE_STAGE,
    newlyCompleted: true,
    feasibilityDate: null,
  };

  it("captures when feasibility clearance is just completed and no date is set", () => {
    expect(shouldCaptureFeasibility(base)).toBe(true);
  });

  it("never overwrites a date the office already entered", () => {
    expect(shouldCaptureFeasibility({ ...base, feasibilityDate: "2026-09-20" })).toBe(false);
  });

  it("ignores re-saves of an already-completed clearance", () => {
    expect(shouldCaptureFeasibility({ ...base, newlyCompleted: false })).toBe(false);
  });

  it("ignores every other milestone", () => {
    expect(shouldCaptureFeasibility({ ...base, stage: "kseb_portal_registration" })).toBe(
      false,
    );
  });
});

describe("progressEvents", () => {
  const change = {
    actorId: "admin-1",
    project: { id: "p-1", coordinatorId: "coord-1", clientName: "Anand Kumar" },
  };

  it("announces a newly completed milestone to the coordinator", () => {
    expect(
      progressEvents({ ...change, completedStage: "material_dispatch", commissioned: false }),
    ).toEqual([
      {
        type: "project.milestone_completed",
        actorId: "admin-1",
        coordinatorId: "coord-1",
        projectId: "p-1",
        clientName: "Anand Kumar",
        stage: "material_dispatch",
      },
    ]);
  });

  it("announces commissioning once, superseding the final milestone's notice", () => {
    expect(
      progressEvents({ ...change, completedStage: "plant_commissioning", commissioned: true }),
    ).toEqual([
      {
        type: "project.commissioned",
        actorId: "admin-1",
        coordinatorId: "coord-1",
        projectId: "p-1",
        clientName: "Anand Kumar",
      },
    ]);
  });

  it("is silent when nothing was completed", () => {
    expect(progressEvents({ ...change, completedStage: null, commissioned: false })).toEqual(
      [],
    );
  });
});
