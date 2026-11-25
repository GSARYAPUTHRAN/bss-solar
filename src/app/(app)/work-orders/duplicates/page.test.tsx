// @vitest-environment jsdom
// The duplicate clean-up page: deleters only, every sale read and grouped, the
// deletion log below with incentives named from the team directory.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const { requireDeleter, sales, recent, accounts } = vi.hoisted(() => ({
  requireDeleter: vi.fn(),
  sales: vi.fn(),
  recent: vi.fn(),
  accounts: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireDeleter }));
vi.mock("@/server/data", () => ({
  duplicatesRepository: { sales },
  deletionLogRepository: { recent },
  profilesRepository: { accounts },
}));
vi.mock("@/app/(app)/work-orders/actions", () => ({ deleteWorkOrders: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { CleanupSale } from "@/lib/domain/duplicate-sales";
import type { DeletedRecord } from "@/lib/domain/deletion-log";
import { formatCurrencyWhole } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { RECENTLY_DELETED_LIMIT } from "@/components/work-orders/recently-deleted";
import DuplicatesPage from "./page";

beforeAll(() => {
  // Radix measures the checkbox with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;

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

const SALES = [
  sale({ id: "a1", clientName: "Anil Kumar", consumerNumber: "1156304012345", paymentCount: 2 }),
  sale({ id: "a2", clientName: "Anil Kumar", consumerNumber: "1156 304 012345", createdAt: "2026-03-05T05:00:00Z" }),
  sale({ id: "b1", clientName: "Beena Joseph", orderDate: "2026-01-10" }),
];

const INCENTIVE_DELETE: DeletedRecord = {
  id: 9,
  tableName: "coordinator_incentives",
  recordId: "wo-9:rahul-1",
  snapshot: { work_order_id: "wo-9", coordinator_id: "rahul-1", amount: 15000 },
  deletedByName: "BSS SuperAdmin",
  deletedAt: "2026-11-24T08:00:00Z",
  tx: 900,
};

async function renderPage() {
  return render(await DuplicatesPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  requireDeleter.mockResolvedValue(ADMIN);
  sales.mockResolvedValue(SALES);
  recent.mockResolvedValue([INCENTIVE_DELETE]);
  accounts.mockResolvedValue({
    accounts: [{ id: "rahul-1", fullName: "Rahul Menon", email: null, role: "coordinator" }],
    error: null,
  });
});

describe("the duplicates page", () => {
  it("is for deleters: the guard runs before anything is read", async () => {
    requireDeleter.mockRejectedValue(new Error("REDIRECT:/"));
    await expect(DuplicatesPage()).rejects.toThrow("REDIRECT:/");
    expect(sales).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
  });

  it("explains what counts as a duplicate, with the way back", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Find duplicates" })).toBeInTheDocument();
    expect(
      screen.getByText(/the same KSEB consumer number, or the same customer name on the same order date/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute("href", "/work-orders");
  });

  it("says names match loosely but not by spelling — a different spelling is another customer", async () => {
    await renderPage();
    const header = screen.getByText(/the same KSEB consumer number/);
    expect(header).toHaveTextContent(
      "Names are matched ignoring capitals, spacing, punctuation, word order and how initials are written — but not spelling",
    );
    // It used to claim spelling was ignored, which the matching never did.
    expect(header).not.toHaveTextContent(/spelling, word order and initials ignored/);
  });

  it("groups the sales it read, and leaves single sales out", async () => {
    await renderPage();
    expect(screen.getByTestId("duplicate-summary")).toHaveTextContent(
      "1 group · 1 extra copy selected",
    );
    const group = screen.getByRole("group", { name: /^Anil Kumar/ });
    expect(within(group).getByText("Same consumer number")).toBeInTheDocument();
    expect(screen.queryByText("Beena Joseph")).toBeNull();
  });

  it("lists recent deletes, naming the coordinator of a deleted incentive", async () => {
    await renderPage();
    expect(screen.getByText(`Incentive — ${formatCurrencyWhole(15000)} (Rahul Menon)`)).toBeInTheDocument();
    expect(recent).toHaveBeenCalledTimes(1);
  });

  it("reads the log as whole deletes, as many as the section lists", async () => {
    await renderPage();
    // A number of deletes, not of rows: a bulk clean-up is never cut in part.
    expect(recent).toHaveBeenCalledWith(RECENTLY_DELETED_LIMIT);
  });

  it("lists a bulk delete whole: every sale in its headline count, and older deletes after it", async () => {
    // What recent() returns for two deletes: 120 sales with a project each, then an older incentive.
    const bulk: DeletedRecord[] = Array.from({ length: 120 }, (_, i) => [
      {
        id: 1000 + i,
        tableName: "work_orders",
        recordId: `wo-${i}`,
        snapshot: { client_name: `Copy ${i}`, order_date: "2026-03-02", total_cost: 100000 },
        deletedByName: "BSS Admin",
        deletedAt: "2026-11-25T08:00:00Z",
        tx: 950,
      },
      {
        id: 2000 + i,
        tableName: "projects",
        recordId: `p-${i}`,
        snapshot: { work_order_id: `wo-${i}` },
        deletedByName: "BSS Admin",
        deletedAt: "2026-11-25T08:00:00Z",
        tx: 950,
      },
    ]).flat();
    recent.mockResolvedValue([...bulk, INCENTIVE_DELETE]);
    await renderPage();

    const entries = within(screen.getByRole("list", { name: "Recent deletes" })).getAllByRole(
      "listitem",
    ).filter((item) => item.parentElement?.getAttribute("aria-label") === "Recent deletes");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("+115 more");
    expect(entries[0]).toHaveTextContent("Also removed: 120 projects");
    expect(entries[1]).toHaveTextContent(`Incentive — ${formatCurrencyWhole(15000)} (Rahul Menon)`);
  });

  it("still lists the delete without the name when the directory cannot be read", async () => {
    accounts.mockResolvedValue({ accounts: [], error: "permission denied" });
    await renderPage();
    expect(screen.getByText(`Incentive — ${formatCurrencyWhole(15000)}`)).toBeInTheDocument();
  });

  it("says when there is nothing to clean up", async () => {
    sales.mockResolvedValue([SALES[2]]);
    recent.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("No duplicate sales found.")).toBeInTheDocument();
    expect(screen.getByText("Nothing has been deleted yet.")).toBeInTheDocument();
  });

  it("fails to the error page rather than saying 'no duplicates' when a read fails", async () => {
    sales.mockRejectedValue(new Error("Could not read sales for the duplicate check: boom"));
    await expect(DuplicatesPage()).rejects.toThrow(/duplicate check/);
  });

  it("fails rather than saying 'nothing deleted' when the log cannot be read", async () => {
    recent.mockRejectedValue(new Error("Could not read the deletion log: boom"));
    await expect(DuplicatesPage()).rejects.toThrow(/deletion log/);
  });
});
