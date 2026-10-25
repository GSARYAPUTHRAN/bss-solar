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
    expect(
      completionStamp({ wasCompleted: false, previous: null, completed: true, now: NOW }),
    ).toBe(NOW);
  });

  it("keeps the original instant when an already-completed record is re-saved", () => {
    // A note edit on a commissioned project must not move completed_at — it
    // stops the feasibility clock.
    expect(
      completionStamp({ wasCompleted: true, previous: EARLIER, completed: true, now: NOW }),
    ).toBe(EARLIER);
  });

  it("never invents a date for an already-completed record that has none", () => {
    // An imported commissioned project (or milestone) is completed with the
    // date "not recorded"; saving a note on it must not stamp the day of the edit.
    expect(
      completionStamp({ wasCompleted: true, previous: null, completed: true, now: NOW }),
    ).toBeNull();
  });

  it("clears the stamp when the record is no longer completed", () => {
    expect(
      completionStamp({ wasCompleted: true, previous: EARLIER, completed: false, now: NOW }),
    ).toBeNull();
    expect(
      completionStamp({ wasCompleted: false, previous: null, completed: false, now: NOW }),
    ).toBeNull();
  });

  it("stamps again when a reopened record is completed anew", () => {
    // Reopened (stamp cleared), then completed: a real transition.
    expect(
      completionStamp({ wasCompleted: false, previous: null, completed: true, now: NOW }),
    ).toBe(NOW);
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
    project: {
      id: "p-1",
      coordinatorIds: ["coord-1"],
      clientName: "Anand Kumar",
      planType: "solar",
    },
  } as const;

  it("announces a newly completed milestone to the coordinator", () => {
    expect(
      progressEvents({ ...change, completedStage: "material_dispatch", commissioned: false }),
    ).toEqual([
      {
        type: "project.milestone_completed",
        actorId: "admin-1",
        coordinatorIds: ["coord-1"],
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
        coordinatorIds: ["coord-1"],
        projectId: "p-1",
        clientName: "Anand Kumar",
        planType: "solar",
      },
    ]);
  });

  it("carries the plan, so a custom plan is announced as handed over", () => {
    const [event] = progressEvents({
      ...change,
      project: { ...change.project, planType: "custom" },
      completedStage: "plant_commissioning",
      commissioned: true,
    });
    expect(event).toMatchObject({ type: "project.commissioned", planType: "custom" });
  });

  it("names every coordinator of a shared sale", () => {
    const project = { ...change.project, coordinatorIds: ["coord-1", "coord-2"] };
    const events = [
      ...progressEvents({ ...change, project, completedStage: "material_dispatch", commissioned: false }),
      ...progressEvents({ ...change, project, completedStage: "plant_commissioning", commissioned: true }),
    ];
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({ coordinatorIds: ["coord-1", "coord-2"] });
    }
  });

  it("is silent when nothing was completed", () => {
    expect(progressEvents({ ...change, completedStage: null, commissioned: false })).toEqual(
      [],
    );
  });
});
