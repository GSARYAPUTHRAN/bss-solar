// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/(app)/projects/actions", () => ({ updateProjectSettings: vi.fn() }));

import { ProjectSettingsForm } from "./project-settings-form";

describe("ProjectSettingsForm", () => {
  it("is the feasibility date alone — each person's incentive has its own form", () => {
    const { container } = render(
      <ProjectSettingsForm projectId="p1" feasibilityDate="2026-09-01" today="2026-10-10" />,
    );

    const date = screen.getByLabelText(/kseb feasibility date/i);
    expect(date).toHaveValue("2026-09-01");
    expect(date).toHaveAttribute("max", "2026-10-10");
    expect(screen.getByRole("button", { name: /save settings/i })).toBeInTheDocument();

    // The legacy single incentive is gone from this form.
    expect(screen.queryByLabelText(/incentive/i)).not.toBeInTheDocument();
    expect(container.querySelector('[name="coordinator_incentive"]')).toBeNull();
    expect(container.querySelector('[name="incentive_paid_on"]')).toBeNull();
    expect(container.querySelector('[name="project_id"]')).toHaveValue("p1");
  });
});
