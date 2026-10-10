// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  recordPayment: vi.fn(),
  updatePayment: vi.fn(),
}));
vi.mock("@/app/(app)/payments/actions", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { PaymentFormDialog } from "./payment-form-dialog";

const TODAY = "2026-10-10";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentFormDialog — record", () => {
  it("opens with today's date and posts the work order's entry", async () => {
    const user = userEvent.setup();
    actions.recordPayment.mockResolvedValue({
      ok: true,
      data: { message: "Payment of ₹25,000.00 recorded." },
    });
    render(<PaymentFormDialog workOrderId="wo-1" today={TODAY} />);

    await user.click(screen.getByRole("button", { name: /record payment/i }));
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByLabelText(/received on/i)).toHaveValue(TODAY);
    expect(screen.getByLabelText(/received on/i)).toHaveAttribute("max", TODAY);

    await user.type(screen.getByLabelText(/amount/i), "25000");
    await user.type(screen.getByLabelText(/reference/i), "UTR 1001");
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    await waitFor(() => expect(actions.recordPayment).toHaveBeenCalledTimes(1));
    const formData = actions.recordPayment.mock.calls[0][1] as FormData;
    expect(formData.get("work_order_id")).toBe("wo-1");
    expect(formData.get("amount")).toBe("25000");
    expect(formData.get("paid_on")).toBe(TODAY);
    expect(formData.get("reference")).toBe("UTR 1001");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Payment of ₹25,000.00 recorded.");
  });

  it("keeps the dialog and what was typed when the server refuses", async () => {
    const user = userEvent.setup();
    actions.recordPayment.mockResolvedValue({
      ok: false,
      error: "₹60,000.00 is more than the ₹50,000.00 balance due on this contract.",
    });
    render(<PaymentFormDialog workOrderId="wo-1" today={TODAY} />);

    await user.click(screen.getByRole("button", { name: /record payment/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(screen.getByLabelText(/amount/i), "60000");
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/balance due/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toHaveValue(60000);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the dialog and what was typed when the request never reaches the server", async () => {
    const user = userEvent.setup();
    actions.recordPayment
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ ok: true, data: { message: "Payment of ₹25,000.00 recorded." } });
    render(<PaymentFormDialog workOrderId="wo-1" today={TODAY} />);

    await user.click(screen.getByRole("button", { name: /record payment/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(screen.getByLabelText(/amount/i), "25000");
    await user.type(screen.getByLabelText(/reference/i), "UTR 1001");
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't reach the server — check your connection and try again.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toHaveValue(25000);
    expect(screen.getByLabelText(/reference/i)).toHaveValue("UTR 1001");
    expect(toast.success).not.toHaveBeenCalled();

    // Back online, the same entry goes through on a second tap.
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.recordPayment).toHaveBeenCalledTimes(2);
  });
});

describe("PaymentFormDialog — edit", () => {
  it("prefills the entry and posts its id", async () => {
    const user = userEvent.setup();
    actions.updatePayment.mockResolvedValue({ ok: true, data: { message: "Payment updated." } });
    render(
      <PaymentFormDialog
        workOrderId="wo-1"
        today={TODAY}
        editLabel="Edit stage 2 payment"
        payment={{
          id: "pay-2",
          amount: 60000,
          paid_on: "2026-09-10",
          method: "cheque",
          purpose: "contract",
          reference: "CHQ 3003",
          notes: "Subsidy credit",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit stage 2 payment" }));
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByLabelText(/amount/i)).toHaveValue(60000);
    expect(screen.getByLabelText(/received on/i)).toHaveValue("2026-09-10");
    expect(screen.getByLabelText(/reference/i)).toHaveValue("CHQ 3003");
    expect(screen.getByLabelText(/notes/i)).toHaveValue("Subsidy credit");

    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(actions.updatePayment).toHaveBeenCalledTimes(1));
    const formData = actions.updatePayment.mock.calls[0][1] as FormData;
    expect(formData.get("id")).toBe("pay-2");
    expect(formData.get("work_order_id")).toBeNull();
    expect(actions.recordPayment).not.toHaveBeenCalled();
  });
});
