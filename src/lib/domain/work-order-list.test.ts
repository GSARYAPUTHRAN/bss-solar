import { describe, expect, it } from "vitest";
import {
  WORK_ORDER_STATUS_FILTERS,
  WORK_ORDER_STATUS_FILTER_LABELS,
  isWorkOrderPaymentFilter,
  isWorkOrderStatusFilter,
  linkedProjectNote,
  matchesWorkOrderPayment,
  matchesWorkOrderStatus,
  teamNote,
  workOrderStatusOptions,
} from "./work-order-list";

describe("work-order status filters", () => {
  it("lists the five states, labelled for the office", () => {
    expect(WORK_ORDER_STATUS_FILTERS).toEqual([
      "pending",
      "approved",
      "rejected",
      "cancelled",
      "refunded",
    ]);
    expect(WORK_ORDER_STATUS_FILTER_LABELS).toEqual({
      pending: "Pending",
      approved: "Approved (active)",
      rejected: "Rejected",
      cancelled: "Cancelled",
      refunded: "Refunded",
    });
    expect(workOrderStatusOptions().map((o) => o.label)).toEqual([
      "Pending",
      "Approved (active)",
      "Rejected",
      "Cancelled",
      "Refunded",
    ]);
  });

  it("recognises only its own values (a bad URL value is never sent to the enum)", () => {
    expect(isWorkOrderStatusFilter("refunded")).toBe(true);
    expect(isWorkOrderStatusFilter("closed")).toBe(false);
    expect(isWorkOrderStatusFilter("")).toBe(false);
    expect(isWorkOrderStatusFilter(null)).toBe(false);
    expect(isWorkOrderStatusFilter(undefined)).toBe(false);
  });

  const live = { status: "approved", cancellation: null } as const;
  const refunded = { status: "approved", cancellation: "refunded" } as const;
  const cancelled = { status: "approved", cancellation: "cancelled" } as const;
  const pending = { status: "pending", cancellation: null } as const;
  const rejected = { status: "rejected", cancellation: null } as const;

  it("pending and rejected follow the work order's own status", () => {
    expect(matchesWorkOrderStatus(pending, "pending")).toBe(true);
    expect(matchesWorkOrderStatus(live, "pending")).toBe(false);
    expect(matchesWorkOrderStatus(rejected, "rejected")).toBe(true);
    expect(matchesWorkOrderStatus(pending, "rejected")).toBe(false);
  });

  it("approved means approved and still active — a cancelled or refunded project leaves it", () => {
    expect(matchesWorkOrderStatus(live, "approved")).toBe(true);
    expect(matchesWorkOrderStatus(refunded, "approved")).toBe(false);
    expect(matchesWorkOrderStatus(cancelled, "approved")).toBe(false);
    expect(matchesWorkOrderStatus(pending, "approved")).toBe(false);
  });

  it("cancelled and refunded follow the project's state", () => {
    expect(matchesWorkOrderStatus(cancelled, "cancelled")).toBe(true);
    expect(matchesWorkOrderStatus(refunded, "cancelled")).toBe(false);
    expect(matchesWorkOrderStatus(refunded, "refunded")).toBe(true);
    expect(matchesWorkOrderStatus(live, "refunded")).toBe(false);
    expect(matchesWorkOrderStatus(pending, "cancelled")).toBe(false);
  });
});

