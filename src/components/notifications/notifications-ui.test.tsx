// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppNotification } from "@/lib/types";

const actions = vi.hoisted(() => ({
  getRecentNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markNotificationsRead: vi.fn(),
  clearReadNotifications: vi.fn(),
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
}));
vi.mock("@/app/(app)/notifications/actions", () => actions);

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));

/** How a server action call fails when the phone has no signal. */
const offline = () => new TypeError("Failed to fetch");
const UNREACHABLE = "Couldn't reach the server — check your connection and try again.";

const trackStart = vi.hoisted(() => vi.fn());
vi.mock("@/lib/loading/loading-context", () => ({ useLoading: () => ({ trackStart }) }));

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// A fake Realtime channel that lets the test push INSERT events.
const realtime = vi.hoisted(() => ({
  onInsert: null as null | ((payload: { new: unknown }) => void),
  filter: "",
  removed: 0,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => {
      const channel = {
        on: (_type: string, opts: { filter: string }, cb: (p: { new: unknown }) => void) => {
          realtime.filter = opts.filter;
          realtime.onInsert = cb;
          return channel;
        },
        subscribe: (cb: (status: string) => void) => {
          cb("SUBSCRIBED");
          return channel;
        },
      };
      return channel;
    },
    removeChannel: async () => {
      realtime.removed += 1;
    },
  }),
}));

import { NotificationsProvider } from "./notifications-provider";
import { NotificationBell } from "./notification-bell";
import { NotificationFeed } from "./notification-feed";
import { NotificationsToolbar } from "./notifications-toolbar";

const USER = "00000000-0000-0000-0000-000000000001";

