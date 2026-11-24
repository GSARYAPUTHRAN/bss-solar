// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { REPORT_TABS, ReportsNav, activeReportTab } from "./reports-nav";

const { path } = vi.hoisted(() => ({ path: { current: "/reports" } }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

function renderAt(pathname: string) {
  path.current = pathname;
  return render(<ReportsNav />);
}

describe("activeReportTab", () => {
  it.each([
    ["/reports", "/reports"],
    ["/reports/", "/reports"],
    ["/reports/services", "/reports/services"],
    ["/reports/services/", "/reports/services"],
    ["/reports/services/anything", "/reports/services"],
  ])("puts %s under %s", (pathname, tab) => {
    expect(activeReportTab(pathname)).toBe(tab);
  });

  it("does not claim look-alike paths", () => {
    expect(activeReportTab("/reports/servicesx")).toBeNull();
    expect(activeReportTab("/reports/other")).toBeNull();
    expect(activeReportTab("/")).toBeNull();
  });
});

describe("ReportsNav", () => {
  it("links to the monthly report and the services summary, in that order", () => {
    renderAt("/reports");
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Monthly report", "Services"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      REPORT_TABS.map((t) => t.href),
    );
    expect(screen.getByRole("navigation", { name: "Reports" })).toBeInTheDocument();
  });

  it("marks the monthly report current on /reports", () => {
    renderAt("/reports");
    expect(screen.getByRole("link", { name: "Monthly report" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Services" })).not.toHaveAttribute("aria-current");
  });

  it("marks Services current on /reports/services", () => {
    renderAt("/reports/services");
    expect(screen.getByRole("link", { name: "Services" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Monthly report" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps every tab at least 40px tall for touch", () => {
    renderAt("/reports");
    for (const link of screen.getAllByRole("link")) expect(link.className).toContain("h-10");
  });
});
