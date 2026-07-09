import { describe, it, expect } from "vitest";
import {
  WORK_ORDER_STATUS,
  TICKET_STATUS,
  MILESTONE_STATUS,
  statusLabels,
  statusOptions,
} from "./status";

describe("status registries", () => {
  it("cover exactly their enum members", () => {
    expect(Object.keys(WORK_ORDER_STATUS).sort()).toEqual([
      "approved",
      "pending",
      "rejected",
    ]);
    expect(Object.keys(TICKET_STATUS).sort()).toEqual([
      "cancelled",
      "completed",
      "in_progress",
      "open",
      "scheduled",
    ]);
    expect(Object.keys(MILESTONE_STATUS).sort()).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
  });

  it("every entry has a label and a badge class", () => {
    for (const registry of [
      WORK_ORDER_STATUS,
      TICKET_STATUS,
      MILESTONE_STATUS,
    ]) {
      for (const meta of Object.values(registry)) {
        expect(meta.label).toBeTruthy();
        expect(meta.badgeClass).toBeTruthy();
      }
    }
  });
});

describe("statusLabels", () => {
  it("derives a value->label map", () => {
    const labels = statusLabels(WORK_ORDER_STATUS);
    expect(labels.pending).toBe("Pending");
    expect(labels.approved).toBe("Approved");
    expect(labels.rejected).toBe("Rejected");
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
});