function note(id: string, over: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    recipient_id: USER,
    type: "payment.recorded",
    title: `Payment ${id}`,
    body: "Anand Kumar — ₹10,000 still due",
    link: `/projects/${id}`,
    read_at: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

function renderBell(initialUnread: number) {
  return render(
    <NotificationsProvider userId={USER} initialUnread={initialUnread} pushPublicKey={null}>
      <NotificationBell />
    </NotificationsProvider>,
  );
}

beforeAll(() => {
  // Radix positions the panel with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  realtime.onInsert = null;
  actions.getUnreadCount.mockImplementation(async () => ({ ok: true, data: 3 }));
  actions.markNotificationsRead.mockResolvedValue({ ok: true, data: { count: 1 } });
});

describe("NotificationBell", () => {
  it("announces the unread count and caps the badge at 99+", async () => {
    actions.getUnreadCount.mockResolvedValue({ ok: true, data: 120 });
    renderBell(120);
    const bell = await screen.findByRole("button", { name: "Notifications, 120 unread" });
    expect(bell).toHaveTextContent("99+");
  });

  it("subscribes to the user's own inserts and re-syncs the count once live", async () => {
    renderBell(3);
    expect(realtime.filter).toBe(`recipient_id=eq.${USER}`);
    await waitFor(() => expect(actions.getUnreadCount).toHaveBeenCalled());
  });

  it("bumps the count and toasts when a notification arrives", async () => {
    renderBell(3);
    await screen.findByRole("button", { name: "Notifications, 3 unread" });

    act(() => realtime.onInsert?.({ new: note("n9") }));

    expect(
      await screen.findByRole("button", { name: "Notifications, 4 unread" }),
    ).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      "Payment n9",
      expect.objectContaining({ description: "Anand Kumar — ₹10,000 still due" }),
    );
  });

  it("drops a server count requested before a live insert landed", async () => {
    let respond: (value: { ok: true; data: number }) => void = () => {};
    actions.getUnreadCount.mockImplementation(
      () => new Promise((resolve) => (respond = resolve)),
    );
    renderBell(3);
    await waitFor(() => expect(actions.getUnreadCount).toHaveBeenCalled());

    act(() => realtime.onInsert?.({ new: note("n1") }));
    await screen.findByRole("button", { name: "Notifications, 4 unread" });
    // The re-sync was answered from before the insert: it must not undo it.
    await act(async () => respond({ ok: true, data: 3 }));
    expect(screen.getByRole("button", { name: "Notifications, 4 unread" })).toBeInTheDocument();
  });

  it("ignores malformed realtime payloads", async () => {
    renderBell(3);
    await screen.findByRole("button", { name: "Notifications, 3 unread" });
    act(() => realtime.onInsert?.({ new: { id: 1 } }));
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it("opens the panel, and tapping an item marks it read and navigates", async () => {
    const user = userEvent.setup();
    actions.getRecentNotifications.mockResolvedValue({
      ok: true,
      data: { items: [note("p1"), note("p2", { read_at: "2026-10-01T00:00:00Z" })], unreadCount: 3 },
    });
    renderBell(3);

    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    const item = await screen.findByRole("button", { name: /Payment p1/ });
    expect(screen.getByText("Push notifications unavailable")).toBeInTheDocument();

    await user.click(item);

    expect(actions.markNotificationsRead).toHaveBeenCalledWith(["p1"]);
    expect(router.push).toHaveBeenCalledWith("/projects/p1");
    expect(trackStart).toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    ).toBeInTheDocument();
  });

  it("does not count an already-read item down again", async () => {
    const user = userEvent.setup();
    actions.getRecentNotifications.mockResolvedValue({
      ok: true,
      data: { items: [note("r1", { read_at: "2026-10-01T00:00:00Z" })], unreadCount: 3 },
    });
    renderBell(3);
    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    await user.click(await screen.findByRole("button", { name: /Payment r1/ }));

    expect(actions.markNotificationsRead).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/projects/r1");
  });

  it("marks everything read from the panel", async () => {
    const user = userEvent.setup();
    actions.getRecentNotifications.mockResolvedValue({
      ok: true,
      data: { items: [note("a1")], unreadCount: 3 },
    });
    renderBell(3);
    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    await user.click(await screen.findByRole("button", { name: /mark all read/i }));

    expect(actions.markNotificationsRead).toHaveBeenCalledWith(null);
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("keeps the count and explains when mark all read fails", async () => {
    const user = userEvent.setup();
    actions.getRecentNotifications.mockResolvedValue({
      ok: true,
      data: { items: [note("a1")], unreadCount: 3 },
    });
    actions.markNotificationsRead.mockResolvedValue({ ok: false, error: "Could not mark" });
    renderBell(3);
    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    await user.click(await screen.findByRole("button", { name: /mark all read/i }));

    expect(toast.error).toHaveBeenCalledWith("Could not mark");
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
  });

  it("re-enables Mark all read and explains when the request never reaches the server", async () => {
    const user = userEvent.setup();
    actions.getRecentNotifications.mockResolvedValue({
      ok: true,
      data: { items: [note("a1")], unreadCount: 3 },
    });
    actions.markNotificationsRead.mockRejectedValue(offline());
    renderBell(3);
    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    const markAll = await screen.findByRole("button", { name: /mark all read/i });
    await user.click(markAll);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNREACHABLE));
    await waitFor(() => expect(markAll).toBeEnabled());
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
  });

  it("offers Try again when the panel's list cannot be fetched", async () => {
    const user = userEvent.setup();
    actions.getRecentNotifications.mockRejectedValueOnce(offline()).mockResolvedValue({
      ok: true,
      data: { items: [note("p1")], unreadCount: 3 },
    });
    renderBell(3);
    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));

    expect(await screen.findByText("Could not load notifications.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Payment p1/ })).toBeInTheDocument();
  });

  it("re-syncs the count when marking one read never reaches the server", async () => {
    const user = userEvent.setup();
    actions.getRecentNotifications.mockResolvedValue({
      ok: true,
      data: { items: [note("p1")], unreadCount: 3 },
    });
    renderBell(3);
    await user.click(await screen.findByRole("button", { name: "Notifications, 3 unread" }));
    const item = await screen.findByRole("button", { name: /Payment p1/ });
    const syncsBefore = actions.getUnreadCount.mock.calls.length;
    actions.markNotificationsRead.mockRejectedValue(offline());

    await user.click(item);

    // Counted down optimistically, then put back to the server's truth (3).
    await waitFor(() =>
      expect(actions.getUnreadCount).toHaveBeenCalledTimes(syncsBefore + 1),
    );
    expect(
      await screen.findByRole("button", { name: "Notifications, 3 unread" }),
    ).toBeInTheDocument();
  });

  it("keeps the last known count when a background re-sync fails", async () => {
    actions.getUnreadCount.mockRejectedValue(offline());
    renderBell(3);
    await waitFor(() => expect(actions.getUnreadCount).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    const user = userEvent.setup();
    actions.getUnreadCount.mockResolvedValue({ ok: true, data: 0 });
    actions.getRecentNotifications.mockResolvedValue({
      ok: true,
      data: { items: [], unreadCount: 0 },
    });
    renderBell(0);
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it("leaves the realtime channel on unmount", async () => {
    const { unmount } = renderBell(3);
    await screen.findByRole("button", { name: "Notifications, 3 unread" });
    const before = realtime.removed;
    unmount();
    expect(realtime.removed).toBe(before + 1);
  });
});

describe("/notifications list + toolbar", () => {
  const NOW = Date.parse("2026-10-10T12:00:00Z");

  function renderPage(rows: AppNotification[], unread = rows.length) {
    const ui = (list: AppNotification[]) => (
      <NotificationsProvider userId={USER} initialUnread={unread} pushPublicKey={null}>
        <NotificationsToolbar />
        <NotificationFeed rows={list} now={NOW} />
      </NotificationsProvider>
    );
    const view = render(ui(rows));
    return { ...view, rerenderRows: (list: AppNotification[]) => view.rerender(ui(list)) };
  }

  const unreadRows = () => screen.queryAllByText(/^Unread:/);

  it("renders server rows with their read state and server-supplied time", () => {
    renderPage([
      note("u1", { created_at: "2026-10-10T11:55:00Z" }),
      note("r1", { read_at: "2026-10-09T00:00:00Z", created_at: "2026-10-01T00:00:00Z" }),
    ]);
    expect(unreadRows()).toHaveLength(1);
    expect(screen.getByText("5 min ago")).toBeInTheDocument();
    expect(screen.getByText("01 Oct 2026")).toBeInTheDocument();
  });

  it("shows every loaded row as read after Mark all read, then trusts a fresh page", async () => {
    const user = userEvent.setup();
    const { rerenderRows } = renderPage([note("a"), note("b")], 2);
    expect(unreadRows()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /mark all read/i }));
    await waitFor(() => expect(unreadRows()).toHaveLength(0));
    expect(router.refresh).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    // A new page from the server carries real read state again.
    rerenderRows([note("c")]);
    expect(unreadRows()).toHaveLength(1);
  });

  it("re-enables Mark all read when the request fails, and leaves the rows unread", async () => {
    const user = userEvent.setup();
    actions.markNotificationsRead.mockRejectedValue(offline());
    renderPage([note("a"), note("b")], 2);
    const markAll = screen.getByRole("button", { name: /mark all read/i });

    await user.click(markAll);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNREACHABLE));
    await waitFor(() => expect(markAll).toBeEnabled());
    expect(unreadRows()).toHaveLength(2);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not count down a row already shown as read", async () => {
    const user = userEvent.setup();
    renderPage([note("a")], 1);
    await user.click(screen.getByRole("button", { name: /mark all read/i }));
    await waitFor(() => expect(unreadRows()).toHaveLength(0));
    actions.markNotificationsRead.mockClear();

    await user.click(screen.getByRole("button", { name: /Payment a/ }));
    expect(actions.markNotificationsRead).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/projects/a");
  });

  it("clears read notifications and refreshes the page", async () => {
    const user = userEvent.setup();
    actions.clearReadNotifications.mockResolvedValue({ ok: true, data: undefined });
    renderPage([note("a")]);
    await user.click(screen.getByRole("button", { name: /clear read/i }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Read notifications cleared.");
  });

  it("keeps the page when Clear read cannot reach the server, and re-enables the button", async () => {
    const user = userEvent.setup();
    actions.clearReadNotifications.mockRejectedValue(offline());
    renderPage([note("a")]);
    const clear = screen.getByRole("button", { name: /clear read/i });

    await user.click(clear);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNREACHABLE));
    await waitFor(() => expect(clear).toBeEnabled());
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("explains a failed clear and does not refresh", async () => {
    const user = userEvent.setup();
    actions.clearReadNotifications.mockResolvedValue({ ok: false, error: "Try again" });
    renderPage([note("a")]);
    await user.click(screen.getByRole("button", { name: /clear read/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Try again"));
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
