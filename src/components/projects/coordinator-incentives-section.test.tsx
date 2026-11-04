// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  updateCoordinatorIncentive: vi.fn(),
  recordIncentivePayment: vi.fn(),
  updateIncentivePayment: vi.fn(),
  deleteIncentivePayment: vi.fn(),
}));
vi.mock("@/app/(app)/projects/actions", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { formatCurrency, formatDate } from "@/lib/format";
import type { ProjectCoordinator } from "@/server/data/projects.repository";
import { CoordinatorIncentivesSection } from "./coordinator-incentives-section";

const TODAY = "2026-10-10";

const NONE = { amount: null, paid_on: null, payments: [], paid: 0 };

/** ₹2,000 agreed, nothing paid. */
const RAVI: ProjectCoordinator = {
  id: "c1",
  full_name: "Ravi Kumar",
  sort_order: 1,
  incentive: { amount: 2000, paid_on: null, payments: [], paid: 0 },
};
/** Nothing agreed yet. */
const ABHIJITH: ProjectCoordinator = {
  id: "c2",
  full_name: "Abhijith Nair",
  sort_order: 2,
  incentive: NONE,
};
/** ₹6,000 agreed, ₹4,000 paid in two instalments. */
const PRIYA: ProjectCoordinator = {
  id: "c3",
  full_name: "Priya Suresh",
  sort_order: 3,
  incentive: {
    amount: 6000,
    paid_on: null,
    payments: [
      { id: "pay-1", amount: 2000, paid_on: "2026-09-01", note: "Advance", recorded_by: "a", recorded_by_name: "BSS Admin" },
      { id: "pay-2", amount: 2000, paid_on: "2026-09-15", note: null, recorded_by: "a", recorded_by_name: "BSS Admin" },
    ],
    paid: 4000,
  },
};

function renderSection(coordinators: ProjectCoordinator[] = [RAVI, ABHIJITH]) {
  return render(
    <CoordinatorIncentivesSection projectId="p1" coordinators={coordinators} today={TODAY} />,
  );
}

const blockOf = (name: string) => screen.getByRole("group", { name: `Incentive for ${name}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CoordinatorIncentivesSection — one block per person", () => {
  it("shows each coordinator's own agreed incentive and its state", () => {
    renderSection([RAVI, PRIYA]);

    const ravi = within(blockOf("Ravi Kumar"));
    expect(ravi.getByLabelText(/agreed amount/i)).toHaveValue(2000);
    expect(ravi.getByText("Pending")).toBeInTheDocument();
    expect(ravi.getByText("logged the sale")).toBeInTheDocument();
    expect(ravi.getByText("No payments recorded yet.")).toBeInTheDocument();

    const priya = within(blockOf("Priya Suresh"));
    expect(priya.getByLabelText(/agreed amount/i)).toHaveValue(6000);
    expect(priya.getByText("Partly paid")).toBeInTheDocument();
    expect(priya.queryByText("logged the sale")).not.toBeInTheDocument();
  });

  it("an unset incentive reads 'Not set' with an empty amount, and cannot take a payment yet", () => {
    renderSection([ABHIJITH, RAVI]);
    const abhijith = within(blockOf("Abhijith Nair"));
    expect(abhijith.getByLabelText(/agreed amount/i)).toHaveValue(null);
    expect(abhijith.getByText("Not set")).toBeInTheDocument();
    expect(abhijith.getByText(/set the agreed amount to start recording payments/i)).toBeInTheDocument();
    expect(abhijith.queryByRole("button", { name: /record payment/i })).not.toBeInTheDocument();
    expect(abhijith.queryByText("Agreed")).not.toBeInTheDocument();
  });

  it("a sale with one coordinator does not label anyone 'logged the sale'", () => {
    renderSection([RAVI]);
    expect(screen.queryByText("logged the sale")).not.toBeInTheDocument();
  });

  it("shows what is agreed, paid and still to pay, and every instalment with who recorded it", () => {
    renderSection([PRIYA]);
    const priya = within(blockOf("Priya Suresh"));

    expect(priya.getByText("Agreed").nextElementSibling).toHaveTextContent(formatCurrency(6000));
    expect(priya.getByText("Paid").nextElementSibling).toHaveTextContent(formatCurrency(4000));
    expect(priya.getByText("Still to pay").nextElementSibling).toHaveTextContent(
      formatCurrency(2000),
    );

    const rows = within(priya.getByRole("list", { name: "Payments to Priya Suresh" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(formatDate("2026-09-01"));
    expect(rows[0]).toHaveTextContent("Advance");
    expect(rows[0]).toHaveTextContent("Recorded by BSS Admin");
  });

  it("each instalment has its own edit and remove controls", () => {
    renderSection([PRIYA]);
    const rows = within(blockOf("Priya Suresh")).getAllByRole("listitem");
    for (const row of rows) {
      expect(within(row).getByRole("button", { name: /^edit the/i })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /^remove the/i })).toBeInTheDocument();
    }
  });

  it("an amount can never go below what is paid: the field says so, and carries it as its minimum", () => {
    renderSection([PRIYA, RAVI]);
    const priya = within(blockOf("Priya Suresh"));
    expect(priya.getByLabelText(/agreed amount/i)).toHaveAttribute("min", "4000");
    expect(priya.getByText(/cannot be less than the .*4,000.* already paid/i)).toBeInTheDocument();
    // Nothing paid: no floor to explain.
    const ravi = within(blockOf("Ravi Kumar"));
    expect(ravi.getByLabelText(/agreed amount/i)).toHaveAttribute("min", "0");
  });

  it("a fully paid incentive has nothing more to record", () => {
    renderSection([
      {
        ...PRIYA,
        incentive: { ...PRIYA.incentive!, amount: 4000, paid_on: "2026-09-15" },
      },
    ]);
    const priya = within(blockOf("Priya Suresh"));
    expect(priya.getByText("Paid", { selector: "span[data-slot=badge]" })).toBeInTheDocument();
    expect(priya.getByRole("button", { name: /^record payment/i })).toBeDisabled();
    expect(priya.getByText(/fully paid — nothing more to record/i)).toBeInTheDocument();
  });

  it("a zero incentive is 'Nothing owed', not pending", () => {
    renderSection([{ ...RAVI, incentive: { ...NONE, amount: 0 } }]);
    const ravi = within(blockOf("Ravi Kumar"));
    expect(ravi.getByText("Nothing owed")).toBeInTheDocument();
    expect(ravi.getByText(/nothing is owed on a zero incentive/i)).toBeInTheDocument();
  });
});

describe("CoordinatorIncentivesSection — the agreed amount", () => {
  it("saves one person's amount: their row alone is posted — and no paid date — and the message is toasted", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockResolvedValue({
      ok: true,
      data: { message: "Incentive saved for Abhijith Nair." },
    });
    renderSection();

    const abhijith = within(blockOf("Abhijith Nair"));
    await user.type(abhijith.getByLabelText(/agreed amount/i), "3500");
    await user.click(abhijith.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.updateCoordinatorIncentive).toHaveBeenCalledTimes(1));
    const formData = actions.updateCoordinatorIncentive.mock.calls[0][1] as FormData;
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("coordinator_id")).toBe("c2");
    expect(formData.get("amount")).toBe("3500");
    expect(formData.has("paid_on")).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Incentive saved for Abhijith Nair.");
  });

  it("clearing the amount posts it empty (that is how an incentive is removed)", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockResolvedValue({
      ok: true,
      data: { message: "Incentive saved for Ravi Kumar." },
    });
    renderSection();

    const ravi = within(blockOf("Ravi Kumar"));
    await user.clear(ravi.getByLabelText(/agreed amount/i));
    await user.click(ravi.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.updateCoordinatorIncentive).toHaveBeenCalledTimes(1));
    const formData = actions.updateCoordinatorIncentive.mock.calls[0][1] as FormData;
    expect(formData.get("coordinator_id")).toBe("c1");
    expect(formData.get("amount")).toBe("");
  });

  it("shows a refusal in that person's block only, keeping what was typed", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockResolvedValue({
      ok: false,
      error: `The incentive cannot be less than the ${formatCurrency(4000)} already paid.`,
    });
    renderSection([PRIYA, RAVI]);

    const priya = within(blockOf("Priya Suresh"));
    const amount = priya.getByLabelText(/agreed amount/i);
    await user.clear(amount);
    await user.type(amount, "4000");
    // The native floor is satisfied, so the request goes out and the server answers.
    await user.click(priya.getByRole("button", { name: "Save" }));

    expect(await priya.findByRole("alert")).toHaveTextContent(/cannot be less than/);
    expect(within(blockOf("Ravi Kumar")).queryByRole("alert")).not.toBeInTheDocument();
    expect(amount).toHaveValue(4000);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a dropped connection in the block instead of the error page", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockRejectedValue(new TypeError("Failed to fetch"));
    renderSection([RAVI]);

    const ravi = within(blockOf("Ravi Kumar"));
    await user.click(ravi.getByRole("button", { name: "Save" }));
    expect(await ravi.findByRole("alert")).toHaveTextContent(/couldn't reach the server/i);
  });

  it("shows the new amount once the page re-renders with it (the field is re-mounted, not stale)", () => {
    const { rerender } = renderSection([RAVI]);
    expect(within(blockOf("Ravi Kumar")).getByLabelText(/agreed amount/i)).toHaveValue(2000);
    rerender(
      <CoordinatorIncentivesSection
        projectId="p1"
        today={TODAY}
        coordinators={[{ ...RAVI, incentive: { ...NONE, amount: 2750 } }]}
      />,
    );
    expect(within(blockOf("Ravi Kumar")).getByLabelText(/agreed amount/i)).toHaveValue(2750);
  });
});

describe("CoordinatorIncentivesSection — instalments", () => {
  it("records a payment for that person from their own block", async () => {
    const user = userEvent.setup();
    actions.recordIncentivePayment.mockResolvedValue({
      ok: true,
      data: { message: "Recorded." },
    });
    renderSection([RAVI, PRIYA]);

    await user.click(
      within(blockOf("Priya Suresh")).getByRole("button", { name: "Record payment for Priya Suresh" }),
    );
    const dialog = await screen.findByRole("dialog", { name: /record payment/i });
    // Priya has ₹2,000 left: that is the most that can be entered.
    expect(within(dialog).getByLabelText(/amount/i)).toHaveAttribute("max", "2000");
    await user.type(within(dialog).getByLabelText(/amount/i), "2000");
    await user.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    await waitFor(() => expect(actions.recordIncentivePayment).toHaveBeenCalledTimes(1));
    const formData = actions.recordIncentivePayment.mock.calls[0][1] as FormData;
    expect(formData.get("coordinator_id")).toBe("c3");
    expect(formData.get("amount")).toBe("2000");
  });

  it("corrects one instalment, naming it and not its neighbour", async () => {
    const user = userEvent.setup();
    actions.updateIncentivePayment.mockResolvedValue({ ok: true, data: { message: "Corrected." } });
    renderSection([PRIYA]);

    const [, second] = within(blockOf("Priya Suresh")).getAllByRole("listitem");
    await user.click(within(second).getByRole("button", { name: /^edit the/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit payment/i });
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(actions.updateIncentivePayment).toHaveBeenCalledTimes(1));
    const formData = actions.updateIncentivePayment.mock.calls[0][1] as FormData;
    expect(formData.get("payment_id")).toBe("pay-2");
  });

  it("removes one instalment after a confirmation", async () => {
    const user = userEvent.setup();
    actions.deleteIncentivePayment.mockResolvedValue({ ok: true, data: { message: "Removed." } });
    renderSection([PRIYA]);

    const [first] = within(blockOf("Priya Suresh")).getAllByRole("listitem");
    await user.click(within(first).getByRole("button", { name: /^remove the/i }));
    const dialog = await screen.findByRole("dialog", { name: /remove this payment/i });
    await user.click(within(dialog).getByRole("button", { name: "Remove payment" }));

    await waitFor(() => expect(actions.deleteIncentivePayment).toHaveBeenCalledTimes(1));
    const formData = actions.deleteIncentivePayment.mock.calls[0][1] as FormData;
    expect(formData.get("payment_id")).toBe("pay-1");
    expect(formData.get("project_id")).toBe("p1");
  });
});
