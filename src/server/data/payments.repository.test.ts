import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The payments repository against a fake supabase client that records each
 * query: what the ledger reads back, and what a new or corrected entry sends.
 */

type Call = [string, ...unknown[]];

let recorded: Call[];
let result: { data: unknown; error: { message: string } | null };

/** A thenable builder: every method is recorded and chains; awaiting resolves. */
function builder(first: Call) {
  recorded.push(first);
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          recorded.push([String(prop), ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => ({
      select: (columns: string) => builder(["select", table, columns]),
      insert: (payload: unknown) => builder(["insert", table, payload]),
      update: (payload: unknown) => builder(["update", table, payload]),
      delete: () => builder(["delete", table]),
    }),
  })),
}));

import { paymentsRepository, type PaymentInput } from "./payments.repository";

const REFUND: PaymentInput = {
  amount: 10000,
  paid_on: "2026-09-25",
  method: "bank_transfer",
  purpose: "refund",
  paid_by_office: false,
  reference: "UTR 9021",
  notes: "Excess collected, returned",
};

beforeEach(() => {
  recorded = [];
  result = { data: [], error: null };
});

describe("paymentsRepository — reading the ledger", () => {
  it("selects who paid a KSEB fee, with the rest of the entry", async () => {
    await paymentsRepository.listForWorkOrder("wo-1");
    const [, table, columns] = recorded[0];
    expect(table).toBe("payments");
    for (const column of ["purpose", "paid_by_office", "notes", "reference"]) {
      expect(columns).toContain(column);
    }
    expect(columns).toContain("recorder:profiles!payments_recorded_by_fkey(id, full_name)");
    expect(recorded).toContainEqual(["eq", "work_order_id", "wo-1"]);
  });

  it("reads the ledger oldest first, ties by when they were recorded", async () => {
    await paymentsRepository.listForWorkOrder("wo-1");
    expect(recorded.filter(([name]) => name === "order")).toEqual([
      ["order", "paid_on", { ascending: true }],
      ["order", "created_at", { ascending: true }],
    ]);
  });

  it("throws on a failed read rather than answering with an empty ledger", async () => {
    // An empty ledger would let every cap through.
    result = { data: null, error: { message: "connection reset" } };
    await expect(paymentsRepository.listForWorkOrder("wo-1")).rejects.toThrow(
      "Could not read the payment ledger: connection reset",
    );
  });

  it("selects the same columns for a single entry", async () => {
    result = { data: null, error: null };
    expect(await paymentsRepository.byId("pay-1")).toBeNull();
    expect(recorded[0][2]).toContain("paid_by_office");
  });
});

describe("paymentsRepository — writing the ledger", () => {
  it("records an entry with its purpose, who paid it and who recorded it", async () => {
    result = { data: { id: "pay-9" }, error: null };
    const created = await paymentsRepository.create("wo-1", REFUND, "admin-1");
    expect(created).toEqual({ id: "pay-9", error: null });
    expect(recorded).toContainEqual([
      "insert",
      "payments",
      { ...REFUND, work_order_id: "wo-1", recorded_by: "admin-1" },
    ]);
  });

  it("sends a KSEB fee the office paid as such", async () => {
    result = { data: { id: "pay-9" }, error: null };
    await paymentsRepository.create(
      "wo-1",
      { ...REFUND, purpose: "kseb_fees", paid_by_office: true },
      "admin-1",
    );
    expect(recorded.find(([name]) => name === "insert")?.[2]).toMatchObject({
      purpose: "kseb_fees",
      paid_by_office: true,
    });
  });

  it("sends a write-off's reason as its note", async () => {
    result = { data: { id: "pay-9" }, error: null };
    await paymentsRepository.create(
      "wo-1",
      {
        amount: 800,
        paid_on: "2026-09-26",
        method: "other",
        purpose: "write_off",
        paid_by_office: false,
        reference: null,
        notes: "Customer was short at handover",
      },
      "admin-1",
    );
    expect(recorded.find(([name]) => name === "insert")?.[2]).toMatchObject({
      purpose: "write_off",
      notes: "Customer was short at handover",
    });
  });

  it("explains a write refused by row-level security instead of claiming success", async () => {
    result = { data: null, error: null };
    expect(await paymentsRepository.create("wo-1", REFUND, "coord-1")).toEqual({
      id: null,
      error: "Payment was not recorded — office staff only.",
    });
  });

  it("reports the database's refusal", async () => {
    result = {
      data: null,
      error: { message: 'new row violates check constraint "payments_write_off_needs_reason"' },
    };
    const created = await paymentsRepository.create("wo-1", REFUND, "admin-1");
    expect(created.id).toBeNull();
    expect(created.error).toContain("payments_write_off_needs_reason");
  });

  it("corrects an entry with the same body", async () => {
    result = { data: [{ id: "pay-1" }], error: null };
    expect(await paymentsRepository.update("pay-1", REFUND)).toEqual({ error: null });
    expect(recorded).toContainEqual(["update", "payments", REFUND]);
    expect(recorded).toContainEqual(["eq", "id", "pay-1"]);
  });

  it("says so when a correction touched nothing", async () => {
    result = { data: [], error: null };
    expect(await paymentsRepository.update("pay-1", REFUND)).toEqual({
      error: "Payment not found, or you cannot edit it.",
    });
  });

  it("says so when a delete touched nothing — only the SuperAdmin can", async () => {
    result = { data: [], error: null };
    expect(await paymentsRepository.remove("pay-1")).toEqual({
      error: "Nothing was deleted — only the SuperAdmin can delete.",
    });
    result = { data: [{ id: "pay-1" }], error: null };
    expect(await paymentsRepository.remove("pay-1")).toEqual({ error: null });
  });
});
