// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PRIYA, RAHUL, projectListRow } from "@/components/projects/project-list-row.fixture";
import type { UserRole } from "@/lib/types";

/**
 * What the project tracker hands its board and list: the viewer (so a shared
 * sale reads "with …"), the coordinator options (office only), the URL filters
 * the repository applies and the incentive summary that matches the viewer.
 */

const { requireWorkOrderRole, board, page, coordinators, incentiveSummary, boardProps, tableProps } =
  vi.hoisted(() => ({
    requireWorkOrderRole: vi.fn(),
    board: vi.fn(),
    page: vi.fn(),
    coordinators: vi.fn(),
    incentiveSummary: vi.fn(),
    boardProps: vi.fn(),
    tableProps: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ requireWorkOrderRole }));
vi.mock("@/server/data", () => ({
  profilesRepository: { coordinators },
  projectsRepository: { board, page, incentiveSummary },
}));
vi.mock("@/components/projects-tabs", () => ({
  ProjectsTabs: ({ view, board, list }: { view: string; board: unknown; list: unknown }) => (
    <>{(view === "list" ? list : board) as React.ReactNode}</>
  ),
}));
vi.mock("@/components/projects-board", () => ({
  ProjectsBoard: (props: unknown) => {
    boardProps(props);
    return <div>the board</div>;
  },
}));
vi.mock("@/components/projects-table", () => ({
  ProjectsTable: (props: unknown) => {
    tableProps(props);
    return <div>the list</div>;
  },
}));

import ProjectsPage from "./page";

const SUMMARY = { projects: 3, pendingProjects: 2, total: 20000, paid: 5000, pending: 15000 };

function signInAs(role: UserRole, id = RAHUL) {
  requireWorkOrderRole.mockResolvedValue({ id, role, full_name: "Someone" });
}

async function renderPage(search: Record<string, string> = {}) {
  render(await ProjectsPage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  board.mockResolvedValue([projectListRow()]);
  page.mockResolvedValue({ rows: [projectListRow()], total: 1, page: 1, pageSize: 10 });
  coordinators.mockResolvedValue([
    { id: RAHUL, full_name: "Rahul Menon" },
    { id: PRIYA, full_name: "Priya Suresh" },
  ]);
  incentiveSummary.mockResolvedValue(SUMMARY);
});

describe("ProjectsPage — board", () => {
  it("gives the office the coordinator options and everyone's incentives", async () => {
    signInAs("admin", "00000000-0000-0000-0000-000000000001");
    await renderPage();

    expect(board).toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();
    expect(boardProps).toHaveBeenCalledWith(
      expect.objectContaining({
        isAdmin: true,
        viewerId: "00000000-0000-0000-0000-000000000001",
        coordinators: expect.arrayContaining([expect.objectContaining({ id: PRIYA })]),
      }),
    );
    expect(incentiveSummary).toHaveBeenCalledWith(null);
    expect(screen.getByRole("region", { name: /coordinator incentives/i })).toBeInTheDocument();
  });

  it("tells a coordinator who they are, loads no coordinator options and sums only their own", async () => {
    signInAs("coordinator", RAHUL);
    await renderPage();

    expect(coordinators).not.toHaveBeenCalled();
    expect(boardProps).toHaveBeenCalledWith(
      expect.objectContaining({ isAdmin: false, viewerId: RAHUL, coordinators: [] }),
    );
    expect(incentiveSummary).toHaveBeenCalledWith(RAHUL);
    expect(screen.getByRole("region", { name: /your incentives/i })).toBeInTheDocument();
    expect(screen.getByText(/sales you logged or share/i)).toBeInTheDocument();
  });

  it("does not describe the office's tracker as a coordinator's own sales", async () => {
    signInAs("admin");
    await renderPage();
    expect(screen.queryByText(/sales you logged or share/i)).toBeNull();
  });
});

describe("ProjectsPage — list", () => {
  it("hands the repository every filter in the URL, plan and closed statuses included", async () => {
    signInAs("admin");
    await renderPage({
      view: "list",
      status: "closed",
      plan: "custom",
      coordinator: PRIYA,
      incentive: "pending",
      sort: "incentive_total",
    });

    expect(board).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "incentive_total",
        filters: {
          status: "closed",
          plan: "custom",
          coordinator: PRIYA,
          incentive: "pending",
        },
      }),
    );
  });

  it("scopes the office's incentive tile to the coordinator the list is filtered to", async () => {
    signInAs("admin");
    await renderPage({ view: "list", coordinator: PRIYA });

    expect(incentiveSummary).toHaveBeenCalledWith(PRIYA);
    expect(screen.getByText(/Priya Suresh · 2 projects awaiting payment/)).toBeInTheDocument();
  });

  it("passes the viewer and the page to the table", async () => {
    signInAs("coordinator", PRIYA);
    await renderPage({ view: "list" });

    expect(tableProps).toHaveBeenCalledWith(
      expect.objectContaining({
        isAdmin: false,
        viewerId: PRIYA,
        server: { total: 1, page: 1, pageSize: 10 },
      }),
    );
    expect(incentiveSummary).toHaveBeenCalledWith(PRIYA);
  });
});
