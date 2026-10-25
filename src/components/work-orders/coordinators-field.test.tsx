// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const media = vi.hoisted(() => ({ desktop: false }));
vi.mock("./use-desktop", () => ({ useIsDesktop: () => media.desktop }));

import { CoordinatorsField, type DirectoryPerson } from "./coordinators-field";

const RAHUL = { id: "rahul-id", full_name: "Rahul Menon" };
const PRIYA = { id: "priya-id", full_name: "Priya Suresh" };

const DIRECTORY: DirectoryPerson[] = [
  { id: "admin-id", full_name: "BSS Admin", role: "admin" },
  { ...RAHUL, role: "coordinator" },
  { ...PRIYA, role: "coordinator" },
  { id: "arun-id", full_name: "Arun Krishnan", role: "coordinator" },
  { id: "manu-id", full_name: "Manu Das", role: "coordinator" },
  { id: "sree-id", full_name: "Sreeja Nair", role: "coordinator" },
];

const COORDINATOR = { ...RAHUL, role: "coordinator" as const };
const OFFICE = { id: "admin-id", full_name: "BSS Admin", role: "admin" as const };

/** The ids the form would post, in order. */
function posted(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[name="coordinator_ids"]')].map(
    (input) => input.value,
  );
}

function renderField(props: Partial<React.ComponentProps<typeof CoordinatorsField>> = {}) {
  return render(
    <form>
      <CoordinatorsField directory={DIRECTORY} viewer={COORDINATOR} mode="partners" {...props} />
    </form>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, name: string, trigger: string) {
  await user.click(screen.getByRole("button", { name: trigger }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: new RegExp(name, "i") }));
}

beforeEach(() => {
  media.desktop = false;
});

