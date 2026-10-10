import { describe, it, expect } from "vitest";
import { deletionBlocker, roleChangeBlocker, type OwnedWork } from "./team";

const NOTHING: OwnedWork = { workOrders: 0, projects: 0, activeTickets: 0 };

describe("deletionBlocker", () => {
  it("allows deleting a member with nothing attached", () => {
    expect(deletionBlocker("Rahul", NOTHING)).toBeNull();
  });

  it("refuses while they own sales work, naming what to move", () => {
    expect(deletionBlocker("Rahul", { ...NOTHING, workOrders: 2, projects: 1 })).toBe(
      "Rahul still owns 2 work orders and 1 project. Reassign or delete that business first.",
    );
    expect(deletionBlocker("Rahul", { ...NOTHING, projects: 3 })).toBe(
      "Rahul still owns 3 projects. Reassign or delete that business first.",
    );
  });

  it("refuses while an engineer still has open tickets", () => {
    expect(deletionBlocker("Vineeth", { ...NOTHING, activeTickets: 1 })).toBe(
      "Vineeth still has 1 open service ticket. Reassign them to another engineer first.",
    );
    expect(deletionBlocker("Vineeth", { ...NOTHING, activeTickets: 2 })).toMatch(
      /2 open service tickets/,
    );
  });
});

describe("roleChangeBlocker", () => {
  const change = (overrides: Partial<Parameters<typeof roleChangeBlocker>[0]>) =>
    roleChangeBlocker({
      name: "Vineeth",
      from: "coordinator",
      to: "admin",
      adminCount: 2,
      owned: NOTHING,
      ...overrides,
    });

  it("allows an ordinary change", () => {
    expect(change({})).toBeNull();
    expect(change({ from: "coordinator", to: "service_engineer" })).toBeNull();
    expect(change({ from: "service_engineer", to: "coordinator" })).toBeNull();
  });

  it("never removes the last administrator, whatever they become", () => {
    for (const to of ["coordinator", "service_engineer"] as const) {
      expect(change({ from: "admin", to, adminCount: 1 })).toBe(
        "At least one administrator is required.",
      );
    }
    expect(change({ from: "admin", to: "coordinator", adminCount: 2 })).toBeNull();
  });

  it("does not count non-office moves against the last administrator", () => {
    expect(
      change({ from: "service_engineer", to: "coordinator", adminCount: 1 }),
    ).toBeNull();
  });

  it("refuses to make a coordinator who owns business an engineer", () => {
    expect(
      change({
        from: "coordinator",
        to: "service_engineer",
        owned: { ...NOTHING, workOrders: 1 },
      }),
    ).toMatch(/owns 1 work order\. Service engineers cannot own sales work/);
  });

  it("refuses to move an engineer off the role while they hold open tickets", () => {
    expect(
      change({
        from: "service_engineer",
        to: "admin",
        owned: { ...NOTHING, activeTickets: 2 },
      }),
    ).toMatch(/still has 2 open service tickets/);
  });

  it("is a no-op when the role does not change", () => {
    expect(
      change({ from: "admin", to: "admin", adminCount: 1, owned: { ...NOTHING, workOrders: 4 } }),
    ).toBeNull();
  });
});
