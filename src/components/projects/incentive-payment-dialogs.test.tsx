// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  recordIncentivePayment: vi.fn(),
  updateIncentivePayment: vi.fn(),
  deleteIncentivePayment: vi.fn(),
}));
vi.mock("@/app/(app)/projects/actions", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { formatCurrency, formatDate } from "@/lib/format";
import type { IncentiveInstalment } from "@/server/data/projects.repository";
import { InstalmentDialog, RemoveInstalmentDialog } from "./incentive-payment-dialogs";

const TODAY = "2026-10-10";
const RAVI = { id: "c1", full_name: "Ravi Kumar" };

/** ₹6,000 agreed, ₹4,000 paid in two instalments: ₹2,000 still to pay. */
const PART_PAID = { amount: 6000, paid: 4000 };

const SECOND: IncentiveInstalment = {
  id: "pay-2",
  amount: 2000,
  paid_on: "2026-09-15",
  note: "Cheque 004211",
  recorded_by: "admin-1",
  recorded_by_name: "BSS Admin",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InstalmentDialog — record", () => {
  function renderRecord(incentive: { amount: number | null; paid: number } = PART_PAID) {
    return render(
      <InstalmentDialog projectId="p1" payee={RAVI} incentive={incentive} today={TODAY} />,
    );
  }

  it("opens with today's date, says how much can still be paid, and posts the person's instalment", async () => {
    const user = userEvent.setup();
    actions.recordIncentivePayment.mockResolvedValue({
      ok: true,
      data: { message: "₹1,500.00 recorded for Ravi Kumar — ₹500.00 still to pay." },
    });
    renderRecord();

    await user.click(screen.getByRole("button", { name: "Record payment for Ravi Kumar" }));
    const dialog = await screen.findByRole("dialog", { name: /record payment/i });
    expect(dialog).toHaveTextContent(
      `Ravi Kumar · ${formatCurrency(4000)} paid of ${formatCurrency(6000)} agreed.`,
    );

    const date = within(dialog).getByLabelText(/paid on/i);
    expect(date).toHaveValue(TODAY);
    // An instalment cannot be dated later than today.
    expect(date).toHaveAttribute("max", TODAY);

    // …nor be more than is still to pay.
    const amount = within(dialog).getByLabelText(/amount/i);
    expect(amount).toHaveAttribute("max", "2000");
    expect(amount).toHaveAttribute("min", "0.01");
    expect(dialog).toHaveTextContent(`Up to ${formatCurrency(2000)} — what is still to pay.`);

    await user.type(amount, "1500");
    await user.type(within(dialog).getByLabelText(/note/i), "UPI 8821");
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    await waitFor(() => expect(actions.recordIncentivePayment).toHaveBeenCalledTimes(1));
    const formData = actions.recordIncentivePayment.mock.calls[0][1] as FormData;
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("coordinator_id")).toBe("c1");
    expect(formData.get("payment_id")).toBeNull();
    expect(formData.get("amount")).toBe("1500");
    expect(formData.get("paid_on")).toBe(TODAY);
    expect(formData.get("note")).toBe("UPI 8821");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith(
      "₹1,500.00 recorded for Ravi Kumar — ₹500.00 still to pay.",
    );
    expect(actions.updateIncentivePayment).not.toHaveBeenCalled();
  });

  it("keeps the dialog and what was typed when the server refuses", async () => {
    const user = userEvent.setup();
    actions.recordIncentivePayment.mockResolvedValue({
      ok: false,
      error: "That would take the payments above the agreed incentive.",
    });
    renderRecord();

    await user.click(screen.getByRole("button", { name: "Record payment for Ravi Kumar" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/amount/i), "1500");
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/above the agreed incentive/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/amount/i)).toHaveValue(1500);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the dialog when the request never reaches the server, and goes through on a second tap", async () => {
    const user = userEvent.setup();
    actions.recordIncentivePayment
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ ok: true, data: { message: "Recorded." } });
    renderRecord();

    await user.click(screen.getByRole("button", { name: "Record payment for Ravi Kumar" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/amount/i), "500");
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn't reach the server — check your connection and try again.",
    );
    expect(within(dialog).getByLabelText(/amount/i)).toHaveValue(500);

    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.recordIncentivePayment).toHaveBeenCalledTimes(2);
  });

  it("cannot be opened on an incentive with nothing left to pay", () => {
    renderRecord({ amount: 6000, paid: 6000 });
    expect(screen.getByRole("button", { name: "Record payment for Ravi Kumar" })).toBeDisabled();
  });

  it("cannot be opened before an amount is agreed", () => {
    renderRecord({ amount: null, paid: 0 });
    expect(screen.getByRole("button", { name: "Record payment for Ravi Kumar" })).toBeDisabled();
  });

  it("starts clean every time it is opened", async () => {
    const user = userEvent.setup();
    renderRecord();
    await user.click(screen.getByRole("button", { name: "Record payment for Ravi Kumar" }));
    await user.type(await screen.findByLabelText(/amount/i), "700");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Record payment for Ravi Kumar" }));
    expect(await screen.findByLabelText(/amount/i)).toHaveValue(null);
  });
});

