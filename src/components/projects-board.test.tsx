// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ARUN,
  PRIYA,
  RAHUL,
  projectListRow,
  sharedSale,
} from "@/components/projects/project-list-row.fixture";
import type { ProjectListRow } from "@/lib/types";
import { ProjectsBoard } from "./projects-board";

// jsdom lacks what Radix Select needs to open its list.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const COORDINATORS = [
  { id: RAHUL, full_name: "Rahul Menon" },
  { id: PRIYA, full_name: "Priya Suresh" },
  { id: ARUN, full_name: "Arun Krishnan" },
];

const LIVE = projectListRow({ client_name: "Live Sale", current_stage: "panel_installation" });
const COMMISSIONED = projectListRow({
  id: "2",
  client_name: "Commissioned Sale",
  current_stage: "plant_commissioning",
  is_completed: true,
});
const CANCELLED = projectListRow({
  id: "3",
  client_name: "Cancelled Sale",
  current_stage: "material_dispatch",
  cancellation: "cancelled",
});
const REFUNDED = projectListRow({
  id: "4",
  client_name: "Refunded Sale",
  current_stage: "wcr_submitted",
  cancellation: "refunded",
});
const CUSTOM = projectListRow({
  id: "5",
  client_name: "Custom Sale",
  plan_type: "custom",
  plant_capacity: "Inverter + panel",
  current_stage: "plant_commissioning",
  milestones_done: 0,
  milestones_total: 1,
});
const ALL = [LIVE, COMMISSIONED, CANCELLED, REFUNDED, CUSTOM];

function renderBoard(
  projects: ProjectListRow[] = ALL,
  props: Partial<Parameters<typeof ProjectsBoard>[0]> = {},
) {
  return render(
    <ProjectsBoard
      projects={projects}
      coordinators={COORDINATORS}
      isAdmin
      viewerId={RAHUL}
      {...props}
    />,
  );
}

function lane(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

/** Names of the projects on the board, whatever lane they are in. */
function onBoard(): string[] {
  return ALL.map((p) => p.client_name as string).filter((name) => screen.queryByText(name));
}

async function pickStatus(option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Project status" }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("ProjectsBoard — status", () => {
  it("shows only active projects until asked for more, so closed ones stay off the board", () => {
    renderBoard();
    expect(onBoard()).toEqual(["Live Sale", "Custom Sale"]);
    expect(screen.getByRole("combobox", { name: "Project status" })).toHaveTextContent("Active");
  });

  it("offers every status the list does, then all projects", async () => {
    renderBoard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Project status" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Active",
      "Commissioned",
      "Commissioned · payment pending",
      "Cancelled",
      "Refunded",
      "Cancelled or refunded",
      "All projects",
    ]);
  });

  it("keeps a cancelled project out of Commissioned", async () => {
    renderBoard([COMMISSIONED, projectListRow({ id: "9", client_name: "Gone", is_completed: true, cancellation: "refunded" })]);
    await pickStatus("Commissioned");
    expect(screen.queryByText("Commissioned Sale")).toBeInTheDocument();
    expect(screen.queryByText("Gone")).toBeNull();
  });

  it("shows the refunded projects", async () => {
    renderBoard();
    await pickStatus("Refunded");
    expect(onBoard()).toEqual(["Refunded Sale"]);
    // The card says so.
    expect(within(lane("WCR Submitted to KSEB")).getByText("Refunded")).toBeInTheDocument();
  });

  it("shows cancelled and refunded projects together", async () => {
    renderBoard();
    await pickStatus("Cancelled or refunded");
    expect(onBoard()).toEqual(["Cancelled Sale", "Refunded Sale"]);
  });

  it("shows everything under All projects", async () => {
    renderBoard();
    await pickStatus("All projects");
    expect(onBoard()).toEqual(ALL.map((p) => p.client_name));
  });

  it("counts the projects in view", async () => {
    renderBoard();
    expect(screen.getByText("2 projects")).toBeInTheDocument();
    await pickStatus("Refunded");
    expect(screen.getByText("1 project")).toBeInTheDocument();
  });
});

