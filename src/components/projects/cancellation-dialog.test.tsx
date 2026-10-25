// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  setProjectCancellation: vi.fn(),
  reinstateProject: vi.fn(),
}));
vi.mock("@/app/(app)/projects/actions", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { formatCurrency } from "@/lib/format";
import { CancellationDialog, ReinstateDialog } from "./cancellation-dialog";

const TODAY = "2026-10-10";

const CANCEL = {
  projectId: "p1",
  mode: "cancel",
  today: TODAY,
  orderDate: "2026-08-01",
  cancelledOn: null,
  remarks: null,
  money: { received: 120000, balanceDue: 75000 },
  clock: { feasibilityDate: null, completedAt: null, isCompleted: false },
  unpaid: { count: 0, total: 0 },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CancellationDialog — cancel or refund", () => {
  it("opens on the chosen outcome, with today's date between the order date and today", async () => {
    const user = userEvent.setup();
    render(<CancellationDialog {...CANCEL} kind="refunded" triggerLabel="Mark refunded" />);

    await user.click(screen.getByRole("button", { name: "Mark refunded" }));
    const dialog = await screen.findByRole("dialog", { name: /cancel or refund this project/i });

    expect(within(dialog).getByRole("radio", { name: "Refunded" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Cancelled" })).not.toBeChecked();
    const date = within(dialog).getByLabelText(/cancelled on/i);
    expect(date).toHaveValue(TODAY);
    expect(date).toHaveAttribute("min", "2026-08-01");
    expect(date).toHaveAttribute("max", TODAY);
    expect(within(dialog).getByLabelText(/remarks/i)).toHaveAttribute("maxlength", "2000");
  });

  it("says what it changes: the ledger stays, the balance stops counting, the clock stops, incentives stay owed", async () => {
    const user = userEvent.setup();
    render(
      <CancellationDialog
        {...CANCEL}
        triggerLabel="Mark cancelled"
        // 39 days in on the day it is cancelled: one renewal already borne.
        clock={{ feasibilityDate: "2026-09-01", completedAt: null, isCompleted: false }}
        unpaid={{ count: 2, total: 5500 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mark cancelled" }));
    const dialog = await screen.findByRole("dialog");

    for (const line of [
      "Leaves the active pipeline and KPIs",
      `${formatCurrency(120000)} collected stays in the ledger`,
      `${formatCurrency(75000)} balance is no longer counted as outstanding`,
      `The feasibility clock stops (${formatCurrency(1000)} of renewals already borne stays a cost)`,
      `2 unpaid incentives (${formatCurrency(5500)}) stay owed — clear them under Coordinator incentives if they won't be paid`,
    ]) {
      expect(within(dialog).getByText(line)).toBeInTheDocument();
    }
  });

  it("recomputes what the clock has cost when another date is chosen", async () => {
    const user = userEvent.setup();
    render(
      <CancellationDialog
        {...CANCEL}
        triggerLabel="Mark cancelled"
        clock={{ feasibilityDate: "2026-09-01", completedAt: null, isCompleted: false }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mark cancelled" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/\(.*of renewals already borne stays a cost\)/)).toBeInTheDocument();

    // Cancelled on day 9: still inside the first 30-day period, nothing renewed.
    const date = within(dialog).getByLabelText(/cancelled on/i);
    await user.clear(date);
    await user.type(date, "2026-09-10");
    expect(within(dialog).getByText("The feasibility clock stops")).toBeInTheDocument();
    expect(within(dialog).queryByText(/renewals already borne/)).not.toBeInTheDocument();
  });

  it("posts the project, outcome, date and remarks, then closes with the action's message", async () => {
    const user = userEvent.setup();
    actions.setProjectCancellation.mockResolvedValue({
      ok: true,
      data: { message: "Project marked refunded." },
    });
    render(<CancellationDialog {...CANCEL} triggerLabel="Mark cancelled" />);

    await user.click(screen.getByRole("button", { name: "Mark cancelled" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Refunded" }));
    await user.type(within(dialog).getByLabelText(/remarks/i), "Refunded in full by bank transfer");
    // The submit button follows the outcome.
    await user.click(within(dialog).getByRole("button", { name: "Mark refunded" }));

    await waitFor(() => expect(actions.setProjectCancellation).toHaveBeenCalledTimes(1));
    const formData = actions.setProjectCancellation.mock.calls[0][1] as FormData;
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("cancellation")).toBe("refunded");
    expect(formData.get("cancelled_on")).toBe(TODAY);
    expect(formData.get("cancellation_remarks")).toBe("Refunded in full by bank transfer");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Project marked refunded.");
  });

  it("keeps the dialog and what was typed when the server refuses", async () => {
    const user = userEvent.setup();
    actions.setProjectCancellation.mockResolvedValue({
      ok: false,
      error: "The date cannot be before the order date (2026-08-01).",
    });
    render(<CancellationDialog {...CANCEL} triggerLabel="Mark cancelled" />);

    await user.click(screen.getByRole("button", { name: "Mark cancelled" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/remarks/i), "Customer changed their mind");
    await user.click(within(dialog).getByRole("button", { name: "Mark cancelled" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/before the order date/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/remarks/i)).toHaveValue("Customer changed their mind");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a dropped connection in the dialog instead of the error page", async () => {
    const user = userEvent.setup();
    actions.setProjectCancellation.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CancellationDialog {...CANCEL} triggerLabel="Mark cancelled" />);

    await user.click(screen.getByRole("button", { name: "Mark cancelled" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Mark cancelled" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/couldn't reach the server/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("CancellationDialog — edit", () => {
  const EDIT = {
    ...CANCEL,
    mode: "edit",
    kind: "refunded",
    triggerLabel: "Edit",
    cancelledOn: "2026-10-01",
    remarks: "Refunded ₹50,000 on 3 Oct",
  } as const;

  it("prefills what was recorded and does not repeat the impact list", async () => {
    const user = userEvent.setup();
    render(<CancellationDialog {...EDIT} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: /edit cancellation/i });

    expect(within(dialog).getByRole("radio", { name: "Refunded" })).toBeChecked();
    expect(within(dialog).getByLabelText(/cancelled on/i)).toHaveValue("2026-10-01");
    expect(within(dialog).getByLabelText(/remarks/i)).toHaveValue("Refunded ₹50,000 on 3 Oct");
    expect(within(dialog).queryByText(/what this changes/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("an unrecorded date stays blank — and is posted blank, so the server keeps it unrecorded", async () => {
    const user = userEvent.setup();
    actions.setProjectCancellation.mockResolvedValue({
      ok: true,
      data: { message: "Cancellation details saved." },
    });
    render(<CancellationDialog {...EDIT} cancelledOn={null} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/cancelled on/i)).toHaveValue("");
    expect(
      within(dialog).getByText("Not recorded — leave blank to keep it that way."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(actions.setProjectCancellation).toHaveBeenCalledTimes(1));
    const formData = actions.setProjectCancellation.mock.calls[0][1] as FormData;
    expect(formData.get("cancelled_on")).toBe("");
    expect(formData.get("cancellation")).toBe("refunded");
  });
});

describe("ReinstateDialog", () => {
  const REINSTATE = {
    projectId: "p1",
    today: TODAY,
    orderDate: "2026-08-01",
    remarks: "Refunded in full",
    canSetFeasibility: true,
    clockImpact: { feasibilityDate: "2026-01-12", costNow: 1000, costReopened: 4000 },
  };

  it("explains the way back and keeps the remarks as the history note", async () => {
    const user = userEvent.setup();
    render(<ReinstateDialog {...REINSTATE} />);

    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog", { name: /reinstate this project/i });

    expect(
      within(dialog).getByText("The project returns to the active pipeline at its current stage."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/remarks/i)).toHaveValue("Refunded in full");
  });

  it("warns what reopening the old clock costs, with both figures", async () => {
    const user = userEvent.setup();
    render(<ReinstateDialog {...REINSTATE} />);
    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");

    const note = within(dialog).getByRole("note");
    expect(note).toHaveTextContent("Reopening the clock on the old feasibility date (12 Jan 2026)");
    expect(note).toHaveTextContent(
      `renewal cost ${formatCurrency(1000)} → ${formatCurrency(4000)}`,
    );
  });

  it("says nothing about the clock when reopening it costs the same", async () => {
    const user = userEvent.setup();
    render(<ReinstateDialog {...REINSTATE} clockImpact={null} />);
    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("note")).not.toBeInTheDocument();
    // The optional fresh date is still there.
    expect(within(dialog).getByLabelText(/new feasibility date/i)).toBeInTheDocument();
  });

  it("a new feasibility date replaces the warning and is posted with the rest", async () => {
    const user = userEvent.setup();
    actions.reinstateProject.mockResolvedValue({
      ok: true,
      data: { message: "Project reinstated — it is back in the active pipeline." },
    });
    render(<ReinstateDialog {...REINSTATE} />);
    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");

    const date = within(dialog).getByLabelText(/new feasibility date/i);
    expect(date).toHaveValue("");
    expect(date).toHaveAttribute("min", "2026-08-01");
    expect(date).toHaveAttribute("max", TODAY);
    await user.type(date, "2026-10-05");
    // The count now restarts from the new date: the old-date warning no longer applies.
    expect(within(dialog).queryByRole("note")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Reinstate project" }));
    await waitFor(() => expect(actions.reinstateProject).toHaveBeenCalledTimes(1));
    const formData = actions.reinstateProject.mock.calls[0][1] as FormData;
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("feasibility_date")).toBe("2026-10-05");
    expect(formData.get("cancellation_remarks")).toBe("Refunded in full");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith(
      "Project reinstated — it is back in the active pipeline.",
    );
  });

  it("offers no feasibility date for a custom plan (it has none)", async () => {
    const user = userEvent.setup();
    render(<ReinstateDialog {...REINSTATE} canSetFeasibility={false} clockImpact={null} />);
    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/new feasibility date/i)).not.toBeInTheDocument();
  });

  it("keeps the dialog and the remarks when the server refuses", async () => {
    const user = userEvent.setup();
    actions.reinstateProject.mockResolvedValue({ ok: false, error: "This project is not cancelled." });
    render(<ReinstateDialog {...REINSTATE} />);
    await user.click(screen.getByRole("button", { name: "Reinstate" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reinstate project" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This project is not cancelled.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/remarks/i)).toHaveValue("Refunded in full");
  });
});
