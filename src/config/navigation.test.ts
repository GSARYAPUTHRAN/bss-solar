import { describe, it, expect } from "vitest";
import type { UserRole } from "@/lib/types";
import { navForRole, homeForRole, MODULES } from "./navigation";

const ALL_ROLES: UserRole[] = ["coordinator", "service_engineer", "admin", "superadmin"];
const hrefsFor = (role: UserRole) => navForRole(role).map((m) => m.href);

describe("navForRole", () => {
  it("gives admins every module", () => {
    expect(hrefsFor("admin")).toEqual(MODULES.map((m) => m.href));
    expect(hrefsFor("admin")).toEqual([
      "/",
      "/work-orders",
      "/projects",
      "/tickets",
      "/team",
      "/onboarding",
    ]);
  });

  it("restricts coordinators to the sales pipeline", () => {
    expect(hrefsFor("coordinator")).toEqual(["/work-orders", "/projects"]);
  });

  it("restricts service engineers to their service tickets", () => {
    expect(hrefsFor("service_engineer")).toEqual(["/tickets"]);
    expect(navForRole("service_engineer").map((m) => m.label)).toEqual(["Service Tickets"]);
  });

  it("gives the SuperAdmin everything an admin gets", () => {
    // The registry lists only the minimum role, so this pins the inheritance.
    expect(hrefsFor("superadmin")).toEqual(hrefsFor("admin"));
  });

  it("does not leak office modules to field roles", () => {
    for (const role of ["coordinator", "service_engineer"] as const) {
      expect(hrefsFor(role)).not.toContain("/");
      expect(hrefsFor(role)).not.toContain("/team");
      expect(hrefsFor(role)).not.toContain("/onboarding");
    }
  });

  it("lists only real roles, and never the SuperAdmin by name (it inherits)", () => {
    for (const entry of MODULES) {
      expect(entry.roles.length).toBeGreaterThan(0);
      for (const role of entry.roles) expect(ALL_ROLES).toContain(role);
      expect(entry.roles).not.toContain("superadmin");
    }
  });

  it("has unique hrefs that are in-app paths", () => {
    const hrefs = MODULES.map((m) => m.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href).toMatch(/^\/(?!\/)/);
  });
});

describe("homeForRole", () => {
  it.each<[UserRole, string]>([
    ["admin", "/"],
    ["superadmin", "/"],
    ["coordinator", "/work-orders"],
    ["service_engineer", "/tickets"],
  ])("lands %s on %s", (role, home) => {
    expect(homeForRole(role)).toBe(home);
  });

  it.each(ALL_ROLES)("sends %s to a module it can see (no redirect loop)", (role) => {
    expect(hrefsFor(role)).toContain(homeForRole(role));
  });
});
