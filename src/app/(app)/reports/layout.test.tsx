// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** The Reports shell: office only, one heading, the tabs, then the page. */

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("next/navigation", () => ({ usePathname: () => "/reports/services" }));

import ReportsLayout from "./layout";

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ id: "admin", role: "admin" });
});

describe("ReportsLayout", () => {
  it("heads every Reports page and links between them", async () => {
    render(await ReportsLayout({ children: <p>the page</p> }));
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Monthly report" })).toHaveAttribute("href", "/reports");
    expect(screen.getByRole("link", { name: "Services" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("the page")).toBeInTheDocument();
  });

  it("turns away anyone who is not office staff", async () => {
    requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(ReportsLayout({ children: <p>the page</p> })).rejects.toThrow("NEXT_REDIRECT");
  });
});
