// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isPlanFilter, isProjectStatusFilter } from "@/lib/domain/project-list";
import { RAHUL, projectListRow } from "@/components/projects/project-list-row.fixture";
import { ProjectsTable } from "./projects-table";

const { replace } = vi.hoisted(() => ({ replace: vi.fn<(url: string) => void>() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams("view=list"),
}));
vi.mock("@/lib/loading/loading-context", () => ({ useLoading: () => ({ trackStart: vi.fn() }) }));

// jsdom lacks what Radix Select needs to open its list.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => replace.mockClear());

function renderServerTable(props: Partial<Parameters<typeof ProjectsTable>[0]> = {}) {
  return render(
    <ProjectsTable
      projects={[projectListRow()]}
      coordinators={[{ id: RAHUL, full_name: "Rahul Menon" }]}
      isAdmin
      viewerId={RAHUL}
      server={{ total: 33, page: 1, pageSize: 10 }}
      {...props}
    />,
  );
}

/** The query the table navigates to after choosing `option` in the filter named `filter`. */
async function choose(filter: string, option: string): Promise<URLSearchParams> {
  renderServerTable();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: filter }));
  await user.click(await screen.findByRole("option", { name: option }));
  const [url] = replace.mock.calls.at(-1) ?? [];
  if (!url) throw new Error("the table did not navigate");
  return new URL(url, "http://bss.test").searchParams;
}

/** The list's filters are URL parameters; the repository only understands these values. */
describe("ProjectsTable — server-side filters", () => {
  it("puts the status in the URL as the closed filter the repository knows", async () => {
    const params = await choose("Status", "Cancelled or refunded");
    expect(params.get("status")).toBe("closed");
    expect(isProjectStatusFilter(params.get("status"))).toBe(true);
  });

  it("puts a refunded status in the URL", async () => {
    expect((await choose("Status", "Refunded")).get("status")).toBe("refunded");
  });

  it("puts the plan in the URL", async () => {
    const params = await choose("Plan", "Custom plan");
    expect(params.get("plan")).toBe("custom");
    expect(isPlanFilter(params.get("plan"))).toBe(true);
    // The tab the list is on survives the change.
    expect(params.get("view")).toBe("list");
  });

  it("puts the picked coordinator's id in the URL", async () => {
    expect((await choose("Coordinator", "Rahul Menon")).get("coordinator")).toBe(RAHUL);
  });
});

describe("ProjectsTable — server footer", () => {
  it("shows the real total", () => {
    renderServerTable();
    expect(screen.getByText("Showing 1–10 of 33 projects")).toBeInTheDocument();
  });

  it("uses the noun it is given", () => {
    renderServerTable({ noun: "latest projects" });
    expect(screen.getByText("Showing 1–10 of 33 latest projects")).toBeInTheDocument();
  });
});
