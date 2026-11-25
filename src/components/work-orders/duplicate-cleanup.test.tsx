// @vitest-environment jsdom
// The duplicate clean-up: groups built by the real findDuplicateGroups from
// sales as the repository reads them, the suggested copies ticked, and the bulk
// delete behind a confirmation that must be acknowledged.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ deleteWorkOrders: vi.fn() }));
vi.mock("@/app/(app)/work-orders/actions", () => actions);

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  unstable_rethrow: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// A small cap, so "too many" needs only a handful of rows.
vi.mock("@/lib/domain/duplicate-sales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/duplicate-sales")>()),
  MAX_BULK_DELETE: 4,
}));

import { SERVER_UNREACHABLE_MESSAGE } from "@/lib/constants";
import {
  STALE_SELECTION,
  findDuplicateGroups,
  type CleanupSale,
  type DuplicateGroup,
} from "@/lib/domain/duplicate-sales";
import { formatCurrencyWhole, formatDate, formatDateTime } from "@/lib/format";
import {
  DuplicateCleanup,
  STALE_NOTICE,
  carriedSelection,
  deletedMessage,
  keepGroups,
  saleStanding,
  selectionLine,
  summaryText,
  wholeGroupsWarning,
} from "./duplicate-cleanup";

beforeAll(() => {
  // Radix measures the checkbox with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function sale(over: Partial<CleanupSale> & Pick<CleanupSale, "id" | "clientName">): CleanupSale {
  return {
    orderDate: "2026-03-02",
    createdAt: "2026-03-02T05:00:00Z",
    consumerNumber: null,
    status: "approved",
    cancellation: null,
    coordinatorNames: ["Rahul Menon"],
    totalCost: 235000,
    amountReceived: 0,
    paymentCount: 0,
    projectId: null,
    currentStage: null,
    isCompleted: false,
    ticketCount: 0,
    planType: "solar",
    ...over,
  };
}

/** Kept: the copy whose project got furthest, with the money and a ticket. */
const ANIL = sale({
  id: "anil-1",
  clientName: "Anil Kumar",
  consumerNumber: "1156304012345",
  projectId: "p-1",
  currentStage: "kseb_portal_registration",
  paymentCount: 3,
  amountReceived: 100000,
  ticketCount: 1,
});
/** The same consumer number typed differently, the name in capitals; a different price; never approved. */
const ANIL_AGAIN = sale({
  id: "anil-2",
  clientName: "ANIL KUMAR",
  consumerNumber: "1156-304-012345",
  status: "pending",
  totalCost: 240000,
  paymentCount: 1,
  createdAt: "2026-03-03T06:30:00Z",
});
/** Same customer (word order aside) on the same day; rejected. */
const KUMAR_ANIL = sale({
  id: "anil-3",
  clientName: "Kumar Anil",
  status: "rejected",
  createdAt: "2026-03-04T09:15:00Z",
});
/** Kept: commissioned. */
const BEENA = sale({
  id: "beena-1",
  clientName: "Beena Joseph",
  orderDate: "2026-02-10",
  createdAt: "2026-02-10T04:00:00Z",
  projectId: "p-2",
  currentStage: "plant_commissioning",
  isCompleted: true,
  paymentCount: 2,
  ticketCount: 2,
});
/** A cancelled copy by another coordinator, with one entry and one ticket. */
const BEENA_AGAIN = sale({
  id: "beena-2",
  clientName: "Beena Joseph",
  orderDate: "2026-02-10",
  createdAt: "2026-02-11T04:00:00Z",
  projectId: "p-3",
  currentStage: "site_feasibility_survey",
  cancellation: "cancelled",
  coordinatorNames: ["Priya Suresh"],
  paymentCount: 1,
  ticketCount: 1,
});
/** Not a copy of anything. */
const LONE = sale({ id: "lone-1", clientName: "Chithra Nair", orderDate: "2026-01-05" });

const GROUPS = findDuplicateGroups([BEENA_AGAIN, LONE, ANIL, KUMAR_ANIL, BEENA, ANIL_AGAIN]);

function renderCleanup(groups: readonly DuplicateGroup[] = GROUPS) {
  const user = userEvent.setup();
  const view = render(<DuplicateCleanup groups={groups} />);
  return { user, ...view };
}

const groupOf = (name: string) => screen.getByRole("group", { name: new RegExp(`^${name}`) });
const boxFor = (copy: CleanupSale) =>
  screen.getByRole("checkbox", {
    name: `Delete ${copy.clientName} — added ${formatDateTime(copy.createdAt)}`,
  });
const rowOf = (copy: CleanupSale) => boxFor(copy).closest("tr") as HTMLElement;
const deleteSelected = () => screen.getByRole("button", { name: /^delete selected/i });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the groups", () => {
  it("are what findDuplicateGroups found, newest order first", () => {
    expect(GROUPS.map((g) => g.keeperId)).toEqual(["anil-1", "beena-1"]);
    expect(GROUPS[0].reasons).toEqual(["consumer_number", "customer_and_date"]);
    expect(GROUPS[1].reasons).toEqual(["customer_and_date"]);
  });

  it("show each group as a card titled by the kept copy, with why they match", () => {
    renderCleanup();
    expect(groupOf("Anil Kumar")).toHaveAccessibleName(
      new RegExp(`^Anil Kumar\s*${formatDate("2026-03-02")}$`),
    );
    const anil = within(groupOf("Anil Kumar"));
    expect(anil.getByText("Same consumer number")).toBeInTheDocument();
    expect(anil.getByText("Same customer & date")).toBeInTheDocument();
    expect(anil.getByText("3 copies")).toBeInTheDocument();

    const beena = within(groupOf("Beena Joseph"));
    expect(beena.getByText("Same customer & date")).toBeInTheDocument();
    expect(beena.queryByText("Same consumer number")).toBeNull();
  });

  it("marks the suggested copy Keep, unticked, and ticks every other copy", () => {
    renderCleanup();
    expect(within(rowOf(ANIL)).getByText("Keep")).toBeInTheDocument();
    expect(boxFor(ANIL)).not.toBeChecked();
    expect(boxFor(ANIL_AGAIN)).toBeChecked();
    expect(boxFor(KUMAR_ANIL)).toBeChecked();
    expect(within(rowOf(ANIL_AGAIN)).queryByText("Keep")).toBeNull();
    expect(boxFor(BEENA)).not.toBeChecked();
    expect(boxFor(BEENA_AGAIN)).toBeChecked();
    expect(screen.getByTestId("duplicate-summary")).toHaveTextContent(
      "2 groups · 3 extra copies selected",
    );
  });

  it("shows every copy's details, the client linking to its work order", () => {
    renderCleanup();
    const row = within(rowOf(ANIL));
    expect(row.getByRole("link", { name: /^Anil Kumar\s*\(opens in a new tab\)$/ })).toHaveAttribute(
      "href",
      "/work-orders/anil-1",
    );
    const cells = row.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "",
      "Anil Kumar (opens in a new tab)Keep",
      formatDate("2026-03-02"),
      formatDateTime("2026-03-02T05:00:00Z"),
      "Rahul Menon",
      formatCurrencyWhole(235000),
      formatCurrencyWhole(100000),
      "3",
      "KSEB Portal Registration / PM Surya Ghar",
      "1",
      "1156304012345",
    ]);
    expect(within(rowOf(KUMAR_ANIL)).getAllByRole("cell").at(-1)).toHaveTextContent("—");
  });

  it("opens a copy in a new tab, so going to look at it never loses the ticks here", () => {
    renderCleanup();
    const link = within(rowOf(ANIL_AGAIN)).getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(link).getByText("(opens in a new tab)")).toHaveClass("sr-only");
  });

  it("says where each copy stands: commissioned, cancelled, pending or rejected", () => {
    renderCleanup();
    expect(within(rowOf(BEENA)).getByText("Commissioned")).toBeInTheDocument();
    expect(within(rowOf(BEENA_AGAIN)).getByText("Cancelled")).toBeInTheDocument();
    expect(within(rowOf(ANIL_AGAIN)).getByText("Pending")).toBeInTheDocument();
    expect(within(rowOf(KUMAR_ANIL)).getByText("Rejected")).toBeInTheDocument();
  });

  it("picks out, in amber and for screen readers, what differs from the kept copy", () => {
    renderCleanup();
    const flagged = (copy: CleanupSale) =>
      within(rowOf(copy))
        .queryAllByText("(differs from the kept copy)")
        .map((note) => note.parentElement!.textContent!.replace(" (differs from the kept copy)", ""));

    // Price, money, status and the spelling of the name.
    expect(flagged(ANIL_AGAIN)).toEqual([
      "ANIL KUMAR",
      formatCurrencyWhole(240000),
      formatCurrencyWhole(0),
      "Pending",
    ]);
    expect(within(rowOf(ANIL_AGAIN)).getByText(formatCurrencyWhole(240000))).toHaveClass(
      "text-amber-700",
    );
    // Another coordinator, and a cancelled project.
    expect(flagged(BEENA_AGAIN)).toEqual(["Priya Suresh", "Cancelled"]);
    // The kept copy is the reference: nothing of it is flagged.
    expect(flagged(ANIL)).toEqual([]);
    expect(flagged(BEENA)).toEqual([]);
  });

  it("shows the plan only where it tells copies apart, flagging the odd one", () => {
    const custom = sale({ id: "dev-2", clientName: "Devi R", planType: "custom", createdAt: "2026-03-05T00:00:00Z" });
    const solar = sale({ id: "dev-1", clientName: "Devi R", paymentCount: 2 });
    const [group] = findDuplicateGroups([custom, solar]);
    renderCleanup([group]);
    expect(within(rowOf(solar)).getByText("Solar plan")).toBeInTheDocument();
    expect(within(rowOf(custom)).getByText("Custom plan")).toHaveClass("text-amber-700");
  });

  it("flags another consumer number, and leaves that copy unticked", () => {
    // One customer, one day: the copy without a number joins the two numbered
    // ones, but 222 is another connection — maybe another sale.
    const first = sale({ id: "ravi-1", clientName: "Ravi P", consumerNumber: "1156000000111", paymentCount: 2 });
    const blank = sale({ id: "ravi-2", clientName: "Ravi P", createdAt: "2026-03-03T05:00:00Z" });
    const other = sale({ id: "ravi-3", clientName: "Ravi P", consumerNumber: "1156000000222", createdAt: "2026-03-04T05:00:00Z" });
    const [group] = findDuplicateGroups([first, blank, other]);
    expect(group.keeperId).toBe("ravi-1");
    renderCleanup([group]);

    const number = within(rowOf(other)).getByText("1156000000222");
    expect(number).toHaveClass("text-amber-700");
    expect(number).toHaveTextContent("(differs from the kept copy)");
    expect(within(rowOf(blank)).getByText("—")).not.toHaveClass("text-amber-700");
    expect(boxFor(blank)).toBeChecked();
    expect(boxFor(other)).not.toBeChecked();
    expect(within(rowOf(other)).getByText("Kept")).toBeInTheDocument();
  });

  it("leaves the plan out when every copy is the usual solar plan", () => {
    renderCleanup();
    expect(screen.queryByText("Solar plan")).toBeNull();
    expect(screen.queryByText("Custom plan")).toBeNull();
  });

  it("navigates nowhere when a row's box is ticked — only the name is a link", async () => {
    const { user } = renderCleanup();
    await user.click(boxFor(ANIL));
    expect(boxFor(ANIL)).toBeChecked();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(within(rowOf(ANIL)).getAllByRole("link")).toHaveLength(1);
  });

  it("is phone-sized to tap: the box's hit area, the name and the buttons are 40px", () => {
    renderCleanup();
    expect(boxFor(ANIL)).toHaveClass("after:-inset-3");
    expect(within(rowOf(ANIL)).getByRole("link")).toHaveClass("min-h-10");
    expect(deleteSelected()).toHaveClass("h-10");
    expect(screen.getByRole("button", { name: /reset selection/i })).toHaveClass("h-10");
    expect(screen.getByRole("button", { name: /clear selection/i })).toHaveClass("h-10");
  });

  it("keeps the delete bar in view while the groups scroll", () => {
    renderCleanup();
    expect(screen.getByRole("region", { name: "Selected copies" })).toHaveClass("sticky", "bottom-0");
  });
});

