// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/projects/actions", () => ({ updateMilestone: vi.fn() }));

import type { ProjectMilestone } from "@/lib/types";
import { MilestoneTimeline } from "./milestone-timeline";

function milestone(over: Partial<ProjectMilestone>): ProjectMilestone {
  return {
    id: "m",
    project_id: "p1",
    stage: "site_feasibility_survey",
    sort_order: 1,
    status: "pending",
    notes: null,
    completed_at: null,
    ...over,
  };
}

const SOLAR = [
  milestone({
    id: "m1",
    stage: "site_feasibility_survey",
    sort_order: 1,
    status: "completed",
    completed_at: "2026-08-02T05:00:00Z",
  }),
  milestone({ id: "m3", stage: "kseb_feasibility_clearance", sort_order: 3 }),
  milestone({ id: "m9", stage: "plant_commissioning", sort_order: 9 }),
];

const HANDOVER = [milestone({ id: "h", stage: "plant_commissioning", sort_order: 9 })];

describe("MilestoneTimeline", () => {
  it("a solar plant's last step is Plant Commissioning", () => {
    render(
      <MilestoneTimeline
        projectId="p1"
        milestones={SOLAR}
        plan="solar"
        canEdit={false}
        feasibilityCaptured={false}
      />,
    );
    expect(screen.getByText("Site Feasibility Survey")).toBeInTheDocument();
    expect(screen.getByText("Plant Commissioning")).toBeInTheDocument();
    expect(screen.queryByText("Handover")).not.toBeInTheDocument();
  });

  it("a custom plan has one step, Handover", () => {
    render(
      <MilestoneTimeline
        projectId="p1"
        milestones={HANDOVER}
        plan="custom"
        canEdit={false}
        feasibilityCaptured={false}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Handover")).toBeInTheDocument();
    expect(screen.queryByText("Plant Commissioning")).not.toBeInTheDocument();
  });

  it("the office edits each step in place, labelled by the plan's name for it", () => {
    render(
      <MilestoneTimeline
        projectId="p1"
        milestones={HANDOVER}
        plan="custom"
        canEdit
        feasibilityCaptured={false}
      />,
    );
    expect(screen.getByLabelText("Status for Handover")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes for Handover")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("read-only (everyone else, or a cancelled project) has no forms at all", () => {
    render(
      <MilestoneTimeline
        projectId="p1"
        milestones={SOLAR}
        plan="solar"
        canEdit={false}
        feasibilityCaptured={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Status for/)).not.toBeInTheDocument();
  });

  it("warns that clearing KSEB feasibility starts the clock", () => {
    render(
      <MilestoneTimeline
        projectId="p1"
        milestones={SOLAR}
        plan="solar"
        canEdit
        feasibilityCaptured={false}
      />,
    );
    expect(screen.getByText(/records today as the KSEB feasibility/i)).toBeInTheDocument();
  });
});
