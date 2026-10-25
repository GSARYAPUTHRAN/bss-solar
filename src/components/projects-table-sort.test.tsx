// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROJECT_SORT_COLUMNS, isProjectSortColumn } from "@/lib/domain/project-list";
import { RAHUL, projectListRow } from "@/components/projects/project-list-row.fixture";
import { ProjectsTable } from "./projects-table";

const { replace } = vi.hoisted(() => ({ replace: vi.fn<(url: string) => void>() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/loading/loading-context", () => ({ useLoading: () => ({ trackStart: vi.fn() }) }));

const PROJECT = projectListRow();

/**
 * The repository validates `?sort=` against PROJECT_SORT_COLUMNS and silently
 * falls back to the newest-first order for anything else. A sortable column
 * whose key is not in the list would therefore look broken (it never sorts),
 * which is how "Incentive" would have stayed on the old column after the view
 * moved to `incentive_total`.
 */
describe("ProjectsTable — server-side sorting", () => {
  beforeEach(() => replace.mockClear());

  function renderServerTable() {
    render(
      <ProjectsTable
        projects={[PROJECT]}
        coordinators={[]}
        isAdmin
        viewerId={RAHUL}
        server={{ total: 1, page: 1, pageSize: 25 }}
      />,
    );
  }

  it("asks for a sort the repository accepts from every sortable column", async () => {
    const user = userEvent.setup();
    renderServerTable();

    const headers = screen.getAllByRole("button", { name: /^Sort by / });
    expect(headers.length).toBeGreaterThanOrEqual(5);
    for (const header of headers) await user.click(header);

    expect(replace).toHaveBeenCalledTimes(headers.length);
    const sorts = replace.mock.calls.map(([url]) =>
      new URL(url, "http://bss.test").searchParams.get("sort"),
    );
    for (const sort of sorts) {
      expect(isProjectSortColumn(sort), `"${sort}" is not a project sort column`).toBe(true);
    }
  });

  it("sorts the Incentive column by the sale's incentive total", async () => {
    const user = userEvent.setup();
    renderServerTable();

    await user.click(screen.getByRole("button", { name: /^sort by incentive$/i }));

    const [url] = replace.mock.calls[0];
    expect(new URL(url, "http://bss.test").searchParams.get("sort")).toBe("incentive_total");
    expect(PROJECT_SORT_COLUMNS).toContain("incentive_total");
  });
});