describe("InstalmentDialog — edit", () => {
  const editName = `Edit the ${formatCurrency(2000)} payment of ${formatDate("2026-09-15")} to Ravi Kumar`;

  function renderEdit() {
    return render(
      <InstalmentDialog
        projectId="p1"
        payee={RAVI}
        incentive={PART_PAID}
        today={TODAY}
        payment={SECOND}
      />,
    );
  }

  it("prefills the instalment, allows its own amount again, and posts its id", async () => {
    const user = userEvent.setup();
    actions.updateIncentivePayment.mockResolvedValue({
      ok: true,
      data: { message: "Payment corrected for Ravi Kumar." },
    });
    renderEdit();

    await user.click(screen.getByRole("button", { name: editName }));
    const dialog = await screen.findByRole("dialog", { name: /edit payment/i });
    const amount = within(dialog).getByLabelText(/amount/i);
    expect(amount).toHaveValue(2000);
    // The other instalment is ₹2,000 of ₹6,000, so this one may be up to ₹4,000.
    expect(amount).toHaveAttribute("max", "4000");
    expect(dialog).toHaveTextContent(
      `Up to ${formatCurrency(4000)} — this payment and what is still to pay.`,
    );
    expect(within(dialog).getByLabelText(/paid on/i)).toHaveValue("2026-09-15");
    expect(within(dialog).getByLabelText(/note/i)).toHaveValue("Cheque 004211");

    await user.clear(within(dialog).getByLabelText(/paid on/i));
    await user.type(within(dialog).getByLabelText(/paid on/i), "2026-09-16");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(actions.updateIncentivePayment).toHaveBeenCalledTimes(1));
    const formData = actions.updateIncentivePayment.mock.calls[0][1] as FormData;
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("payment_id")).toBe("pay-2");
    // The instalment cannot move to another incentive: no coordinator is posted.
    expect(formData.get("coordinator_id")).toBeNull();
    expect(formData.get("paid_on")).toBe("2026-09-16");
    expect(formData.get("amount")).toBe("2000");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Payment corrected for Ravi Kumar.");
    expect(actions.recordIncentivePayment).not.toHaveBeenCalled();
  });

  it("can be opened even when the incentive is fully paid (to correct it)", () => {
    render(
      <InstalmentDialog
        projectId="p1"
        payee={RAVI}
        incentive={{ amount: 4000, paid: 4000 }}
        today={TODAY}
        payment={SECOND}
      />,
    );
    expect(screen.getByRole("button", { name: editName })).toBeEnabled();
  });
});

describe("RemoveInstalmentDialog", () => {
  const removeName = `Remove the ${formatCurrency(2000)} payment of ${formatDate("2026-09-15")} to Ravi Kumar`;

  it("says what happens, then removes that one instalment", async () => {
    const user = userEvent.setup();
    actions.deleteIncentivePayment.mockResolvedValue({
      ok: true,
      data: { message: "₹2,000.00 payment removed for Ravi Kumar." },
    });
    render(<RemoveInstalmentDialog projectId="p1" payee={RAVI} payment={SECOND} />);

    await user.click(screen.getByRole("button", { name: removeName }));
    const dialog = await screen.findByRole("dialog", { name: /remove this payment/i });
    expect(dialog).toHaveTextContent("owed to them again");
    expect(dialog).toHaveTextContent("The agreed amount stays as it is.");
    // Nothing is sent until it is confirmed.
    expect(actions.deleteIncentivePayment).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Remove payment" }));
    await waitFor(() => expect(actions.deleteIncentivePayment).toHaveBeenCalledTimes(1));
    const formData = actions.deleteIncentivePayment.mock.calls[0][1] as FormData;
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("payment_id")).toBe("pay-2");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("₹2,000.00 payment removed for Ravi Kumar.");
  });

  it("can be backed out of", async () => {
    const user = userEvent.setup();
    render(<RemoveInstalmentDialog projectId="p1" payee={RAVI} payment={SECOND} />);
    await user.click(screen.getByRole("button", { name: removeName }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.deleteIncentivePayment).not.toHaveBeenCalled();
  });

  it("shows a refusal in the dialog and leaves it open", async () => {
    const user = userEvent.setup();
    actions.deleteIncentivePayment.mockResolvedValue({
      ok: false,
      error: "That payment is not on this project — it may have been removed.",
    });
    render(<RemoveInstalmentDialog projectId="p1" payee={RAVI} payment={SECOND} />);
    await user.click(screen.getByRole("button", { name: removeName }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove payment" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/not on this project/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
