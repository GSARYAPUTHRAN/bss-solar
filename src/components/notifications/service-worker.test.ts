import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

/**
 * public/sw.js is plain JS served as-is, so it is exercised here by running the
 * file against a fake ServiceWorkerGlobalScope.
 */
const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://ops.bsssolar.test";

type Handler = (event: Record<string, unknown>) => void;

interface FakeWindowClient {
  url: string;
  focus: () => Promise<FakeWindowClient>;
  navigate: (url: string) => Promise<unknown>;
}

interface FakeWindow {
  url: string;
  /** Controlled by this worker (default). A hard-reloaded tab is not. */
  controlled?: boolean;
  navigate?: () => Promise<unknown>;
}

/** What Chromium throws once the click's one window interaction is spent. */
function notAllowed(): Error {
  return Object.assign(new Error("Not allowed to open a window."), {
    name: "InvalidAccessError",
  });
}

function loadWorker(windows: FakeWindow[] = []) {
  const handlers: Record<string, Handler> = {};
  const showNotification = vi.fn(async () => undefined);
  // As in Chromium, a notificationclick may focus OR open one window:
  // focus() and openWindow() spend the same single allowance.
  let interactionSpent = false;
  function spendInteraction() {
    if (interactionSpent) throw notAllowed();
    interactionSpent = true;
  }
  const openWindow = vi.fn(async () => {
    spendInteraction();
    return null;
  });
  const clientList = windows.map((w) => {
    const client = {
      url: w.url,
      controlled: w.controlled ?? true,
      focus: vi.fn(async (): Promise<FakeWindowClient> => {
        spendInteraction();
        return client;
      }),
      navigate: vi.fn(
        w.navigate ??
          (async (url: string): Promise<unknown> => {
            // Per spec, only a window this worker controls can be navigated.
            if (!client.controlled) throw new TypeError("Not controlled by this worker");
            client.url = url;
            return client;
          }),
      ),
    };
    return client;
  });
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async (options: { includeUncontrolled?: boolean } = {}) =>
        clientList.filter((client) => client.controlled || options.includeUncontrolled),
      ),
      openWindow,
    },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
  };
  runInNewContext(SOURCE, { self, URL });

  /** Dispatch an event and wait for whatever it passed to waitUntil(). */
  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]({
      ...event,
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  }

  return { dispatch, showNotification, openWindow, clientList };
}

function pushEvent(payload: unknown) {
  return {
    data: {
      json: () => (typeof payload === "string" ? JSON.parse(payload) : payload),
      text: () => String(payload),
    },
  };
}

function clickEvent(url: unknown) {
  return { notification: { close: vi.fn(), data: { url } } };
}

describe("service worker: push", () => {
  it("shows the pushed notification with the app icon and link", async () => {
    const sw = loadWorker();
    await sw.dispatch(
      "push",
      pushEvent({ title: "Payment received", body: "Anand — paid", url: "/projects/p1" }),
    );
    expect(sw.showNotification).toHaveBeenCalledWith("Payment received", {
      body: "Anand — paid",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: "/projects/p1" },
    });
  });

  it("collapses repeats by tag but still re-alerts", async () => {
    const sw = loadWorker();
    await sw.dispatch("push", pushEvent({ title: "Feasibility", url: "/", tag: "f:p1" }));
    expect(sw.showNotification).toHaveBeenCalledWith(
      "Feasibility",
      expect.objectContaining({ tag: "f:p1", renotify: true }),
    );
  });

  it("never links off-site, whatever the payload says", async () => {
    const sw = loadWorker();
    for (const url of ["https://evil.example", "//evil.example", "/\\evil.example", 42]) {
      await sw.dispatch("push", pushEvent({ title: "x", url }));
    }
    for (const call of sw.showNotification.mock.calls as unknown as [string, { data: { url: string } }][]) {
      expect(call[1].data.url).toBe("/notifications");
    }
  });

  it("survives a non-JSON or empty push", async () => {
    const sw = loadWorker();
    await sw.dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
        text: () => "plain text",
      },
    });
    await sw.dispatch("push", {});
    expect(sw.showNotification).toHaveBeenNthCalledWith(
      1,
      "BSS Solar",
      expect.objectContaining({ body: "plain text" }),
    );
    expect(sw.showNotification).toHaveBeenNthCalledWith(
      2,
      "BSS Solar",
      expect.objectContaining({ data: { url: "/notifications" } }),
    );
  });
});

describe("service worker: notificationclick", () => {
  it("navigates an open app window, then focuses it", async () => {
    const sw = loadWorker([{ url: `${ORIGIN}/work-orders` }]);
    const event = clickEvent("/tickets/t1");
    await sw.dispatch("notificationclick", event);
    const [client] = sw.clientList;
    expect(event.notification.close).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/tickets/t1`);
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate.mock.invocationCallOrder[0]).toBeLessThan(
      client.focus.mock.invocationCallOrder[0],
    );
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("only focuses a window already showing the page", async () => {
    const sw = loadWorker([{ url: `${ORIGIN}/tickets/t1` }]);
    await sw.dispatch("notificationclick", clickEvent("/tickets/t1"));
    expect(sw.clientList[0].navigate).not.toHaveBeenCalled();
    expect(sw.clientList[0].focus).toHaveBeenCalled();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when the app is not open", async () => {
    const sw = loadWorker([{ url: "https://other.example/" }]);
    await sw.dispatch("notificationclick", clickEvent("/projects/p1"));
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/projects/p1`);
  });

  // In Chromium, openWindow() after focus() rejects ("Not allowed to open a
  // window"), which would leave the user on the old page.
  it("falls back to a new window when navigate() is refused, without focusing first", async () => {
    const sw = loadWorker([
      { url: `${ORIGIN}/`, navigate: async () => Promise.reject(new TypeError("uncontrolled")) },
    ]);
    await sw.dispatch("notificationclick", clickEvent("/projects/p1"));
    expect(sw.clientList[0].focus).not.toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/projects/p1`);
    await expect(sw.openWindow.mock.results[0].value).resolves.toBeNull();
  });

  it("opens a new window rather than reuse a tab it does not control (hard reload)", async () => {
    const sw = loadWorker([{ url: `${ORIGIN}/work-orders`, controlled: false }]);
    await sw.dispatch("notificationclick", clickEvent("/work-orders/wo-1"));
    expect(sw.clientList[0].focus).not.toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/work-orders/wo-1`);
  });

  it("reuses the window it controls when an uncontrolled one is also open", async () => {
    const sw = loadWorker([
      { url: `${ORIGIN}/`, controlled: false },
      { url: `${ORIGIN}/projects` },
    ]);
    await sw.dispatch("notificationclick", clickEvent("/projects/p1"));
    const [uncontrolled, controlled] = sw.clientList;
    expect(uncontrolled.focus).not.toHaveBeenCalled();
    expect(controlled.navigate).toHaveBeenCalledWith(`${ORIGIN}/projects/p1`);
    expect(controlled.focus).toHaveBeenCalled();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("sends a tampered link to the inbox instead", async () => {
    const sw = loadWorker();
    await sw.dispatch("notificationclick", clickEvent("https://evil.example/phish"));
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`);
  });
});
