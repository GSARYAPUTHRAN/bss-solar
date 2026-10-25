// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ setWorkOrderCoordinators: vi.fn() }));
vi.mock("@/app/(app)/work-orders/actions", () => actions);
vi.mock("./use-desktop", () => ({ useIsDesktop: () => false }));

import { CoordinatorsDialog } from "./coordinators-dialog";
import type { DirectoryPerson } from "./coordinators-field";

const DIRECTORY: DirectoryPerson[] = [
  { id: "admin-id", full_name: "BSS Admin", role: "admin" },
  { id: "rahul-id", full_name: "Rahul Menon", role: "coordinator" },
  { id: "priya-id", full_name: "Priya Suresh", role: "coordinator" },
  { id: "arun-id", full_name: "Arun Krishnan", role: "coordinator" },
];
const TEAM = [
  { id: "rahul-id", full_name: "Rahul Menon" },
  { id: "priya-id", full_name: "Priya Suresh" },
];
const OFFICE = { id: "admin-id", full_name: "BSS Admin", role: "admin" as const };
const COORDINATOR = { id: "rahul-id", full_name: "Rahul Menon", role: "coordinator" as const };

/** The `coordinator_ids` the action was sent, in order. */
function sentIds(): string[] {
  const data = actions.setWorkOrderCoordinators.mock.calls[0][0] as FormData;
  return data.getAll("coordinator_ids").map(String);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CoordinatorsDialog — the office", () => {
  function renderOffice() {
    return render(
      <CoordinatorsDialog
        workOrderId="wo-1"
        mode="office"
        coordinators={TEAM}
        directory={DIRECTORY}
        viewer={OFFICE}
      />,
    );
  }

  it("opens as Change coordinators, with the explanation the office needs", async () => {
    const user = userEvent.setup();
    renderOffice();
    await user.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change coordinators" });
    expect(dialog).toHaveTextContent(
      "Everyone listed sees this sale, can edit its details and gets its updates. People you remove lose access and are told. Clear a coordinator's incentive before removing them.",
    );
    // Everyone on the sale, in order, each removable.
    expect(within(dialog).getByRole("button", { name: "Remove Rahul Menon" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Remove Priya Suresh" })).toBeEnabled();
    expect(within(dialog).getByRole("group", { name: "Coordinators" })).toBeInTheDocument();
  });

  it("sends the new list in order, with the work order's id, and closes", async () => {
    const user = userEvent.setup();
    renderOffice();
    await user.click(screen.getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Change coordinators" });

    // Swap Priya for Arun.
    await user.click(within(dialog).getByRole("button", { name: "Remove Priya Suresh" }));
    await user.click(within(dialog).getByRole("button", { name: "Add coordinator" }));
    const sheet = await screen.findByRole("dialog", { name: "Add coordinator" });
    await user.click(within(sheet).getByRole("button", { name: /arun krishnan/i }));
    await user.click(within(dialog).getByRole("button", { name: "Save coordinators" }));

    await waitFor(() => expect(actions.setWorkOrderCoordinators).toHaveBeenCalledTimes(1));
    const data = actions.setWorkOrderCoordinators.mock.calls[0][0] as FormData;
    expect(data.get("id")).toBe("wo-1");
    expect(sentIds()).toEqual(["rahul-id", "arun-id"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("starts from the saved team again each time it is opened", async () => {
    const user = userEvent.setup();
    renderOffice();
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove Priya Suresh" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove Priya Suresh" }),
    ).toBeInTheDocument();
    expect(actions.setWorkOrderCoordinators).not.toHaveBeenCalled();
  });
});

describe("CoordinatorsDialog — the coordinator who logged a pending order", () => {
  function renderFirst() {
    return render(
      <CoordinatorsDialog
        workOrderId="wo-1"
        mode="add"
        coordinators={[TEAM[0]]}
        directory={DIRECTORY}
        viewer={COORDINATOR}
      />,
    );
  }

  it("opens as Add a partner: nobody can be taken off", async () => {
    const user = userEvent.setup();
    renderFirst();
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a partner" });
    expect(dialog).toHaveTextContent(
      "Your partner will see and edit this work order and get its updates. Only the office can remove someone.",
    );
    expect(within(dialog).getByText("You")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^remove/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^move/i })).not.toBeInTheDocument();
  });

  it("sends the existing team first, then the new partner", async () => {
    const user = userEvent.setup();
    renderFirst();
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a partner" });
    await user.click(within(dialog).getByRole("button", { name: "Add partner" }));
    const sheet = await screen.findByRole("dialog", { name: "Add partner" });
    await user.click(within(sheet).getByRole("button", { name: /priya suresh/i }));
    await user.click(within(dialog).getByRole("button", { name: "Save partners" }));

    await waitFor(() => expect(actions.setWorkOrderCoordinators).toHaveBeenCalledTimes(1));
    expect(sentIds()).toEqual(["rahul-id", "priya-id"]);
  });
});
