import { describe, it, expect } from "vitest";
import type { UserRole } from "@/lib/types";
import {
  ASSIGNABLE_ROLES,
  OFFICE_ROLES,
  ROLE_LABELS,
  TICKET_ROLES,
  WORK_ORDER_OWNER_ROLES,
  WORK_ORDER_ROLES,
  canUseWorkOrders,
  isAssignableRole,
  isOfficeRole,
  isServiceEngineerRole,
  isSuperAdminRole,
  isUserRole,
  roleOptions,
} from "./role";

const ALL_ROLES: UserRole[] = ["coordinator", "service_engineer", "admin", "superadmin"];

describe("ROLE_LABELS", () => {
  it("labels every role", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ALL_ROLES].sort());
    expect(ROLE_LABELS.service_engineer).toBe("Service Engineer");
    for (const role of ALL_ROLES) expect(ROLE_LABELS[role].trim()).not.toBe("");
  });
});

describe("isOfficeRole", () => {
  it("includes the SuperAdmin — it is a superset of admin", () => {
    expect(isOfficeRole("superadmin")).toBe(true);
    expect(isOfficeRole("admin")).toBe(true);
  });

  it("excludes both field roles", () => {
    expect(isOfficeRole("coordinator")).toBe(false);
    expect(isOfficeRole("service_engineer")).toBe(false);
  });

  it("agrees with OFFICE_ROLES", () => {
    expect(OFFICE_ROLES).toEqual(["admin", "superadmin"]);
    for (const role of ALL_ROLES) expect(isOfficeRole(role)).toBe(OFFICE_ROLES.includes(role));
  });
});

describe("isSuperAdminRole / isServiceEngineerRole", () => {
  it.each(ALL_ROLES)("classifies %s", (role) => {
    expect(isSuperAdminRole(role)).toBe(role === "superadmin");
    expect(isServiceEngineerRole(role)).toBe(role === "service_engineer");
  });
});

describe("module role sets", () => {
  it("keeps service engineers out of the sales pipeline", () => {
    expect([...WORK_ORDER_ROLES].sort()).toEqual(["admin", "coordinator", "superadmin"]);
    expect(canUseWorkOrders("service_engineer")).toBe(false);
    for (const role of ["coordinator", "admin", "superadmin"] as const) {
      expect(canUseWorkOrders(role)).toBe(true);
    }
  });

  it("never lets a service engineer own a work order (mirrors guard_work_order_owner)", () => {
    expect(WORK_ORDER_OWNER_ROLES).not.toContain("service_engineer");
    expect([...WORK_ORDER_OWNER_ROLES].sort()).toEqual(["admin", "coordinator", "superadmin"]);
  });

  it("opens service tickets to engineers and the office, not coordinators", () => {
    expect([...TICKET_ROLES].sort()).toEqual(["admin", "service_engineer", "superadmin"]);
    expect(TICKET_ROLES).not.toContain("coordinator");
  });

  it("gives the office every module", () => {
    for (const role of OFFICE_ROLES) {
      expect(WORK_ORDER_ROLES).toContain(role);
      expect(TICKET_ROLES).toContain(role);
    }
  });
});

describe("roleOptions", () => {
  it("offers coordinator, service engineer and admin — in that order", () => {
    expect(roleOptions().map((o) => o.value)).toEqual(["coordinator", "service_engineer", "admin"]);
  });

  it("never offers the SuperAdmin seat — it is not assignable from the app", () => {
    expect(roleOptions().map((o) => o.value)).not.toContain("superadmin");
  });

  it("labels every option from the registry", () => {
    for (const option of roleOptions()) {
      expect(option.label).toBe(ROLE_LABELS[option.value]);
    }
  });

  it("returns a fresh array, so a caller cannot corrupt the next picker", () => {
    const first = roleOptions();
    first.push({ value: "superadmin", label: "Super Admin" });
    expect(roleOptions().map((o) => o.value)).not.toContain("superadmin");
  });
});

describe("isAssignableRole", () => {
  it("excludes superadmin, includes the rest", () => {
    expect(isAssignableRole("superadmin")).toBe(false);
    expect(isAssignableRole("admin")).toBe(true);
    expect(isAssignableRole("coordinator")).toBe(true);
    expect(isAssignableRole("service_engineer")).toBe(true);
  });

  it("agrees with ASSIGNABLE_ROLES", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["coordinator", "service_engineer", "admin"]);
    for (const role of ALL_ROLES) {
      expect(isAssignableRole(role)).toBe(ASSIGNABLE_ROLES.includes(role));
    }
  });
});

describe("isUserRole", () => {
  it.each(ALL_ROLES)("accepts %s", (role) => {
    expect(isUserRole(role)).toBe(true);
  });

  it.each([
    "owner",
    "",
    "SUPERADMIN",
    "Admin",
    "service-engineer",
    "Service_Engineer",
    "engineer",
    " admin",
    "admin ",
    "constructor",
    "toString",
    "__proto__",
  ])("rejects %j arriving from a form or URL", (value) => {
    expect(isUserRole(value)).toBe(false);
  });
});
