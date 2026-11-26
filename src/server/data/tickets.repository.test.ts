import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tickets repository's delete against a fake supabase client that records
 * each call: a delete RLS refused, or of a ticket already gone, removes no row
 * without raising — it must say so rather than claim "Ticket deleted."
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
      delete: () => builder(["delete", table]),
    }),
  })),
}));

import { ticketsRepository } from "./tickets.repository";

beforeEach(() => {
  recorded = [];
  result = { data: [], error: null };
});

describe("ticketsRepository.remove", () => {
  it("deletes that ticket and reports the project it was on", async () => {
    result = { data: [{ id: "t1", project_id: "p1" }], error: null };
    expect(await ticketsRepository.remove("t1")).toEqual({ projectId: "p1", error: null });
    expect(recorded).toEqual([
      ["delete", "service_tickets"],
      ["eq", "id", "t1"],
      ["select", "id, project_id"],
    ]);
  });

  it("reports no project for a ticket that had none", async () => {
    result = { data: [{ id: "t1", project_id: null }], error: null };
    expect(await ticketsRepository.remove("t1")).toEqual({ projectId: null, error: null });
  });

  it("says so when no row went — already deleted, or not the caller's to delete", async () => {
    result = { data: [], error: null };
    expect(await ticketsRepository.remove("t1")).toEqual({
      projectId: null,
      error: "That ticket was already deleted.",
    });
    result = { data: null, error: null };
    expect((await ticketsRepository.remove("t1")).error).toBe("That ticket was already deleted.");
  });

  it("passes the database's error on", async () => {
    result = { data: null, error: { message: "permission denied" } };
    expect(await ticketsRepository.remove("t1")).toEqual({
      projectId: null,
      error: "permission denied",
    });
  });
});