describe("the selection", () => {
  it("counts what is ticked, and resets to the suggestion", async () => {
    const { user } = renderCleanup();
    const reset = screen.getByRole("button", { name: /reset selection/i });
    expect(reset).toBeDisabled();

    await user.click(boxFor(BEENA_AGAIN));
    expect(screen.getByTestId("duplicate-summary")).toHaveTextContent(
      "2 groups · 2 extra copies selected",
    );
    expect(deleteSelected()).toHaveTextContent("Delete selected (2)");
    expect(reset).toBeEnabled();

    await user.click(reset);
    expect(boxFor(BEENA_AGAIN)).toBeChecked();
    expect(deleteSelected()).toHaveTextContent("Delete selected (3)");
    expect(reset).toBeDisabled();
  });

  it("cannot delete nothing", async () => {
    const { user } = renderCleanup();
    for (const copy of [ANIL_AGAIN, KUMAR_ANIL, BEENA_AGAIN]) await user.click(boxFor(copy));
    expect(deleteSelected()).toHaveTextContent("Delete selected (0)");
    expect(deleteSelected()).toBeDisabled();
  });

  it("refuses more than one delete can take, and says so", async () => {
    const { user } = renderCleanup();
    await user.click(boxFor(ANIL));
    expect(deleteSelected()).toBeEnabled(); // 4: at the cap
    expect(screen.queryByRole("button", { name: /select the first/i })).toBeNull();
    await user.click(boxFor(BEENA));
    expect(deleteSelected()).toBeDisabled();
    expect(screen.getByText("At most 4 sales can be deleted at once — select fewer.")).toBeInTheDocument();
  });

  it("over the cap, selects the first ones the page lists in one click — never adding a tick", async () => {
    // One sale entered seven times: six extra copies ticked, over the cap of 4.
    const copies = Array.from({ length: 7 }, (_, i) =>
      sale({
        id: `devi-${i}`,
        clientName: "Devi R",
        createdAt: `2026-03-0${i + 2}T05:00:00Z`,
        paymentCount: i === 0 ? 2 : 0,
      }),
    );
    const groups = findDuplicateGroups(copies);
    const { user } = renderCleanup(groups);
    expect(deleteSelected()).toHaveTextContent("Delete selected (6)");
    expect(deleteSelected()).toBeDisabled();

    const firstFour = screen.getByRole("button", { name: "Select the first 4" });
    expect(firstFour).toHaveClass("h-10");
    await user.click(firstFour);

    expect(deleteSelected()).toHaveTextContent("Delete selected (4)");
    expect(deleteSelected()).toBeEnabled();
    expect(screen.queryByText(/at most 4 sales/i)).toBeNull();
    // The first four extra copies in page order; the kept copy stays unticked.
    const shown = groups[0].sales;
    expect(boxFor(shown[0])).not.toBeChecked();
    for (const copy of shown.slice(1, 5)) expect(boxFor(copy)).toBeChecked();
    for (const copy of shown.slice(5)) expect(boxFor(copy)).not.toBeChecked();
  });

  it("clears every tick in one click, and resets back to the suggestion", async () => {
    const { user } = renderCleanup();
    const clear = screen.getByRole("button", { name: /clear selection/i });
    await user.click(clear);
    for (const copy of [ANIL, ANIL_AGAIN, KUMAR_ANIL, BEENA, BEENA_AGAIN]) {
      expect(boxFor(copy)).not.toBeChecked();
    }
    expect(deleteSelected()).toHaveTextContent("Delete selected (0)");
    expect(deleteSelected()).toBeDisabled();
    expect(clear).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /reset selection/i }));
    expect(deleteSelected()).toHaveTextContent("Delete selected (3)");
    expect(clear).toBeEnabled();
  });

  it("keeps the ticks when the same groups render again", async () => {
    const { user, rerender } = renderCleanup();
    await user.click(boxFor(BEENA_AGAIN));
    rerender(<DuplicateCleanup groups={[...GROUPS]} />);
    expect(boxFor(BEENA_AGAIN)).not.toBeChecked();
  });

  it("keeps the person's ticks on a group still there after a delete elsewhere", async () => {
    const { user, rerender } = renderCleanup();
    // Beena's second copy is kept on purpose; Anil's group is then cleaned up.
    await user.click(boxFor(BEENA_AGAIN));
    rerender(<DuplicateCleanup groups={GROUPS.slice(1)} />);
    expect(boxFor(BEENA_AGAIN)).not.toBeChecked();
    expect(deleteSelected()).toHaveTextContent("Delete selected (0)");
    expect(screen.getByTestId("duplicate-summary")).toHaveTextContent(
      "1 group · 0 extra copies selected",
    );
  });

  it("keeps an unchanged group exactly as chosen, the kept copy ticked included", async () => {
    const { user, rerender } = renderCleanup();
    await user.click(boxFor(ANIL));
    rerender(<DuplicateCleanup groups={GROUPS.slice(0, 1)} />);
    expect(boxFor(ANIL)).toBeChecked();
    expect(boxFor(ANIL_AGAIN)).toBeChecked();
    expect(boxFor(KUMAR_ANIL)).toBeChecked();
  });

  it("starts a group whose copies changed from the suggestion", async () => {
    const { user, rerender } = renderCleanup();
    await user.click(boxFor(ANIL));
    await user.click(boxFor(ANIL_AGAIN));
    await user.click(boxFor(BEENA_AGAIN));
    // One of Anil's copies went (another tab): that group is a new one.
    const changed = findDuplicateGroups([BEENA_AGAIN, LONE, ANIL, BEENA, ANIL_AGAIN]);
    expect(changed[0].key).not.toBe(GROUPS[0].key);
    expect(changed[1].key).toBe(GROUPS[1].key);
    rerender(<DuplicateCleanup groups={changed} />);

    expect(boxFor(ANIL)).not.toBeChecked();
    expect(boxFor(ANIL_AGAIN)).toBeChecked();
    // Beena's group did not change: still as chosen.
    expect(boxFor(BEENA_AGAIN)).not.toBeChecked();
    expect(screen.getByTestId("duplicate-summary")).toHaveTextContent(
      "2 groups · 1 extra copy selected",
    );
  });
});

