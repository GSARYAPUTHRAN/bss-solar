import { describe, it, expect } from "vitest";
import {
  WORK_ORDER_STATUS,
  TICKET_STATUS,
  MILESTONE_STATUS,
  FEASIBILITY_STATE,
  FINANCING,
  statusLabels,
  statusOptions,
  type StatusRegistry,
} from "./status";

const REGISTRIES: [string, StatusRegistry<string>][] = [
  ["WORK_ORDER_STATUS", WORK_ORDER_STATUS],
  ["TICKET_STATUS", TICKET_STATUS],
  ["MILESTONE_STATUS", MILESTONE_STATUS],
  ["FEASIBILITY_STATE", FEASIBILITY_STATE],
  ["FINANCING", FINANCING],
];

describe("status registries", () => {
  it("cover exactly their enum members", () => {
    expect(Object.keys(WORK_ORDER_STATUS).sort()).toEqual(["approved", "pending", "rejected"]);
    expect(Object.keys(TICKET_STATUS).sort()).toEqual([
      "cancelled",
      "completed",
      "in_progress",
      "open",
      "scheduled",
    ]);
    expect(Object.keys(MILESTONE_STATUS).sort()).toEqual(["completed", "in_progress", "pending"]);
  });

  it("cover every feasibility state from lib/domain/kseb", () => {
    expect(Object.keys(FEASIBILITY_STATE).sort()).toEqual([
      "closed",
      "expiring",
      "extended",
      "not_set",
      "on_track",
    ]);
  });

  it("cover both financing types with the agreed wording", () => {
    expect(Object.keys(FINANCING).sort()).toEqual(["loan", "self"]);
    expect(FINANCING.self.label).toBe("Self-financed");
    expect(FINANCING.loan.label).toBe("Bank loan");
  });

  it("flag an expiring feasibility louder than an extended one", () => {
    // Expiring is the actionable state (commission now or BSS pays ₹1,000).
    expect(FEASIBILITY_STATE.expiring.badgeClass).toMatch(/red/);
    expect(FEASIBILITY_STATE.extended.badgeClass).toMatch(/amber/);
  });

  it.each(REGISTRIES)("%s: every entry has a label and a dark-mode-safe badge", (_name, registry) => {
    for (const meta of Object.values(registry)) {
      expect(meta.label.trim()).not.toBe("");
      expect(meta.badgeClass).toMatch(/\bbg-/);
      expect(meta.badgeClass).toMatch(/\btext-/);
      expect(meta.badgeClass).toMatch(/\bdark:bg-/);
      expect(meta.badgeClass).toMatch(/\bdark:text-/);
    }
  });

  it.each(REGISTRIES)("%s: labels are unique (filters stay unambiguous)", (_name, registry) => {
    const labels = Object.values(registry).map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("statusLabels", () => {
  it("derives a value->label map", () => {
    const labels = statusLabels(WORK_ORDER_STATUS);
    expect(labels.pending).toBe("Pending");
    expect(labels.approved).toBe("Approved");
    expect(labels.rejected).toBe("Rejected");
  });

  it("derives the financing labels", () => {
    expect(statusLabels(FINANCING)).toEqual({ self: "Self-financed", loan: "Bank loan" });
  });
});

describe("statusOptions", () => {
  it("derives {value,label} options for every entry", () => {
    const options = statusOptions(TICKET_STATUS);
    expect(options).toHaveLength(5);
    expect(options).toContainEqual({ value: "open", label: "Open" });
    for (const opt of options) {
      expect(opt).toHaveProperty("value");
      expect(opt).toHaveProperty("label");
    }
  });

  it("derives feasibility filter options in registry order", () => {
    expect(statusOptions(FEASIBILITY_STATE).map((o) => o.value)).toEqual([
      "not_set",
      "on_track",
      "expiring",
      "extended",
      "closed",
    ]);
  });
});