describe("CoordinatorsField — a coordinator logging a sale", () => {
  it("starts with the coordinator locked in first as You, who cannot be taken off", () => {
    renderField();
    expect(screen.getByRole("group", { name: "Coordinators" })).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(posted()).toEqual(["rahul-id"]);
    expect(screen.queryByRole("button", { name: /^remove/i })).not.toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
  });

  it("adds a partner from the sheet, after the creator, and posts both in order", async () => {
    const user = userEvent.setup();
    renderField();
    await pick(user, "Priya Suresh", "Add partner");

    // The sheet closes with the pick.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(posted()).toEqual(["rahul-id", "priya-id"]);
    expect(screen.getByText("Priya Suresh")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("offers only other coordinators who are not on the sale yet — never an office account", async () => {
    // A partner is not asked and sharing opens their profile to the sale's team, so
    // only the office adds office accounts (the database refuses the rest).
    const user = userEvent.setup();
    renderField({
      directory: [...DIRECTORY, { id: "root-id", full_name: "The Owner", role: "superadmin" }],
    });
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    const dialog = await screen.findByRole("dialog");
    const names = within(dialog)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(names).toEqual(["Priya Suresh", "Arun Krishnan", "Manu Das", "Sreeja Nair"]);
  });

  it("says no one is left when only office accounts remain", async () => {
    const user = userEvent.setup();
    renderField({
      directory: [
        { id: "admin-id", full_name: "BSS Admin", role: "admin" },
        { ...RAHUL, role: "coordinator" },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /bss admin/i })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/already on this one/i)).toBeInTheDocument();
  });

  it("searches the people it offers", async () => {
    const user = userEvent.setup();
    renderField();
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("searchbox", { name: /search coordinators/i }), "kri");
    expect(within(dialog).getByRole("button", { name: /arun krishnan/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /priya/i })).not.toBeInTheDocument();

    await user.type(within(dialog).getByRole("searchbox"), "zzz");
    expect(within(dialog).getByText(/no one matches/i)).toBeInTheDocument();
  });

  it("can take a partner back off before saving", async () => {
    const user = userEvent.setup();
    renderField();
    await pick(user, "Priya Suresh", "Add partner");
    await pick(user, "Arun Krishnan", "Add partner");
    expect(posted()).toEqual(["rahul-id", "priya-id", "arun-id"]);

    await user.click(screen.getByRole("button", { name: "Remove Priya Suresh" }));
    expect(posted()).toEqual(["rahul-id", "arun-id"]);
    // Gone from the list, back in the picker.
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    expect(
      within(await screen.findByRole("dialog")).getByRole("button", { name: /priya suresh/i }),
    ).toBeInTheDocument();
  });

  it("stops at five and says why", async () => {
    const user = userEvent.setup();
    renderField();
    for (const name of ["Priya Suresh", "Arun Krishnan", "Manu Das", "Sreeja Nair"]) {
      await pick(user, name, "Add partner");
    }
    expect(posted()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Add partner" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("A sale can have at most 5 coordinators.");

    // Taking one off frees the slot again.
    await user.click(screen.getByRole("button", { name: "Remove Sreeja Nair" }));
    expect(screen.getByRole("button", { name: "Add partner" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never lets a partner be moved ahead of the creator", async () => {
    const user = userEvent.setup();
    renderField();
    await pick(user, "Priya Suresh", "Add partner");
    expect(screen.queryByRole("button", { name: /^move/i })).not.toBeInTheDocument();
  });

  it("shows the hint under the list", () => {
    renderField({ hint: "Sold together? Add your partners." });
    expect(screen.getByText("Sold together? Add your partners.")).toBeInTheDocument();
  });
});

describe("CoordinatorsField — the office", () => {
  it("is offered everyone, office accounts marked as such", async () => {
    const user = userEvent.setup();
    renderField({
      viewer: OFFICE,
      mode: "full",
      directory: [...DIRECTORY, { id: "root-id", full_name: "The Owner", role: "superadmin" }],
    });
    await user.click(screen.getByRole("button", { name: "Add coordinator" }));
    const dialog = await screen.findByRole("dialog");
    const names = within(dialog)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(names).toEqual([
      "Rahul Menon",
      "Priya Suresh",
      "Arun Krishnan",
      "Manu Das",
      "Sreeja Nair",
      "The OwnerOffice",
    ]);
  });

  it("starts with the office as the first coordinator, shown as (me), and cannot empty the list", async () => {
    const user = userEvent.setup();
    renderField({ viewer: OFFICE, mode: "full" });
    expect(screen.getByText("BSS Admin (me)")).toBeInTheDocument();
    expect(posted()).toEqual(["admin-id"]);
    // The only person cannot be removed.
    expect(screen.getByRole("button", { name: "Remove BSS Admin" })).toBeDisabled();

    await pick(user, "Arun Krishnan", "Add coordinator");
    expect(posted()).toEqual(["admin-id", "arun-id"]);
    await user.click(screen.getByRole("button", { name: "Remove BSS Admin" }));
    // Arun is now the first coordinator and the last one left.
    expect(posted()).toEqual(["arun-id"]);
    expect(screen.getByRole("button", { name: "Remove Arun Krishnan" })).toBeDisabled();
  });

  it("can log the sale for someone else by taking itself off", async () => {
    const user = userEvent.setup();
    renderField({ viewer: OFFICE, mode: "full" });
    await pick(user, "Priya Suresh", "Add coordinator");
    await user.click(screen.getByRole("button", { name: "Remove BSS Admin" }));
    expect(posted()).toEqual(["priya-id"]);
  });

  it("moves someone up so they become the first", async () => {
    const user = userEvent.setup();
    renderField({ viewer: OFFICE, mode: "full" });
    await pick(user, "Priya Suresh", "Add coordinator");
    await pick(user, "Arun Krishnan", "Add coordinator");
    expect(posted()).toEqual(["admin-id", "priya-id", "arun-id"]);

    await user.click(screen.getByRole("button", { name: "Move Arun Krishnan up" }));
    expect(posted()).toEqual(["admin-id", "arun-id", "priya-id"]);
    await user.click(screen.getByRole("button", { name: "Move Arun Krishnan up" }));
    expect(posted()).toEqual(["arun-id", "admin-id", "priya-id"]);
    // The first has nothing above it.
    expect(screen.queryByRole("button", { name: "Move Arun Krishnan up" })).not.toBeInTheDocument();
  });

  it("edits an existing team: everyone can come off, the rest of the list keeps its order", async () => {
    const user = userEvent.setup();
    renderField({
      viewer: OFFICE,
      mode: "full",
      initial: [RAHUL, PRIYA],
      label: "Coordinators",
      hideLabel: true,
    });
    expect(posted()).toEqual(["rahul-id", "priya-id"]);
    await user.click(screen.getByRole("button", { name: "Remove Rahul Menon" }));
    expect(posted()).toEqual(["priya-id"]);
    // A hidden label is still the group's accessible name.
    expect(screen.getByRole("group", { name: "Coordinators" })).toBeInTheDocument();
  });
});

describe("CoordinatorsField — adding partners to a sale that already has people", () => {
  it("keeps who is on it locked, in order, and appends the new partner", async () => {
    const user = userEvent.setup();
    renderField({ initial: [RAHUL, PRIYA], mode: "partners" });
    expect(posted()).toEqual(["rahul-id", "priya-id"]);
    expect(screen.queryByRole("button", { name: /^remove/i })).not.toBeInTheDocument();

    await pick(user, "Arun Krishnan", "Add partner");
    expect(posted()).toEqual(["rahul-id", "priya-id", "arun-id"]);
    // Only the newcomer can still be taken back off.
    expect(screen.getByRole("button", { name: "Remove Arun Krishnan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Priya Suresh" })).not.toBeInTheDocument();
  });
});

describe("CoordinatorsField — the picker on a desktop", () => {
  it("opens a popover instead of the bottom sheet", async () => {
    media.desktop = true;
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const user = userEvent.setup();
    renderField();
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    const panel = await screen.findByRole("dialog");
    expect(panel).toHaveAttribute("data-slot", "popover-content");
    await user.click(within(panel).getByRole("button", { name: /priya suresh/i }));
    expect(posted()).toEqual(["rahul-id", "priya-id"]);
  });

  it("opens a bottom sheet on a phone", async () => {
    const user = userEvent.setup();
    renderField();
    await user.click(screen.getByRole("button", { name: "Add partner" }));
    expect(await screen.findByRole("dialog")).toHaveAttribute("data-slot", "sheet-content");
  });
});