describe("carriedSelection", () => {
  it("keeps the chosen ticks of unchanged groups and re-suggests the rest", () => {
    // Anil's kept copy ticked and Beena's extra copy unticked, against the suggestion.
    const before = {
      signature: GROUPS.map((g) => g.key).join("|"),
      selected: new Set(["anil-1", "anil-2", "anil-3"]),
    };
    expect([...carriedSelection(GROUPS, before)].sort()).toEqual(["anil-1", "anil-2", "anil-3"]);
    // Anil's group lost a copy, so it is re-suggested; Beena's stays unticked.
    const changed = findDuplicateGroups([BEENA_AGAIN, ANIL, BEENA, ANIL_AGAIN]);
    expect([...carriedSelection(changed, before)].sort()).toEqual(["anil-2"]);
  });

  it("re-suggests everything when nothing was on the page before", () => {
    expect([...carriedSelection(GROUPS, { signature: "", selected: new Set() })].sort()).toEqual([
      "anil-2",
      "anil-3",
      "beena-2",
    ]);
  });
});

describe("the Keep badge", () => {
  it("follows the tick: the suggested copy, once ticked, says it will be deleted", async () => {
    const { user } = renderCleanup();
    await user.click(boxFor(ANIL));
    const row = within(rowOf(ANIL));
    expect(row.queryByText("Keep")).toBeNull();
    expect(row.getByText("Suggested keep — will be deleted")).toHaveClass("text-amber-800");

    await user.click(boxFor(ANIL));
    expect(row.getByText("Keep")).toBeInTheDocument();
    expect(row.queryByText("Suggested keep — will be deleted")).toBeNull();
  });

  it("marks another copy left unticked as kept, and a ticked one not at all", async () => {
    const { user } = renderCleanup();
    expect(within(rowOf(ANIL_AGAIN)).queryByText("Kept")).toBeNull();
    await user.click(boxFor(ANIL_AGAIN));
    expect(within(rowOf(ANIL_AGAIN)).getByText("Kept")).toBeInTheDocument();
    expect(within(rowOf(ANIL_AGAIN)).queryByText("Keep")).toBeNull();
  });
});

