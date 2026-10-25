import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { NotificationEvent } from "@/lib/domain/notifications";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("./deliver", () => ({ deliver: vi.fn() }));

import { after } from "next/server";
import { deliver, type DeliveryReport } from "./deliver";
import { notify } from "./index";

const mockedAfter = vi.mocked(after);
const mockedDeliver = vi.mocked(deliver);

const first: NotificationEvent = {
  type: "work_order.submitted",
  actorId: "coord-1",
  actorName: "Rahul",
  workOrderId: "wo-1",
  clientName: "Anil Kumar",
  capacity: "3kW",
  partnerNames: [],
};

const second: NotificationEvent = {
  type: "work_order.approved",
  actorId: "admin-1",
  coordinatorIds: ["coord-1"],
  workOrderId: "wo-1",
  projectId: "pr-1",
  clientName: "Anil Kumar",
};

function report(type: NotificationEvent["type"]): DeliveryReport {
  return { type, recipients: 1, inserted: 1, pushed: 0, failedPushes: 0, prunedSubscriptions: 0 };
}

/** The callback notify() handed to after(). */
function scheduled(): () => Promise<void> {
  expect(mockedAfter).toHaveBeenCalledTimes(1);
  const task = mockedAfter.mock.calls[0][0];
  expect(typeof task).toBe("function");
  return task as () => Promise<void>;
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.clearAllMocks();
  mockedDeliver.mockImplementation(async (event) => report(event.type));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("notify", () => {
  it("does nothing without events", () => {
    notify();
    expect(mockedAfter).not.toHaveBeenCalled();
    expect(mockedDeliver).not.toHaveBeenCalled();
  });

  it("defers delivery until after the response", () => {
    notify(first);
    scheduled();
    expect(mockedDeliver).not.toHaveBeenCalled();
  });

  it("delivers every event, in order, once the deferred task runs", async () => {
    notify(first, second);
    await scheduled()();
    expect(mockedDeliver.mock.calls.map(([event]) => event)).toEqual([first, second]);
  });

  it("delivers one event at a time", async () => {
    let release!: () => void;
    mockedDeliver.mockImplementationOnce(
      () =>
        new Promise<DeliveryReport>((resolve) => {
          release = () => resolve(report(first.type));
        }),
    );
    notify(first, second);
    const running = scheduled()();
    await Promise.resolve();
    expect(mockedDeliver).toHaveBeenCalledTimes(1);
    release();
    await running;
    expect(mockedDeliver).toHaveBeenCalledTimes(2);
  });

  it("keeps going when one event fails, and logs it", async () => {
    mockedDeliver.mockRejectedValueOnce(new Error("insert failed"));
    notify(first, second);
    await expect(scheduled()()).resolves.toBeUndefined();

    expect(mockedDeliver).toHaveBeenCalledTimes(2);
    expect(mockedDeliver.mock.calls[1][0]).toBe(second);
    expect(consoleError).toHaveBeenCalledWith(
      "[notify] work_order.submitted failed:",
      expect.any(Error),
    );
  });

  it("survives a deliver() that throws synchronously", async () => {
    mockedDeliver.mockImplementationOnce(() => {
      throw new Error("sync failure");
    });
    notify(first, second);
    await expect(scheduled()()).resolves.toBeUndefined();
    expect(mockedDeliver).toHaveBeenCalledTimes(2);
  });

  it("delivers immediately (without blocking) outside a request scope", async () => {
    mockedAfter.mockImplementationOnce(() => {
      throw new Error("`after` was called outside a request scope");
    });
    expect(() => notify(first, second)).not.toThrow();
    await vi.waitFor(() => expect(mockedDeliver).toHaveBeenCalledTimes(2));
    expect(mockedDeliver.mock.calls.map(([event]) => event)).toEqual([first, second]);
  });

  it("never throws or rejects, even when after() and every delivery fail", async () => {
    mockedAfter.mockImplementationOnce(() => {
      throw new Error("no request scope");
    });
    mockedDeliver.mockRejectedValue(new Error("database down"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      expect(() => notify(first, second)).not.toThrow();
      await vi.waitFor(() => expect(mockedDeliver).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
