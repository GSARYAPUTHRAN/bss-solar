import { describe, it, expect } from "vitest";
import {
  OFFICE_ROLES,
  ROLE_LABELS,
  isOfficeRole,
  isSuperAdminRole,
  isUserRole,
  roleOptions,
} from "./role";

describe("isOfficeRole", () => {
  it("includes the SuperAdmin — it is a superset of admin", () => {
    expect(isOfficeRole("superadmin")).toBe(true);
    expect(isOfficeRole("admin")).toBe(true);
  });
  it("excludes coordinators", () => {
    expect(isOfficeRole("coordinator")).toBe(false);
  });
  it("agrees with OFFICE_ROLES", () => {
    expect(OFFICE_ROLES).toEqual(["admin", "superadmin"]);
  });
});

describe("isSuperAdminRole", () => {
  it("is true only for superadmin", () => {
    expect(isSuperAdminRole("superadmin")).toBe(true);
    expect(isSuperAdminRole("admin")).toBe(false);
    expect(isSuperAdminRole("coordinator")).toBe(false);
  });
});

describe("roleOptions", () => {
  it("hides the SuperAdmin seat from someone who cannot grant it", () => {
    expect(roleOptions(false).map((o) => o.value)).toEqual([
      "coordinator",
      "admin",
    ]);
  });
  it("offers the SuperAdmin seat when it may be granted", () => {
    expect(roleOptions(true).map((o) => o.value)).toEqual([
      "coordinator",
      "admin",
      "superadmin",
    ]);
  });
  it("labels every option from the registry", () => {
    for (const option of roleOptions(true)) {
      expect(option.label).toBe(ROLE_LABELS[option.value]);
    }
  });
});

describe("isUserRole", () => {
  it("accepts the three known roles", () => {
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("coordinator")).toBe(true);
    expect(isUserRole("superadmin")).toBe(true);
  });
  it("rejects anything else arriving from a form or URL", () => {
    expect(isUserRole("owner")).toBe(false);
    expect(isUserRole("")).toBe(false);
    expect(isUserRole("SUPERADMIN")).toBe(false);
  });
});