describe("deleting", () => {
  async function openConfirm() {
    const view = renderCleanup();
    await view.user.click(deleteSelected());
    const dialog = await screen.findByRole("dialog", { name: "Delete 3 sales?" });
    return { ...view, dialog };
  }
  const understood = (dialog: HTMLElement) =>
    within(dialog).getByRole("checkbox", { name: "I understand these sales are deleted permanently" });
  const confirmButton = (dialog: HTMLElement) =>
    within(dialog).getByRole("button", { name: "Delete 3 sales" });

  it("says what goes with the selection before anything is deleted", async () => {
    const { dialog } = await openConfirm();
    expect(dialog).toHaveAccessibleDescription(
      "3 sales, with 1 project and 2 ledger entries; 1 service ticket will lose its project link.",
    );
    expect(dialog).toHaveTextContent(/cannot be undone/);
    expect(within(dialog).queryByText(/^Every copy of/)).toBeNull();
    expect(actions.deleteWorkOrders).not.toHaveBeenCalled();
  });

  it("starts on Cancel, and the delete waits for the tick", async () => {
    const { user, dialog } = await openConfirm();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(confirmButton(dialog)).toBeDisabled();
    await user.click(understood(dialog));
    expect(confirmButton(dialog)).toBeEnabled();
  });

  it("warns in red when every copy of a sale is ticked", async () => {
    const { user } = renderCleanup();
    await user.click(boxFor(BEENA));
    await user.click(deleteSelected());
    const dialog = await screen.findByRole("dialog", { name: "Delete 4 sales?" });
    const warning = within(dialog).getByText(
      "Every copy of Beena Joseph is selected — nothing of that sale will be left.",
    );
    expect(warning).toHaveClass("text-destructive");
  });

  it("deletes the ticked copies in page order, says so, and refreshes", async () => {
    actions.deleteWorkOrders.mockResolvedValue({ ok: true, deleted: 3, requested: 3 });
    const { user, dialog } = await openConfirm();
    await user.click(understood(dialog));
    await user.click(confirmButton(dialog));

    await waitFor(() => expect(actions.deleteWorkOrders).toHaveBeenCalledTimes(1));
    // With the copies each group keeps, for the server to check they are still there.
    expect(actions.deleteWorkOrders).toHaveBeenCalledWith(
      ["anil-2", "anil-3", "beena-2"],
      [["anil-1"], ["beena-1"]],
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("3 duplicate sales deleted."));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("names every copy a group keeps, leaving out untouched groups and those deleted whole", async () => {
    actions.deleteWorkOrders.mockResolvedValue({ ok: true, deleted: 3, requested: 3 });
    const { user } = renderCleanup();
    // Anil: the kept copy and one extra stay. Beena: every copy goes (warned).
    await user.click(boxFor(ANIL_AGAIN));
    await user.click(boxFor(BEENA));
    await user.click(deleteSelected());
    const dialog = await screen.findByRole("dialog", { name: "Delete 3 sales?" });
    await user.click(understood(dialog));
    await user.click(confirmButton(dialog));

    await waitFor(() => expect(actions.deleteWorkOrders).toHaveBeenCalledTimes(1));
    expect(actions.deleteWorkOrders).toHaveBeenCalledWith(
      ["anil-3", "beena-1", "beena-2"],
      [["anil-1", "anil-2"]],
    );
  });

  it("when a kept copy went elsewhere meanwhile, deletes nothing, re-reads the groups and says to look again", async () => {
    actions.deleteWorkOrders.mockResolvedValue({ ok: false, error: STALE_SELECTION });
    const { user, dialog } = await openConfirm();
    await user.click(understood(dialog));
    await user.click(confirmButton(dialog));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    // The dialog closes, so a delete needs a fresh look and a fresh tick.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const bar = screen.getByRole("region", { name: "Selected copies" });
    expect(within(bar).getByRole("alert")).toHaveTextContent(STALE_NOTICE);
    expect(toast.success).not.toHaveBeenCalled();

    // It goes once the person opens the confirmation again.
    await user.click(deleteSelected());
    await screen.findByRole("dialog");
    expect(within(bar).queryByRole("alert")).toBeNull();
  });

  it("still says why nothing was deleted when the re-read leaves no groups", async () => {
    actions.deleteWorkOrders.mockResolvedValue({ ok: false, error: STALE_SELECTION });
    const { user, dialog, rerender } = await openConfirm();
    await user.click(understood(dialog));
    await user.click(confirmButton(dialog));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));

    rerender(<DuplicateCleanup groups={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(STALE_NOTICE);
    expect(screen.getByText("No duplicate sales found.")).toBeInTheDocument();
  });

  it("says when some were already gone", async () => {
    actions.deleteWorkOrders.mockResolvedValue({ ok: true, deleted: 2, requested: 3 });
    const { user, dialog } = await openConfirm();
    await user.click(understood(dialog));
    await user.click(confirmButton(dialog));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("2 of 3 deleted; the others were already gone."),
    );
  });

  it("shows a refusal in the dialog and deletes nothing more", async () => {
    actions.deleteWorkOrders.mockResolvedValue({
      ok: false,
      error: "Nothing was deleted: permission denied",
    });
    const { user, dialog } = await openConfirm();
    await user.click(understood(dialog));
    await user.click(confirmButton(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Nothing was deleted: permission denied",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("shows a dropped connection in the dialog instead of the error page", async () => {
    actions.deleteWorkOrders.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user, dialog } = await openConfirm();
    await user.click(understood(dialog));
    await user.click(confirmButton(dialog));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(SERVER_UNREACHABLE_MESSAGE);
  });

  it("starts clear every time it opens", async () => {
    const { user, dialog } = await openConfirm();
    await user.click(understood(dialog));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(deleteSelected());
    const again = await screen.findByRole("dialog");
    expect(understood(again)).not.toBeChecked();
    expect(confirmButton(again)).toBeDisabled();
  });

  it("asks in the singular for one sale", async () => {
    const { user } = renderCleanup(GROUPS.slice(1));
    await user.click(deleteSelected());
    const dialog = await screen.findByRole("dialog", { name: "Delete 1 sale?" });
    expect(
      within(dialog).getByRole("checkbox", { name: "I understand this sale is deleted permanently" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete 1 sale" })).toBeDisabled();
  });
});

describe("nothing to clean up", () => {
  it("says so, with the way back", () => {
    renderCleanup([]);
    expect(screen.getByText("No duplicate sales found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Work orders" })).toHaveAttribute(
      "href",
      "/work-orders",
    );
    expect(screen.queryByRole("button", { name: /^delete selected/i })).toBeNull();
  });
});

describe("the words", () => {
  it("selectionLine counts groups and copies", () => {
    expect(selectionLine(1, 1)).toBe("1 group · 1 extra copy selected");
    expect(selectionLine(4, 0)).toBe("4 groups · 0 extra copies selected");
  });

  it("summaryText lists what goes, and the tickets only when there are some", () => {
    const summary = { sales: 1, projects: 0, ledgerEntries: 1, tickets: 0, wholeGroups: [] };
    expect(summaryText(summary)).toBe("1 sale, with 0 projects and 1 ledger entry.");
    expect(summaryText({ ...summary, sales: 5, projects: 2, ledgerEntries: 7, tickets: 3 })).toBe(
      "5 sales, with 2 projects and 7 ledger entries; 3 service tickets will lose their project link.",
    );
  });

  it("deletedMessage says how many went", () => {
    expect(deletedMessage(1, 1)).toBe("1 duplicate sale deleted.");
    expect(deletedMessage(4, 4)).toBe("4 duplicate sales deleted.");
    expect(deletedMessage(0, 2)).toBe("0 of 2 deleted; the others were already gone.");
  });

  it("keepGroups lists, per group deleted from, the copies that stay", () => {
    expect(keepGroups(GROUPS, new Set())).toEqual([]);
    expect(keepGroups(GROUPS, new Set(["anil-2", "anil-3", "beena-2"]))).toEqual([
      ["anil-1"],
      ["beena-1"],
    ]);
    // Every copy of Beena's sale selected: nothing to keep there, already warned.
    expect(keepGroups(GROUPS, new Set(["anil-1", "beena-1", "beena-2"]))).toEqual([
      ["anil-2", "anil-3"],
    ]);
  });

  it("wholeGroupsWarning names every sale that would be gone", () => {
    expect(wholeGroupsWarning([])).toBeNull();
    expect(wholeGroupsWarning(["A", "B", "C"])).toBe(
      "Every copy of A, B and C is selected — nothing of those sales will be left.",
    );
  });

  it("saleStanding reads the project before the work order", () => {
    expect(saleStanding(sale({ id: "x", clientName: "X", status: "pending" }))).toBe("Pending");
    expect(saleStanding(sale({ id: "x", clientName: "X", status: "approved" }))).toBe("Approved");
    expect(
      saleStanding(sale({ id: "x", clientName: "X", projectId: "p", cancellation: "refunded" })),
    ).toBe("Refunded");
    expect(
      saleStanding(
        sale({ id: "x", clientName: "X", projectId: "p", isCompleted: true, planType: "custom" }),
      ),
    ).toBe("Handed over");
    expect(
      saleStanding(
        sale({
          id: "x",
          clientName: "X",
          projectId: "p",
          currentStage: "plant_commissioning",
          planType: "custom",
        }),
      ),
    ).toBe("Handover");
  });
});
