// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  writeOffBalance: vi.fn(),
  updatePayment: vi.fn(),
}));
vi.mock("@/app/(app)/payments/actions", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { formatCurrency } from "@/lib/format";
import { WriteOffDialog } from "./write-off-dialog";

const TODAY = "2026-10-10";
const REASON = "Customer was ₹800 short at handover; waived by the office";

beforeEach(() => {
  vi.clearAllMocks();
});

async function open(balance = 800) {
  const user = userEvent.setup();
  render(<WriteOffDialog workOrderId="wo-1" today={TODAY} balance={balance} />);
  await user.click(screen.getByRole("button", { name: /write off balance/i }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

describe("WriteOffDialog — writing a balance off", () => {
  it("shows the balance due and offers to write all of it off, dated today", async () => {
    const { dialog } = await open(800);
    expect(within(dialog).getByText("Balance due")).toBeInTheDocument();
    expect(within(dialog).getAllByText(formatCurrency(800)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/amount to write off/i)).toHaveValue(800);
    expect(screen.getByLabelText(/amount to write off/i)).toHaveAttribute("max", "800");
    expect(screen.getByLabelText(/written off on/i)).toHaveValue(TODAY);
    expect(screen.getByLabelText(/written off on/i)).toHaveAttribute("max", TODAY);
    expect(within(dialog).getByRole("button", { name: `Write off ${formatCurrency(800)}` })).toBeInTheDocument();
  });

  it("says it is permanent in effect, and follows the amount typed", async () => {
    const { user, dialog } = await open(800);
    const note = within(dialog).getByRole("note");
    expect(note).toHaveTextContent(`closes ${formatCurrency(800)} of the balance for good`);
    expect(note).toHaveTextContent(/no longer be collected/);
    expect(note).toHaveTextContent(/settled/);
    expect(note).toHaveTextContent(/only the superadmin can undo it/i);

    const amount = screen.getByLabelText(/amount to write off/i);
    await user.clear(amount);
    await user.type(amount, "300");
    expect(note).toHaveTextContent(`closes ${formatCurrency(300)} of the balance for good`);
    expect(
      within(dialog).getByRole("button", { name: `Write off ${formatCurrency(300)}` }),
    ).toBeInTheDocument();
  });

  it("posts the work order, the amount, the date and the reason, then closes with a toast", async () => {
    actions.writeOffBalance.mockResolvedValue({
      ok: true,
      data: { message: "₹800.00 written off — the balance is settled." },
    });
    const { user, dialog } = await open(800);

    await user.type(screen.getByLabelText(/reason/i), REASON);
    await user.click(within(dialog).getByRole("button", { name: /^write off ₹/i }));

    await waitFor(() => expect(actions.writeOffBalance).toHaveBeenCalledTimes(1));
    const formData = actions.writeOffBalance.mock.calls[0][1] as FormData;
    expect(formData.get("work_order_id")).toBe("wo-1");
    expect(formData.get("amount")).toBe("800");
    expect(formData.get("paid_on")).toBe(TODAY);
    expect(formData.get("reason")).toBe(REASON);
    expect(formData.has("id")).toBe(false);
    expect(actions.updatePayment).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("₹800.00 written off — the balance is settled.");
  });

  it("will not be sent without a reason", async () => {
    const { user, dialog } = await open(800);
    expect(screen.getByLabelText(/reason/i)).toBeRequired();

    await user.click(within(dialog).getByRole("button", { name: /^write off ₹/i }));
    expect(actions.writeOffBalance).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/reason/i)).toBeInvalid();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocks an amount above the balance, in words, before anything is sent", async () => {
    const { user, dialog } = await open(800);
    const amount = screen.getByLabelText(/amount to write off/i) as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "900");
    await user.type(screen.getByLabelText(/reason/i), REASON);

    expect(amount.validationMessage).toBe(
      `The write-off cannot be more than the ${formatCurrency(800)} balance due.`,
    );
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(
      within(dialog).getByText(
        `The write-off cannot be more than the ${formatCurrency(800)} balance due.`,
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^write off ₹/i }));
    expect(actions.writeOffBalance).not.toHaveBeenCalled();

    // Back within the balance, it goes.
    await user.clear(amount);
    await user.type(amount, "800");
    expect(amount.validationMessage).toBe("");
    expect(amount).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the dialog and what was typed when the server refuses", async () => {
    actions.writeOffBalance.mockResolvedValue({
      ok: false,
      error: "A write-off of ₹800.00 is more than the ₹500.00 balance due as of 10 Oct 2026.",
    });
    const { user, dialog } = await open(800);
    await user.type(screen.getByLabelText(/reason/i), REASON);
    await user.click(within(dialog).getByRole("button", { name: /^write off ₹/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/more than the ₹500\.00 balance due/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toHaveValue(REASON);
    expect(screen.getByLabelText(/amount to write off/i)).toHaveValue(800);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the dialog when the request never reaches the server", async () => {
    actions.writeOffBalance.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user, dialog } = await open(800);
    await user.type(screen.getByLabelText(/reason/i), REASON);
    await user.click(within(dialog).getByRole("button", { name: /^write off ₹/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't reach the server/i);
    expect(screen.getByLabelText(/reason/i)).toHaveValue(REASON);
  });
});

describe("WriteOffDialog — correcting a write-off", () => {
  it("prefills the entry and posts its id to the edit action", async () => {
    const user = userEvent.setup();
    actions.updatePayment.mockResolvedValue({ ok: true, data: { message: "Write-off updated." } });
    render(
      <WriteOffDialog
        workOrderId="wo-1"
        today={TODAY}
        // The balance with this write-off released: ₹800 it closed plus ₹200 more.
        balance={1000}
        editLabel="Edit write-off"
        writeOff={{ id: "pay-w", amount: 800, paid_on: "2026-09-26", notes: "Waived" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit write-off" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit write-off", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByLabelText(/amount to write off/i)).toHaveValue(800);
    expect(screen.getByLabelText(/amount to write off/i)).toHaveAttribute("max", "1000");
    expect(screen.getByLabelText(/written off on/i)).toHaveValue("2026-09-26");
    expect(screen.getByLabelText(/reason/i)).toHaveValue("Waived");

    await user.click(within(dialog).getByRole("button", { name: /save write-off/i }));
    await waitFor(() => expect(actions.updatePayment).toHaveBeenCalledTimes(1));
    const formData = actions.updatePayment.mock.calls[0][1] as FormData;
    expect(formData.get("id")).toBe("pay-w");
    expect(formData.get("reason")).toBe("Waived");
    expect(formData.has("work_order_id")).toBe(false);
    expect(actions.writeOffBalance).not.toHaveBeenCalled();
  });
});
