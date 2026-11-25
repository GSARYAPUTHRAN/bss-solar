// @vitest-environment jsdom
// The Team page: the table gets the viewer (it works out who may be deleted),
// and the notes say who may delete whom.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { requireAdmin, page, accounts } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  page: vi.fn(),
  accounts: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/server/data", () => ({ profilesRepository: { page, accounts } }));
// A client table of its own, with its own tests.
vi.mock("@/components/team-table", () => ({
  TeamTable: (props: { viewer: { id: string; role: string }; profiles: { email: string | null }[] }) => (
    <div
      data-testid="team"
      data-viewer={`${props.viewer.id}:${props.viewer.role}`}
      data-emails={props.profiles.map((p) => p.email ?? "").join(",")}
    />
  ),
}));

import { deleteRolesLabel } from "@/lib/domain/role";
import type { Profile } from "@/lib/types";
import TeamPage from "./page";

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;
const SUPERADMIN = { id: "super-1", role: "superadmin", full_name: "BSS SuperAdmin" } as Profile;

async function renderPage(profile: Profile) {
  requireAdmin.mockResolvedValue(profile);
  return render(await TeamPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  page.mockResolvedValue({
    rows: [{ id: "c1", full_name: "Rahul Menon", role: "coordinator", phone: null, created_at: "" }],
    total: 1,
    page: 1,
    pageSize: 10,
  });
  accounts.mockResolvedValue({
    accounts: [{ id: "c1", fullName: "Rahul Menon", email: "coord@bsssolar.test", role: "coordinator" }],
    error: null,
  });
});

describe("the Team page", () => {
  it.each([
    ["an admin", ADMIN],
    ["the Super Admin", SUPERADMIN],
  ])("hands the table %s as the viewer, with sign-in e-mails joined on", async (_who, profile) => {
    await renderPage(profile);
    expect(screen.getByTestId("team")).toHaveAttribute(
      "data-viewer",
      `${profile.id}:${profile.role}`,
    );
    expect(screen.getByTestId("team")).toHaveAttribute("data-emails", "coord@bsssolar.test");
  });

  it("says who may delete, and who may delete whom", async () => {
    await renderPage(ADMIN);
    expect(
      screen.getByText(new RegExp(`is\\s+for ${deleteRolesLabel()} only, and cannot be undone`)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Admins can delete coordinators and service engineers; only the Super Admin can delete an admin\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nobody can delete the Super Admin/)).toBeInTheDocument();
  });

  it("says an admin's role is the Super Admin's to change", async () => {
    await renderPage(ADMIN);
    expect(screen.getByText(/Only the\s+Super Admin can change an admin's role\./)).toBeInTheDocument();
  });

  it("no longer says deleting is the Super Admin's alone", async () => {
    await renderPage(ADMIN);
    expect(screen.queryByText(/only role that can delete/i)).toBeNull();
    expect(screen.getByText(/not editable here by anyone/)).toBeInTheDocument();
  });
});
