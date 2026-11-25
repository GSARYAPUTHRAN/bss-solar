// @vitest-environment jsdom
// The work orders list: the way into the duplicate clean-up is for deleters only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { requireWorkOrderRole, page, coordinatorDirectory } = vi.hoisted(() => ({
  requireWorkOrderRole: vi.fn(),
  page: vi.fn(),
  coordinatorDirectory: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireWorkOrderRole }));
vi.mock("@/server/data", () => ({
  workOrdersRepository: { page },
  profilesRepository: { coordinatorDirectory },
}));
// A client table of its own, with its own tests.
vi.mock("@/components/work-orders-table", () => ({
  WorkOrdersTable: (props: { isAdmin: boolean }) => (
    <div data-testid="work-orders" data-admin={String(props.isAdmin)} />
  ),
}));

import type { Profile } from "@/lib/types";
import WorkOrdersPage from "./page";

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;
const SUPERADMIN = { id: "super-1", role: "superadmin", full_name: "BSS SuperAdmin" } as Profile;
const RAHUL = { id: "c1", role: "coordinator", full_name: "Rahul Menon" } as Profile;

async function renderPage(profile: Profile) {
  requireWorkOrderRole.mockResolvedValue(profile);
  return render(await WorkOrdersPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  page.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 10 });
  coordinatorDirectory.mockResolvedValue([]);
});

describe("the work orders page", () => {
  it.each([
    ["an admin", ADMIN],
    ["the Super Admin", SUPERADMIN],
  ])("offers %s Find duplicates, beside New Work Order", async (_who, profile) => {
    await renderPage(profile);
    const link = screen.getByRole("link", { name: /find duplicates/i });
    expect(link).toHaveAttribute("href", "/work-orders/duplicates");
    expect(link).toHaveClass("h-10");
    expect(screen.getByRole("link", { name: /new work order/i })).toBeInTheDocument();
  });

  it("does not offer a coordinator the clean-up", async () => {
    await renderPage(RAHUL);
    expect(screen.queryByRole("link", { name: /find duplicates/i })).toBeNull();
    expect(screen.getByRole("link", { name: /new work order/i })).toBeInTheDocument();
    expect(screen.getByText("Sales you logged or share.")).toBeInTheDocument();
  });
});
