// @vitest-environment jsdom
// Deleting a whole sale from the work order's page ("Delete") or the project's
// ("Delete sale"): one confirmation, saying everything that goes with it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ deleteWorkOrder: vi.fn() }));
vi.mock("@/app/(app)/work-orders/actions", () => actions);

import { DeleteSaleButton, saleDeleteDescription, type SaleToDelete } from "./delete-sale-button";

const SALE: SaleToDelete = {
  id: "wo-1",
  clientName: "Anil Kumar",
  hasProject: true,
  ledgerEntries: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saleDeleteDescription", () => {
  it("lists the project, the ledger and the incentives, and that tickets stay", () => {
    expect(saleDeleteDescription(SALE)).toBe(
      "This permanently deletes the sale Anil Kumar, its project and milestones, 3 ledger entries and every coordinator's incentive. Service tickets stay but lose their link to the project. This cannot be undone.",
    );
  });

  it("counts one ledger entry in the singular", () => {
    expect(saleDeleteDescription({ ...SALE, ledgerEntries: 1 })).toContain(", 1 ledger entry and");
  });

  it("leaves out a ledger with nothing in it", () => {
    expect(saleDeleteDescription({ ...SALE, ledgerEntries: 0 })).toBe(
      "This permanently deletes the sale Anil Kumar, its project and milestones and every coordinator's incentive. Service tickets stay but lose their link to the project. This cannot be undone.",
    );
  });

  it("has no project or tickets to speak of before the sale is approved", () => {
    expect(saleDeleteDescription({ ...SALE, hasProject: false, ledgerEntries: 2 })).toBe(
      "This permanently deletes the sale Anil Kumar, 2 ledger entries and every coordinator's incentive. This cannot be undone.",
    );
    expect(saleDeleteDescription({ ...SALE, hasProject: false, ledgerEntries: 0 })).toBe(
      "This permanently deletes the sale Anil Kumar and every coordinator's incentive. This cannot be undone.",
    );
  });

  it("still reads when the client's name is missing", () => {
    expect(saleDeleteDescription({ ...SALE, clientName: "  " })).toMatch(
      /^This permanently deletes this sale, its project/,
    );
  });
});

describe("DeleteSaleButton", () => {
  it("on the work order's page is 'Delete', and deletes the work order", async () => {
    const user = userEvent.setup();
    render(<DeleteSaleButton sale={SALE} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this work order?" });
    expect(dialog).toHaveAccessibleDescription(saleDeleteDescription(SALE));
    await user.click(within(dialog).getByRole("button", { name: "Delete work order" }));

    await vi.waitFor(() => expect(actions.deleteWorkOrder).toHaveBeenCalledTimes(1));
    const formData = actions.deleteWorkOrder.mock.calls[0][0] as FormData;
    expect(formData.get("id")).toBe("wo-1");
    expect(formData.has("back")).toBe(false);
  });

  it("on the project page is 'Delete sale', and comes back to the projects list", async () => {
    const user = userEvent.setup();
    render(<DeleteSaleButton sale={SALE} back="projects" />);

    await user.click(screen.getByRole("button", { name: "Delete sale" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this sale?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sale" }));

    await vi.waitFor(() => expect(actions.deleteWorkOrder).toHaveBeenCalledTimes(1));
    const formData = actions.deleteWorkOrder.mock.calls[0][0] as FormData;
    expect(formData.get("id")).toBe("wo-1");
    expect(formData.get("back")).toBe("projects");
    expect(formData.has("project_id")).toBe(false);
  });

  it("sends the project id along, so a refusal shows on the project page", async () => {
    const user = userEvent.setup();
    render(<DeleteSaleButton sale={SALE} back="projects" projectId="p-1" />);
    await user.click(screen.getByRole("button", { name: "Delete sale" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this sale?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sale" }));
    await vi.waitFor(() => expect(actions.deleteWorkOrder).toHaveBeenCalledTimes(1));
    const formData = actions.deleteWorkOrder.mock.calls[0][0] as FormData;
    expect(formData.get("project_id")).toBe("p-1");
  });

  it("does nothing until the confirmation is accepted", async () => {
    const user = userEvent.setup();
    render(<DeleteSaleButton sale={SALE} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.deleteWorkOrder).not.toHaveBeenCalled();
  });

  it("is big enough to tap", () => {
    render(<DeleteSaleButton sale={SALE} />);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("h-10");
  });
});
