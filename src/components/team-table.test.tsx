// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { TeamMember } from "@/lib/domain/team";
import { TeamTable } from "./team-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/team",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/loading/loading-context", () => ({
  useLoading: () => ({ trackStart: vi.fn(), trackPromise: <T,>(promise: Promise<T>) => promise }),
}));
vi.mock("@/app/(app)/team/actions", () => ({
  updateTeamMember: vi.fn(),
  updateUserRole: vi.fn(),
  deleteTeamMember: vi.fn(),
}));

// jsdom lacks what Radix Select needs to render its trigger.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const SUPER = { id: "super-1", role: "superadmin" as const };
const ADMIN = { id: "admin-1", role: "admin" as const };

function member(overrides: Partial<TeamMember> & Pick<TeamMember, "id" | "full_name">): TeamMember {
  return {
    phone: null,
    role: "coordinator",
    created_at: "2026-01-01T00:00:00Z",
    email: `${overrides.id}@bsssolar.test`,
    ...overrides,
  };
}

const TEAM: TeamMember[] = [
  member({ id: "super-1", full_name: "BSS SuperAdmin", role: "superadmin" }),
  member({ id: "admin-1", full_name: "BSS Admin", role: "admin" }),
  member({ id: "admin-2", full_name: "Meera Pillai", role: "admin" }),
  member({ id: "ravee-1", full_name: "Ravee Kumar", email: "ravi@bsssolar.invalid" }),
  member({ id: "eng-1", full_name: "Anil Kumar", role: "service_engineer" }),
];

function renderTable(viewer: { id: string; role: "admin" | "superadmin" }, profiles = TEAM) {
  return render(
    <TeamTable
      profiles={profiles}
      viewer={viewer}
      canDelete={viewer.role === "superadmin"}
      server={{ total: profiles.length, page: 1, pageSize: 10 }}
    />,
  );
}

/** The table row for `name`. */
function rowOf(name: string): HTMLElement {
  const row = screen.getAllByRole("row").find((r) => within(r).queryByText(name, { exact: false }));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("TeamTable — the Edit control", () => {
  it("offers an admin Edit on everyone but the Super Admin", () => {
    renderTable(ADMIN);

    expect(within(rowOf("Ravee Kumar")).getByRole("button", { name: "Edit Ravee Kumar" })).toBeVisible();
    expect(within(rowOf("Anil Kumar")).getByRole("button", { name: "Edit Anil Kumar" })).toBeVisible();
    expect(within(rowOf("Meera Pillai")).getByRole("button", { name: "Edit Meera Pillai" })).toBeVisible();
    expect(within(rowOf("BSS Admin")).getByRole("button", { name: "Edit BSS Admin" })).toBeVisible();
    // Nothing of the Super Admin's is an admin's to change.
    expect(within(rowOf("BSS SuperAdmin")).queryByRole("button", { name: /^edit /i })).toBeNull();
  });

  it("offers the Super Admin Edit on every row, their own included", () => {
    renderTable(SUPER);
    for (const { full_name } of TEAM) {
      expect(
        within(rowOf(full_name)).getByRole("button", { name: `Edit ${full_name}` }),
      ).toBeVisible();
    }
  });

  it("puts Edit beside the name, in the first column, where a phone can still reach it", () => {
    renderTable(ADMIN);
    const [first] = within(rowOf("Ravee Kumar")).getAllByRole("cell");
    expect(within(first).getByRole("button", { name: "Edit Ravee Kumar" })).toBeInTheDocument();
  });

  it("keeps Delete to the Super Admin, and separate from Edit", () => {
    const { unmount } = renderTable(ADMIN);
    expect(screen.queryByRole("button", { name: /^delete /i })).toBeNull();
    unmount();

    renderTable(SUPER);
    expect(within(rowOf("Ravee Kumar")).getByRole("button", { name: "Delete Ravee Kumar" })).toBeVisible();
    // Neither themself nor the Super Admin seat can be deleted.
    expect(within(rowOf("BSS SuperAdmin")).queryByRole("button", { name: /^delete /i })).toBeNull();
  });

  it("leaves the role editor as it was: a locked badge for the Super Admin, a picker for the rest", () => {
    renderTable(ADMIN);
    expect(within(rowOf("BSS SuperAdmin")).getByText("Super Admin")).toBeInTheDocument();
    expect(within(rowOf("BSS SuperAdmin")).queryByRole("combobox")).toBeNull();
    expect(within(rowOf("Ravee Kumar")).getByRole("combobox")).toBeInTheDocument();
  });
});

describe("TeamTable — names and sign-in", () => {
  it("shows the corrected name as soon as the page hands the table the new row", () => {
    const { rerender } = renderTable(ADMIN);
    expect(screen.getByText("Ravee Kumar")).toBeInTheDocument();

    const fixed = TEAM.map((m) => (m.id === "ravee-1" ? { ...m, full_name: "Ravi Kumar" } : m));
    rerender(
      <TeamTable
        profiles={fixed}
        viewer={ADMIN}
        server={{ total: fixed.length, page: 1, pageSize: 10 }}
      />,
    );

    expect(screen.queryByText("Ravee Kumar")).toBeNull();
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    // …and the control, and the dialog it opens, are for the new name.
    expect(screen.getByRole("button", { name: "Edit Ravi Kumar" })).toBeInTheDocument();
  });

  it("marks only the accounts that have no sign-in yet", () => {
    renderTable(ADMIN);
    expect(within(rowOf("Ravee Kumar")).getByText("No sign-in yet")).toBeInTheDocument();
    expect(screen.getAllByText("No sign-in yet")).toHaveLength(1);
  });

  it("still marks the signed-in user's own row", () => {
    renderTable(ADMIN);
    expect(within(rowOf("BSS Admin")).getByText("(you)")).toBeInTheDocument();
    expect(within(rowOf("Ravee Kumar")).queryByText("(you)")).toBeNull();
  });

  it("cannot change its own role, as before", () => {
    renderTable(ADMIN);
    expect(within(rowOf("BSS Admin")).getByRole("combobox")).toBeDisabled();
  });
});
