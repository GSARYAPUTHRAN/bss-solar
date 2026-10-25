// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROJECT_LIST_FILTER_KEYS } from "@/lib/domain/project-list";
import { ProjectsTabs } from "./projects-tabs";

const { replace, search } = vi.hoisted(() => ({
  replace: vi.fn<(url: string, opts?: unknown) => void>(),
  search: { current: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(search.current),
}));

function renderTabs(view: string, query: string) {
  search.current = query;
  return render(
    <ProjectsTabs view={view} board={<p>the board</p>} list={<p>the list</p>} />,
  );
}

function lastUrl(): URL {
  const [url] = replace.mock.calls.at(-1) ?? [];
  if (!url) throw new Error("the tabs did not navigate");
  return new URL(url, "http://bss.test");
}

beforeEach(() => replace.mockClear());

describe("ProjectsTabs", () => {
  it("shows the board unless the list is asked for", () => {
    renderTabs("board", "");
    expect(screen.getByText("the board")).toBeInTheDocument();
    expect(screen.queryByText("the list")).toBeNull();
  });

  it("shows the list for ?view=list", () => {
    renderTabs("list", "view=list");
    expect(screen.getByText("the list")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the list in the URL, keeping what is already there", async () => {
    renderTabs("board", "foo=bar");
    await userEvent.setup().click(screen.getByRole("tab", { name: "List" }));
    expect(lastUrl().pathname).toBe("/projects");
    expect(lastUrl().searchParams.get("view")).toBe("list");
    expect(lastUrl().searchParams.get("foo")).toBe("bar");
  });

  it("clears every list filter, the plan and status ones included, when leaving the list", async () => {
    const filters = Object.fromEntries(PROJECT_LIST_FILTER_KEYS.map((k) => [k, "x"]));
    renderTabs(
      "list",
      new URLSearchParams({
        view: "list",
        ...filters,
        q: "anand",
        sort: "incentive_total",
        dir: "desc",
        page: "3",
        size: "50",
        foo: "bar",
      }).toString(),
    );
    expect(PROJECT_LIST_FILTER_KEYS).toContain("plan");

    await userEvent.setup().click(screen.getByRole("tab", { name: "Board" }));

    const params = lastUrl().searchParams;
    expect([...params.keys()]).toEqual(["foo"]);
  });
});