describe("work-order payment filter", () => {
  const owing = { total_cost: 100000, advance_amount: 20000, payments_total: 30000 };
  const settled = { total_cost: 100000, advance_amount: 20000, payments_total: 80000 };

  it("recognises only its own values", () => {
    expect(isWorkOrderPaymentFilter("pending")).toBe(true);
    expect(isWorkOrderPaymentFilter("settled")).toBe(true);
    expect(isWorkOrderPaymentFilter("overdue")).toBe(false);
    expect(isWorkOrderPaymentFilter(undefined)).toBe(false);
  });

  it("outstanding is a balance still to collect on a live sale", () => {
    expect(matchesWorkOrderPayment({ ...owing, cancellation: null }, "pending")).toBe(true);
    expect(matchesWorkOrderPayment({ ...settled, cancellation: null }, "pending")).toBe(false);
  });

  it("a cancelled or refunded sale is never outstanding", () => {
    expect(matchesWorkOrderPayment({ ...owing, cancellation: "refunded" }, "pending")).toBe(false);
    expect(matchesWorkOrderPayment({ ...owing, cancellation: "cancelled" }, "pending")).toBe(false);
  });

  it("paid in full is a settled balance, as before", () => {
    expect(matchesWorkOrderPayment({ ...settled, cancellation: null }, "settled")).toBe(true);
    expect(matchesWorkOrderPayment({ ...owing, cancellation: null }, "settled")).toBe(false);
    // Overpaid counts as settled (nothing left to collect).
    expect(
      matchesWorkOrderPayment(
        { total_cost: 100, advance_amount: 0, payments_total: 150, cancellation: null },
        "settled",
      ),
    ).toBe(true);
  });
});

describe("linkedProjectNote", () => {
  it("is the active pipeline while the project is in progress", () => {
    expect(linkedProjectNote({ is_completed: false, cancellation: null }, "solar")).toEqual({
      text: "This work order is an active project.",
      tone: "active",
    });
  });

  it("says commissioned for a solar plant and handed over for a custom plan", () => {
    expect(linkedProjectNote({ is_completed: true, cancellation: null }, "solar")).toEqual({
      text: "This work order's project is commissioned.",
      tone: "done",
    });
    expect(linkedProjectNote({ is_completed: true, cancellation: null }, "custom")).toEqual({
      text: "This work order's project is handed over.",
      tone: "done",
    });
    // Rows from before plans existed are solar.
    expect(linkedProjectNote({ is_completed: true, cancellation: null }, undefined).text).toMatch(
      /commissioned\.$/,
    );
  });

  it.each(["cancelled", "refunded"] as const)("a %s project is muted, not an active one", (c) => {
    expect(linkedProjectNote({ is_completed: false, cancellation: c }, "solar")).toEqual({
      text: `This work order's project was ${c}.`,
      tone: "closed",
    });
  });

  it("a project cancelled after it was commissioned is still cancelled", () => {
    expect(linkedProjectNote({ is_completed: true, cancellation: "refunded" }, "solar").tone).toBe(
      "closed",
    );
  });
});

describe("teamNote", () => {
  const shared = {
    coordinator_ids: ["rahul", "priya", "arun"],
    coordinator_names: ["Rahul Menon", "Priya Suresh", "Arun Krishnan"],
  };
  const alone = { coordinator_ids: ["rahul"], coordinator_names: ["Rahul Menon"] };

  it("tells the office who the sale belongs to, everyone of them", () => {
    expect(teamNote(shared, { id: "admin", office: true })).toBe(
      "Rahul Menon, Priya Suresh & Arun Krishnan",
    );
    expect(teamNote(alone, { id: "admin", office: true })).toBe("Rahul Menon");
  });

  it("tells a coordinator who they share it with, never themself", () => {
    expect(teamNote(shared, { id: "rahul", office: false })).toBe(
      "with Priya Suresh & Arun Krishnan",
    );
    expect(teamNote(shared, { id: "priya", office: false })).toBe(
      "with Rahul Menon & Arun Krishnan",
    );
  });

  it("says nothing to a coordinator about a sale that is theirs alone", () => {
    expect(teamNote(alone, { id: "rahul", office: false })).toBeNull();
  });

  it("copes with a row that names nobody", () => {
    const nobody = { coordinator_ids: [], coordinator_names: [] };
    expect(teamNote(nobody, { id: "admin", office: true })).toBeNull();
    expect(teamNote(nobody, { id: "rahul", office: false })).toBeNull();
  });
});
