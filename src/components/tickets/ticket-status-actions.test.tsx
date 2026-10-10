// @vitest-environment jsdom
import { Component, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { redirect } from "next/navigation";

const actions = vi.hoisted(() => ({ setTicketStatus: vi.fn() }));
vi.mock("@/app/(app)/tickets/actions", () => actions);

vi.mock("@/lib/loading/loading-context", () => ({
  useLoading: () => ({ trackPromise: <T,>(promise: Promise<T>) => promise }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { TicketStatusActions } from "./ticket-status-actions";

/** Stands in for (app)/error.tsx (and Next's RedirectBoundary) above the list. */
class ErrorPage extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static caught: unknown = null;
  static getDerivedStateFromError(error: unknown) {
    ErrorPage.caught = error;
    return { error };
  }
  render() {
    return this.state.error ? <p>Something went wrong</p> : this.props.children;
  }
}

function renderActions() {
  return render(
    <ErrorPage>
      <TicketStatusActions ticketId="t1" ticketNo="BSS-2610-1001" status="scheduled" />
    </ErrorPage>,
  );
}

const startWork = () => screen.getByRole("button", { name: "Start work: BSS-2610-1001" });

beforeEach(() => {
  vi.clearAllMocks();
  ErrorPage.caught = null;
});

describe("TicketStatusActions", () => {
  it("starts work and confirms it", async () => {
    const user = userEvent.setup();
    actions.setTicketStatus.mockResolvedValue({ ok: true, data: undefined });
    renderActions();

    await user.click(startWork());

    expect(actions.setTicketStatus).toHaveBeenCalledWith("t1", "in_progress");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Work started on BSS-2610-1001"),
    );
  });

  it("shows the server's refusal and frees the buttons", async () => {
    const user = userEvent.setup();
    actions.setTicketStatus.mockResolvedValue({
      ok: false,
      error: "This ticket is not assigned to you.",
    });
    renderActions();

    await user.click(startWork());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This ticket is not assigned to you."),
    );
    await waitFor(() => expect(startWork()).toBeEnabled());
  });

  it("keeps the worklist and explains when the request never reaches the server", async () => {
    const user = userEvent.setup();
    actions.setTicketStatus.mockRejectedValue(new TypeError("Failed to fetch"));
    renderActions();

    await user.click(startWork());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't reach the server — check your connection and try again.",
      ),
    );
    await waitFor(() => expect(startWork()).toBeEnabled());
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(ErrorPage.caught).toBeNull();
  });

  it("still hands a redirect (session expired) to Next instead of toasting it", async () => {
    const user = userEvent.setup();
    let redirectError: unknown;
    try {
      redirect("/login");
    } catch (error) {
      redirectError = error;
    }
    actions.setTicketStatus.mockRejectedValue(redirectError);
    // React reports the error it routed to the boundary; keep the output clean.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderActions();

    await user.click(startWork());

    await waitFor(() => expect(ErrorPage.caught).toBe(redirectError));
    expect(toast.error).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
