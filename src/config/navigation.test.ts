import { describe, it, expect } from "vitest";
import { navForRole, homeForRole, MODULES } from "./navigation";

describe("navForRole", () => {
  it("gives admins every module", () => {
    const hrefs = navForRole("admin").map((m) => m.href);
    expect(hrefs).toEqual(MODULES.map((m) => m.href));
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/team");
    expect(hrefs).toContain("/tickets");
  });

  it("restricts coordinators to their own modules", () => {
    const hrefs = navForRole("coordinator").map((m) => m.href);
    expect(hrefs).toContain("/work-orders");
    expect(hrefs).toContain("/projects");
    // Admin-only surfaces are hidden.
    expect(hrefs).not.toContain("/");
    expect(hrefs).not.toContain("/team");
    expect(hrefs).not.toContain("/tickets");
  });
});

describe("homeForRole", () => {
  it("lands admins on the dashboard", () => {
    expect(homeForRole("admin")).toBe("/");
  });
  it("lands coordinators on work orders", () => {
    expect(homeForRole("coordinator")).toBe("/work-orders");
  });
});