describe("ProjectsBoard — custom plans", () => {
  it("gives custom plans a lane of their own, ahead of stage 1", () => {
    renderBoard();
    const custom = lane("Custom plans");
    expect(within(custom).getByText("Custom Sale")).toBeInTheDocument();
    expect(within(custom).getByText("1")).toBeInTheDocument();

    const lanes = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(lanes[0]).toBe("Custom plans");
    expect(lanes[1]).toBe("Site Feasibility Survey");
  });

  it("does not also put a custom plan in the stage it is stored at", () => {
    renderBoard();
    expect(within(lane("Plant Commissioning")).queryByText("Custom Sale")).toBeNull();
    expect(within(lane("Plant Commissioning")).getByText("Empty")).toBeInTheDocument();
  });

  it("keeps solar projects in their stage lane", () => {
    renderBoard();
    expect(within(lane("Panel Installation")).getByText("Live Sale")).toBeInTheDocument();
    expect(within(lane("Custom plans")).queryByText("Live Sale")).toBeNull();
  });

  it("has no custom lane while nothing in view is a custom plan", () => {
    renderBoard([LIVE, COMMISSIONED]);
    expect(screen.queryByRole("region", { name: "Custom plans" })).toBeNull();
  });

  it("holds a finished or refunded custom plan too, once they are in view", async () => {
    const handedOver = projectListRow({
      id: "6",
      client_name: "Handed Over Sale",
      plan_type: "custom",
      plant_capacity: "1 panel",
      is_completed: true,
    });
    const refunded = projectListRow({
      id: "7",
      client_name: "Refunded Custom",
      plan_type: "custom",
      plant_capacity: "Inverter",
      cancellation: "refunded",
    });
    renderBoard([CUSTOM, handedOver, refunded]);
    await pickStatus("All projects");
    const custom = lane("Custom plans");
    expect(within(custom).getByText("Handed Over Sale")).toBeInTheDocument();
    expect(within(custom).getByText("Refunded Custom")).toBeInTheDocument();
    expect(within(custom).getByText("3")).toBeInTheDocument();
  });

  it("marks the cards as custom plans", () => {
    renderBoard();
    expect(within(lane("Custom plans")).getByText("Custom plan")).toBeInTheDocument();
  });
});

describe("ProjectsBoard — coordinators", () => {
  const RAHUL_ALONE = projectListRow({ client_name: "Rahul Alone" });
  const TOGETHER = sharedSale({ id: "2", client_name: "Together" });
  const ARUN_ALONE = projectListRow({
    id: "3",
    client_name: "Arun Alone",
    coordinator_ids: [ARUN],
    coordinator_names: ["Arun Krishnan"],
  });

  it("shows the office everyone on a shared sale", () => {
    renderBoard([TOGETHER]);
    expect(screen.getByText("Rahul Menon & Priya Suresh")).toBeInTheDocument();
  });

  it("tells a coordinator who they share a sale with", () => {
    renderBoard([TOGETHER, RAHUL_ALONE], { isAdmin: false, viewerId: RAHUL });
    expect(screen.getByText("with Priya Suresh")).toBeInTheDocument();
    expect(screen.queryByText(/Rahul Menon/)).toBeNull();
  });

  it("tells a coordinator who they share a custom plan with, too", () => {
    renderBoard([sharedSale({ id: "9", client_name: "Shared Custom", plan_type: "custom" })], {
      isAdmin: false,
      viewerId: PRIYA,
    });
    expect(within(lane("Custom plans")).getByText("with Rahul Menon")).toBeInTheDocument();
  });

  it("filters by any member of the sale, not only its first coordinator", async () => {
    renderBoard([RAHUL_ALONE, TOGETHER, ARUN_ALONE]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Coordinator" }));
    await user.click(await screen.findByRole("option", { name: "Priya Suresh" }));
    expect(screen.queryByText("Together")).toBeInTheDocument();
    expect(screen.queryByText("Rahul Alone")).toBeNull();
    expect(screen.queryByText("Arun Alone")).toBeNull();
  });

  it("has no coordinator filter for a coordinator", () => {
    renderBoard([RAHUL_ALONE], { isAdmin: false, viewerId: RAHUL });
    expect(screen.queryByRole("combobox", { name: "Coordinator" })).toBeNull();
  });
});
