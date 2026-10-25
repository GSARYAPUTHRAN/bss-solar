// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ updateCoordinatorIncentive: vi.fn() }));
vi.mock("@/app/(app)/projects/actions", () => actions);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import type { SaleCoordinator } from "@/lib/types";
import { CoordinatorIncentivesSection } from "./coordinator-incentives-section";

const TODAY = "2026-10-10";

const RAVI: SaleCoordinator = {
  id: "c1",
  full_name: "Ravi Kumar",
  sort_order: 1,
  incentive: { amount: 2000, paid_on: null },
};
const ABHIJITH: SaleCoordinator = {
  id: "c2",
  full_name: "Abhijith Nair",
  sort_order: 2,
  incentive: { amount: null, paid_on: null },
};

function renderSection(coordinators: SaleCoordinator[] = [RAVI, ABHIJITH]) {
  return render(
    <CoordinatorIncentivesSection projectId="p1" coordinators={coordinators} today={TODAY} />,
  );
}

const rowOf = (name: string) => screen.getByRole("form", { name: `Incentive for ${name}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CoordinatorIncentivesSection — one form per person", () => {
  it("shows each coordinator's own incentive and its state", () => {
    renderSection([
      RAVI,
      { ...ABHIJITH, incentive: { amount: 3500, paid_on: "2026-10-01" } },
    ]);

    const ravi = within(rowOf("Ravi Kumar"));
    expect(ravi.getByLabelText(/amount/i)).toHaveValue(2000);
    expect(ravi.getByLabelText(/paid on/i)).toHaveValue("");
    expect(ravi.getByText("Pending")).toBeInTheDocument();
    expect(ravi.getByText("logged the sale")).toBeInTheDocument();

    const abhijith = within(rowOf("Abhijith Nair"));
    expect(abhijith.getByLabelText(/amount/i)).toHaveValue(3500);
    expect(abhijith.getByLabelText(/paid on/i)).toHaveValue("2026-10-01");
    expect(abhijith.getByText("Paid 01 Oct 2026")).toBeInTheDocument();
    expect(abhijith.queryByText("logged the sale")).not.toBeInTheDocument();
  });

  it("an unset incentive reads 'Not set' with empty fields", () => {
    renderSection([ABHIJITH, RAVI]);
    const abhijith = within(rowOf("Abhijith Nair"));
    expect(abhijith.getByLabelText(/amount/i)).toHaveValue(null);
    expect(abhijith.getByText("Not set")).toBeInTheDocument();
  });

  it("a sale with one coordinator does not label anyone 'logged the sale'", () => {
    renderSection([RAVI]);
    expect(screen.queryByText("logged the sale")).not.toBeInTheDocument();
  });

  it("a paid date cannot be later than today", () => {
    renderSection([RAVI]);
    expect(within(rowOf("Ravi Kumar")).getByLabelText(/paid on/i)).toHaveAttribute("max", TODAY);
  });

  it("saves one person's incentive: their row alone is posted, and the message is toasted", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockResolvedValue({
      ok: true,
      data: { message: "Incentive saved for Abhijith Nair." },
    });
    renderSection();

    const abhijith = within(rowOf("Abhijith Nair"));
    await user.type(abhijith.getByLabelText(/amount/i), "3500");
    await user.click(abhijith.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.updateCoordinatorIncentive).toHaveBeenCalledTimes(1));
    const formData = actions.updateCoordinatorIncentive.mock.calls[0][1] as FormData;
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("coordinator_id")).toBe("c2");
    expect(formData.get("amount")).toBe("3500");
    expect(formData.get("paid_on")).toBe("");
    expect(toast.success).toHaveBeenCalledWith("Incentive saved for Abhijith Nair.");
  });

  it("clearing the amount posts it empty (that is how an incentive is removed)", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockResolvedValue({
      ok: true,
      data: { message: "Incentive saved for Ravi Kumar." },
    });
    renderSection();

    const ravi = within(rowOf("Ravi Kumar"));
    await user.clear(ravi.getByLabelText(/amount/i));
    await user.click(ravi.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.updateCoordinatorIncentive).toHaveBeenCalledTimes(1));
    const formData = actions.updateCoordinatorIncentive.mock.calls[0][1] as FormData;
    expect(formData.get("coordinator_id")).toBe("c1");
    expect(formData.get("amount")).toBe("");
  });

  it("shows a refusal in that person's row only, keeping what was typed", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockResolvedValue({
      ok: false,
      error: "Enter the incentive amount before marking it paid.",
    });
    renderSection();

    const abhijith = within(rowOf("Abhijith Nair"));
    await user.type(abhijith.getByLabelText(/paid on/i), "2026-10-01");
    await user.click(abhijith.getByRole("button", { name: "Save" }));

    expect(await abhijith.findByRole("alert")).toHaveTextContent(/before marking it paid/);
    expect(within(rowOf("Ravi Kumar")).queryByRole("alert")).not.toBeInTheDocument();
    expect(abhijith.getByLabelText(/paid on/i)).toHaveValue("2026-10-01");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a dropped connection in the row instead of the error page", async () => {
    const user = userEvent.setup();
    actions.updateCoordinatorIncentive.mockRejectedValue(new TypeError("Failed to fetch"));
    renderSection([RAVI]);

    const ravi = within(rowOf("Ravi Kumar"));
    await user.click(ravi.getByRole("button", { name: "Save" }));
    expect(await ravi.findByRole("alert")).toHaveTextContent(/couldn't reach the server/i);
  });
});
