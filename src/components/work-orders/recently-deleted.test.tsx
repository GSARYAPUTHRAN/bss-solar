// @vitest-environment jsdom
// The deletion log on the clean-up page: one entry per delete, newest first.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { groupDeletions, type DeletionGroup, type DeletedRecord } from "@/lib/domain/deletion-log";
import { formatDateTime } from "@/lib/format";
import { RECENTLY_DELETED_LIMIT, RecentlyDeleted } from "./recently-deleted";

function group(over: Partial<DeletionGroup> & Pick<DeletionGroup, "tx">): DeletionGroup {
  return {
    deletedAt: "2026-11-25T09:40:00Z",
    deletedByName: "BSS Admin",
    kind: "work_orders",
    headline: ["Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000"],
    alsoRemoved: [],
    ...over,
  };
}

/** The deletes, one item each (not the records named inside them). */
const entries = () =>
  within(screen.getByRole("list", { name: "Recent deletes" }))
    .getAllByRole("listitem")
    .filter((item) => item.parentElement?.getAttribute("aria-label") === "Recent deletes");

describe("RecentlyDeleted", () => {
  it("says deletes are permanent and how a sale can come back", () => {
    render(<RecentlyDeleted groups={[]} />);
    expect(screen.getByText("Recently deleted")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Deletes are permanent. The office can ask for a deleted sale to be restored from this log with SQL.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing has been deleted yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows when (India time), who, what and what went with it", () => {
    render(
      <RecentlyDeleted
        groups={[
          group({
            tx: 7,
            alsoRemoved: [
              { kind: "projects", count: 1, label: "1 project" },
              { kind: "payments", count: 3, label: "3 ledger entries" },
            ],
          }),
        ]}
      />,
    );
    const [entry] = entries();
    expect(within(entry).getByText(formatDateTime("2026-11-25T09:40:00Z"))).toHaveAttribute(
      "datetime",
      "2026-11-25T09:40:00Z",
    );
    expect(entry).toHaveTextContent("BSS Admin");
    expect(entry).toHaveTextContent("Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000");
    expect(entry).toHaveTextContent("Also removed: 1 project, 3 ledger entries");
  });

  it("names at most five records of a delete, then counts the rest", () => {
    const headline = Array.from({ length: 8 }, (_, i) => `Sale — Client ${i + 1}`);
    render(<RecentlyDeleted groups={[group({ tx: 1, headline })]} />);
    const [entry] = entries();
    expect(within(entry).getByText("Sale — Client 5")).toBeInTheDocument();
    expect(within(entry).queryByText("Sale — Client 6")).toBeNull();
    expect(within(entry).getByText("+3 more")).toBeInTheDocument();
  });

  it("leaves out 'also removed' when nothing went with it, and copes with an unknown actor", () => {
    render(<RecentlyDeleted groups={[group({ tx: 1, deletedByName: null })]} />);
    const [entry] = entries();
    expect(entry).not.toHaveTextContent("Also removed");
    expect(entry).toHaveTextContent("Unknown");
  });

  it(`lists the latest ${RECENTLY_DELETED_LIMIT} deletes, in the order given`, () => {
    const groups = Array.from({ length: RECENTLY_DELETED_LIMIT + 5 }, (_, i) =>
      group({ tx: i + 1, headline: [`Ticket BSS-${1000 + i}`] }),
    );
    render(<RecentlyDeleted groups={groups} />);
    const list = entries();
    expect(list).toHaveLength(RECENTLY_DELETED_LIMIT);
    expect(list[0]).toHaveTextContent("Ticket BSS-1000");
    expect(screen.queryByText(`Ticket BSS-${1000 + RECENTLY_DELETED_LIMIT}`)).toBeNull();
  });

  it("reads groupDeletions' output as the page passes it", () => {
    const rows: DeletedRecord[] = [
      {
        id: 1,
        tableName: "work_orders",
        recordId: "wo-1",
        snapshot: { id: "wo-1", client_name: "Anil Kumar", order_date: "2025-02-12", total_cost: 235000 },
        deletedByName: "BSS SuperAdmin",
        deletedAt: "2026-11-25T10:00:00Z",
        tx: 42,
      },
      {
        id: 2,
        tableName: "projects",
        recordId: "p-1",
        snapshot: { id: "p-1", work_order_id: "wo-1" },
        deletedByName: "BSS SuperAdmin",
        deletedAt: "2026-11-25T10:00:00Z",
        tx: 42,
      },
    ];
    render(<RecentlyDeleted groups={groupDeletions(rows)} />);
    const [entry] = entries();
    expect(entry).toHaveTextContent("BSS SuperAdmin");
    expect(entry).toHaveTextContent("Sale — Anil Kumar");
    expect(entry).toHaveTextContent("Also removed: 1 project");
  });
});
