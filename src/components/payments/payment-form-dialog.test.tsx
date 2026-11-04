// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// jsdom lacks what Radix Select needs to open its list.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** Pick an option of the "What is this for?" select. */
async function chooseKind(user: ReturnType<typeof userEvent.setup>, option: string) {
  await user.click(screen.getByRole("combobox", { name: /what is this for/i }));
  await user.click(await screen.findByRole("option", { name: option }));
}

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
    expect(formData.get("kind")).toBe("contract");
    expect(formData.get("method")).toBe("bank_transfer");

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

  it("asks what the entry is for in plain choices — no raw purposes, no write-off", async () => {
    const user = userEvent.setup();
    render(<PaymentFormDialog workOrderId="wo-1" today={TODAY} />);
    await user.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByRole("dialog");

    const kind = screen.getByRole("combobox", { name: /what is this for/i });
    expect(kind).toHaveTextContent("Contract payment");
    await user.click(kind);
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Contract payment",
      "KSEB fee collected from the customer",
      "KSEB fee paid by the office",
      "Refund",
    ]);
    // The old purpose select listed the enum entries; neither it nor a tick is left.
    expect(screen.queryByRole("option", { name: "KSEB fees" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /write-off/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it.each([
    ["KSEB fee collected from the customer", "kseb_customer", /received on/i, /^record payment$/i],
    ["KSEB fee paid by the office", "kseb_office", /paid on/i, /^record payment$/i],
    ["Refund", "refund", /paid on/i, /^record refund$/i],
  ])("records %s as kind %s", async (option, value, dateLabel, submit) => {
    const user = userEvent.setup();
    actions.recordPayment.mockResolvedValue({ ok: true, data: { message: "Recorded." } });
    render(<PaymentFormDialog workOrderId="wo-1" today={TODAY} />);
    await user.click(screen.getByRole("button", { name: /record payment/i }));
    const dialog = await screen.findByRole("dialog");

    await chooseKind(user, option);
    expect(screen.getByLabelText(dateLabel)).toHaveValue(TODAY);
    await user.type(screen.getByLabelText(/amount/i), "5720");
    await user.click(within(dialog).getByRole("button", { name: submit }));

    await waitFor(() => expect(actions.recordPayment).toHaveBeenCalledTimes(1));
    const formData = actions.recordPayment.mock.calls[0][1] as FormData;
    expect(formData.get("kind")).toBe(value);
    expect(formData.get("amount")).toBe("5720");
    // The tick is part of the choice: nothing else is posted for it.
    expect(formData.has("paid_by_office")).toBe(false);
    expect(formData.has("purpose")).toBe(false);
  });

  it("explains what each choice does to the books", async () => {
    const user = userEvent.setup();
    render(<PaymentFormDialog workOrderId="wo-1" today={TODAY} />);
    await user.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByRole("dialog");

    expect(screen.getByText(/lowers the balance due/i)).toBeInTheDocument();
    await chooseKind(user, "Refund");
    expect(screen.getByText(/money returned to the customer/i)).toBeInTheDocument();
    expect(screen.queryByText(/lowers the balance due/i)).not.toBeInTheDocument();
    await chooseKind(user, "KSEB fee paid by the office");
    expect(screen.getByText(/paid KSEB on the customer's behalf/i)).toBeInTheDocument();
  });

  it("says how much the choice can be, from what the ledger holds", async () => {
    const user = userEvent.setup();
    render(
      <PaymentFormDialog
        workOrderId="wo-1"
        today={TODAY}
        limits={{ contract: 95000, refund: 100000 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByRole("dialog");

    expect(screen.getByText("Up to ₹95,000.00 — the balance due.")).toBeInTheDocument();
    await chooseKind(user, "Refund");
    expect(
      screen.getByText("Up to ₹1,00,000.00 — what was collected, less refunds already made."),
    ).toBeInTheDocument();
    await chooseKind(user, "KSEB fee paid by the office");
    expect(screen.queryByText(/^Up to/)).not.toBeInTheDocument();
  });

  it("says plainly when there is nothing to collect or to refund", async () => {
    const user = userEvent.setup();
    render(
      <PaymentFormDialog workOrderId="wo-1" today={TODAY} limits={{ contract: 0, refund: 0 }} />,
    );
    await user.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByRole("dialog");

    expect(screen.getByText("Nothing is due on this contract.")).toBeInTheDocument();
    await chooseKind(user, "Refund");
    expect(screen.getByText("Nothing has been collected to refund.")).toBeInTheDocument();
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
          paid_by_office: false,
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
    expect(screen.getByRole("combobox", { name: /what is this for/i })).toHaveTextContent(
      "Contract payment",
    );

    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(actions.updatePayment).toHaveBeenCalledTimes(1));
    const formData = actions.updatePayment.mock.calls[0][1] as FormData;
    expect(formData.get("id")).toBe("pay-2");
    expect(formData.get("kind")).toBe("contract");
    expect(formData.get("work_order_id")).toBeNull();
    expect(actions.recordPayment).not.toHaveBeenCalled();
  });

  it.each([
    ["kseb_fees", true, "KSEB fee paid by the office", "kseb_office"],
    ["kseb_fees", false, "KSEB fee collected from the customer", "kseb_customer"],
    ["refund", false, "Refund", "refund"],
  ] as const)(
    "starts a %s entry (paid by the office: %s) on %s",
    async (purpose, paidByOffice, label, kind) => {
      const user = userEvent.setup();
      actions.updatePayment.mockResolvedValue({ ok: true, data: { message: "Payment updated." } });
      render(
        <PaymentFormDialog
          workOrderId="wo-1"
          today={TODAY}
          payment={{
            id: "pay-9",
            amount: 5720,
            paid_on: "2026-09-10",
            method: "cash",
            purpose,
            paid_by_office: paidByOffice,
            reference: null,
            notes: null,
          }}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Edit payment" }));
      const dialog = await screen.findByRole("dialog");
      expect(screen.getByRole("combobox", { name: /what is this for/i })).toHaveTextContent(label);

      await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
      await waitFor(() => expect(actions.updatePayment).toHaveBeenCalledTimes(1));
      expect((actions.updatePayment.mock.calls[0][1] as FormData).get("kind")).toBe(kind);
    },
  );
});
