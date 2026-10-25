// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/projects/actions", () => ({
  setProjectCancellation: vi.fn(),
  reinstateProject: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { ProjectDetail } from "@/server/data/projects.repository";
import { ClosedProjectBanner, ProjectStatusSection } from "./project-status-section";

const TODAY = "2026-10-10";

function project(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    work_order_id: "wo1",
    current_stage: "material_dispatch",
    is_completed: false,
    started_at: "2026-08-01T05:00:00Z",
    completed_at: null,
    created_at: "2026-08-01T05:00:00Z",
    updated_at: "2026-08-01T05:00:00Z",
    feasibility_date: "2026-09-01",
    cancellation: null,
    cancelled_on: null,
    cancelled_by: null,
    cancellation_remarks: null,
    cancelled_by_name: null,
    coordinators: [],
    milestones: [],
    work_order: {
      id: "wo1",
      coordinator_id: "c1",
      client_name: "Anand Kumar",
      client_phone: null,
      address: null,
      plant_capacity: "3kW",
      plan_type: "solar",
      plant_capacity_kw: 3,
      advance_amount: 20000,
      total_cost: 195000,
      order_date: "2026-08-01",
      status: "approved",
      consumer_number: null,
      notes: null,
      kseb_section: null,
      financing_type: "self",
      loan_bank_name: null,
      created_at: "2026-08-01T05:00:00Z",
      updated_at: "2026-08-01T05:00:00Z",
    },
    ...over,
  };
}

const REFUNDED = {
  cancellation: "refunded",
  cancelled_on: "2026-02-12",
  cancelled_by: "admin-1",
  cancelled_by_name: "BSS Admin",
  cancellation_remarks: "Refunded ₹50,000 by bank transfer on 14 Feb",
} as const;

const OFFICE_PROPS = {
  today: TODAY,
  money: { received: 120000, balanceDue: 75000 },
  unpaid: { count: 0, total: 0 },
  clockImpact: null,
};

describe("ProjectStatusSection — live project", () => {
  it("offers to mark it cancelled or refunded, and nothing about reinstating", () => {
    render(<ProjectStatusSection project={project()} {...OFFICE_PROPS} />);
    expect(screen.getByText("Project status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark cancelled" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark refunded" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reinstate" })).not.toBeInTheDocument();
    expect(screen.queryByText(/recorded by/i)).not.toBeInTheDocument();
  });

  it("opens the dialog on the outcome of the button pressed", async () => {
    const user = userEvent.setup();
    render(<ProjectStatusSection project={project()} {...OFFICE_PROPS} />);
    await user.click(screen.getByRole("button", { name: "Mark refunded" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Refunded" })).toBeChecked();
  });

  it("keeps the remarks of an earlier cancellation as notes", () => {
    render(
      <ProjectStatusSection
        project={project({ cancellation_remarks: "Refunded in full, then came back" })}
        {...OFFICE_PROPS}
      />,
    );
    expect(screen.getByText("Notes from the earlier cancellation")).toBeInTheDocument();
    expect(screen.getByText("Refunded in full, then came back")).toBeInTheDocument();
  });
});

describe("ProjectStatusSection — cancelled or refunded", () => {
  it("shows the status, date, who recorded it and the remarks", () => {
    render(<ProjectStatusSection project={project(REFUNDED)} {...OFFICE_PROPS} />);

    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("12 Feb 2026")).toBeInTheDocument();
    // Whoever entered it in the app — never worded as "cancelled by".
    expect(screen.getByText("Recorded by")).toBeInTheDocument();
    expect(screen.getByText("BSS Admin")).toBeInTheDocument();
    expect(screen.queryByText(/cancelled by/i)).not.toBeInTheDocument();
    expect(screen.getByText("Refunded ₹50,000 by bank transfer on 14 Feb")).toBeInTheDocument();
  });

  it("offers Edit and Reinstate, not the cancel buttons", () => {
    render(<ProjectStatusSection project={project(REFUNDED)} {...OFFICE_PROPS} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reinstate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark cancelled" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark refunded" })).not.toBeInTheDocument();
  });

  it("admits when nobody recorded the date (an import that did not know it)", () => {
    render(
      <ProjectStatusSection
        project={project({ ...REFUNDED, cancelled_on: null, feasibility_date: null })}
        {...OFFICE_PROPS}
      />,
    );
    expect(screen.getByText("date not recorded")).toBeInTheDocument();
  });

  it("leaves out 'Recorded by' when the recorder is unknown, and says so about empty remarks", () => {
    render(
      <ProjectStatusSection
        project={project({
          ...REFUNDED,
          cancelled_by: null,
          cancelled_by_name: null,
          cancellation_remarks: null,
        })}
        {...OFFICE_PROPS}
      />,
    );
    expect(screen.queryByText("Recorded by")).not.toBeInTheDocument();
    expect(screen.getByText("No remarks")).toBeInTheDocument();
  });

  it("editing an unrecorded date offers it blank", async () => {
    const user = userEvent.setup();
    render(
      <ProjectStatusSection
        project={project({ ...REFUNDED, cancelled_on: null, feasibility_date: null })}
        {...OFFICE_PROPS}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/cancelled on/i)).toHaveValue("");
  });

  it("reinstating a solar plant offers a fresh feasibility date and the cost of the old clock", async () => {
    const user = userEvent.setup();
    render(
      <ProjectStatusSection
        project={project(REFUNDED)}
        {...OFFICE_PROPS}
        clockImpact={{ feasibilityDate: "2026-01-12", costNow: 1000, costReopened: 4000 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/new feasibility date/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("note")).toHaveTextContent(/12 Jan 2026/);
  });

  it("reinstating a custom plan offers no feasibility date", async () => {
    const user = userEvent.setup();
    const custom = project(REFUNDED);
    custom.work_order = { ...custom.work_order!, plan_type: "custom", plant_capacity: "Inverter + panel" };
    render(<ProjectStatusSection project={custom} {...OFFICE_PROPS} />);
    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/new feasibility date/i)).not.toBeInTheDocument();
  });
});

describe("ClosedProjectBanner (what the sale's coordinators see)", () => {
  it("is a read-only notice with the date and remarks — no buttons", () => {
    render(<ClosedProjectBanner project={project(REFUNDED)} />);
    expect(screen.getByRole("status")).toHaveTextContent("This project was refunded on 12 Feb 2026.");
    expect(screen.getByText("Refunded ₹50,000 by bank transfer on 14 Feb")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // Who recorded it is the office's business.
    expect(screen.queryByText(/recorded by/i)).not.toBeInTheDocument();
  });

  it("says when the date was not recorded", () => {
    render(
      <ClosedProjectBanner
        project={project({ ...REFUNDED, cancellation: "cancelled", cancelled_on: null, cancellation_remarks: null })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "This project was cancelled (date not recorded).",
    );
  });

  it("is absent on a live project, even one with notes from an earlier cancellation", () => {
    const { container } = render(
      <ClosedProjectBanner project={project({ cancellation_remarks: "Refunded once" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
