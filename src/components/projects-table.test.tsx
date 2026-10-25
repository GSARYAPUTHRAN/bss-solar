// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatCurrency } from "@/lib/format";
import {
  ARUN,
  PENDING_INCENTIVE,
  PRIYA,
  RAHUL,
  projectListRow,
  sharedSale,
} from "@/components/projects/project-list-row.fixture";
import type { ProjectListRow } from "@/lib/types";
import { ProjectsTable } from "./projects-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/loading/loading-context", () => ({ useLoading: () => ({ trackStart: vi.fn() }) }));

// jsdom lacks what Radix Select needs to open its list.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const COORDINATORS = [
  { id: RAHUL, full_name: "Rahul Menon" },
  { id: PRIYA, full_name: "Priya Suresh" },
  { id: ARUN, full_name: "Arun Krishnan" },
];

function renderTable(
  projects: ProjectListRow[],
  props: Partial<Parameters<typeof ProjectsTable>[0]> = {},
) {
  return render(
    <ProjectsTable
      projects={projects}
      coordinators={COORDINATORS}
      isAdmin={false}
      viewerId={RAHUL}
      {...props}
    />,
  );
}

function rowFor(client: string): HTMLElement {
  const row = screen.getAllByRole("row").find((r) => r.textContent?.includes(client));
  if (!row) throw new Error(`no row for ${client}`);
  return row;
}

/** The client cell: on a phone the only column shown, carrying the summary. */
function clientCell(client: string): HTMLElement {
  return within(rowFor(client)).getAllByRole("cell")[0];
}

/** A row's cell under the column header named `header`. */
function cellUnder(client: string, header: string): HTMLElement {
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
  const at = headers.indexOf(header);
  if (at < 0) throw new Error(`no "${header}" column in ${headers.join(", ")}`);
  return within(rowFor(client)).getAllByRole("cell")[at];
}

async function pickFilter(current: string, option: string) {
  const user = userEvent.setup();
  const trigger = screen.getAllByRole("combobox").find((c) => c.textContent === current);
  if (!trigger) throw new Error(`no filter showing "${current}"`);
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("ProjectsTable — phone summary", () => {
  it("shows each project's incentive total and its state", () => {
    renderTable(
      [
        projectListRow({ ...PENDING_INCENTIVE }),
        projectListRow({
          id: "20000000-0000-0000-0000-000000000002",
          client_name: "Meera Nair",
          incentive_total: 8000,
          incentive_unpaid: 0,
          incentive_count: 1,
          incentive_unpaid_count: 0,
          incentive_paid_coordinator_ids: [RAHUL],
        }),
        projectListRow({ id: "20000000-0000-0000-0000-000000000003", client_name: "Sreeja Pillai" }),
      ],
      { isAdmin: true },
    );

    const pending = clientCell("Anand Kumar");
    expect(within(pending).getByText("Incentive")).toBeInTheDocument();
    expect(within(pending).getByText(formatCurrency(5000))).toBeInTheDocument();
    expect(within(pending).getByText("Pending")).toBeInTheDocument();

    const paid = clientCell("Meera Nair");
    expect(within(paid).getByText(formatCurrency(8000))).toBeInTheDocument();
    expect(within(paid).getByText("Paid")).toBeInTheDocument();

    // No incentive set: no empty "Incentive —" line on the card.
    expect(within(clientCell("Sreeja Pillai")).queryByText("Incentive")).toBeNull();
  });

  it("says Partly paid when only some of the people on a shared sale have been paid", () => {
    renderTable(
      [
        sharedSale({
          incentive_total: 12000,
          incentive_unpaid: 4000,
          incentive_count: 2,
          incentive_unpaid_count: 1,
          incentive_unpaid_coordinator_ids: [PRIYA],
          incentive_paid_coordinator_ids: [RAHUL],
        }),
      ],
      { isAdmin: true },
    );
    const cell = clientCell("Anand Kumar");
    expect(within(cell).getByText(formatCurrency(12000))).toBeInTheDocument();
    expect(within(cell).getByText("Partly paid")).toBeInTheDocument();
  });

  it("words a coordinator's own incentive as theirs", () => {
    renderTable([projectListRow({ ...PENDING_INCENTIVE })], { viewerId: RAHUL });
    expect(within(clientCell("Anand Kumar")).getByText("Your incentive")).toBeInTheDocument();
  });

  it("names everyone on the sale for the office", () => {
    renderTable([sharedSale()], { isAdmin: true });
    expect(clientCell("Anand Kumar")).toHaveTextContent("3kW · Rahul Menon & Priya Suresh");
  });

  it("tells a coordinator who they share a sale with, and nothing about their own sales", () => {
    renderTable(
      [
        sharedSale(),
        projectListRow({ id: "20000000-0000-0000-0000-000000000002", client_name: "Meera Nair" }),
      ],
      { viewerId: RAHUL },
    );
    expect(clientCell("Anand Kumar")).toHaveTextContent("3kW · with Priya Suresh");
    expect(clientCell("Meera Nair")).not.toHaveTextContent(/with|Rahul/);
  });

  it("keeps a cancelled project's payment badge out of the summary and shows its status", () => {
    renderTable([projectListRow({ cancellation: "refunded", cancelled_on: "2026-09-20" })]);
    const cell = clientCell("Anand Kumar");
    expect(within(cell).getByText("Refunded")).toBeInTheDocument();
    expect(within(cell).queryByText(/nothing due/i)).toBeNull();
    expect(within(cell).queryByText(/balance/i)).toBeNull();
  });

  it("marks a custom plan", () => {
    renderTable([projectListRow({ plan_type: "custom", plant_capacity: "Inverter + panel" })]);
    const cell = clientCell("Anand Kumar");
    expect(within(cell).getByText("Custom plan")).toBeInTheDocument();
    expect(cell).toHaveTextContent("Inverter + panel");
  });
});

describe("ProjectsTable — columns", () => {
  it("lists every coordinator on a shared sale, for the office and for a coordinator", () => {
    const { unmount } = renderTable([sharedSale()], { isAdmin: true });
    expect(cellUnder("Anand Kumar", "Coordinators")).toHaveTextContent(
      "Rahul Menon & Priya Suresh",
    );
    unmount();

    renderTable([sharedSale()], { viewerId: PRIYA });
    expect(cellUnder("Anand Kumar", "Coordinators")).toHaveTextContent(
      "Rahul Menon & Priya Suresh",
    );
  });

  it("shows the incentive total in the Incentive column", () => {
    renderTable(
      [
        sharedSale({
          incentive_total: 12000,
          incentive_unpaid: 12000,
          incentive_count: 2,
          incentive_unpaid_count: 2,
        }),
      ],
      { isAdmin: true },
    );
    const cell = cellUnder("Anand Kumar", "Incentive");
    expect(cell).toHaveTextContent(formatCurrency(12000));
    expect(cell).toHaveTextContent("Pending");
  });

  it("does not read the deprecated single-incentive columns", () => {
    renderTable([projectListRow({ coordinator_incentive: 9999, incentive_paid_on: "2026-05-20" })]);
    expect(cellUnder("Anand Kumar", "Incentive")).toHaveTextContent(/^—$/);
  });

  it("explains the Incentive total to the office and to a coordinator", () => {
    const { unmount } = renderTable([projectListRow()], { isAdmin: true });
    expect(screen.getByTitle("Total for everyone on the sale")).toHaveTextContent("Incentive");
    unmount();
    renderTable([projectListRow()]);
    expect(screen.getByTitle("Your incentive on the sale")).toHaveTextContent("Incentive");
  });

  it("puts Cancelled / Refunded ahead of Commissioned and the stage", () => {
    renderTable([
      projectListRow({ client_name: "Live", current_stage: "panel_installation" }),
      projectListRow({ id: "2", client_name: "Done", is_completed: true }),
      projectListRow({ id: "3", client_name: "Gone", cancellation: "cancelled" }),
      projectListRow({ id: "4", client_name: "Back", is_completed: true, cancellation: "refunded" }),
    ]);
    expect(cellUnder("Live", "Current Stage")).toHaveTextContent("Panel Installation");
    expect(cellUnder("Done", "Current Stage")).toHaveTextContent("Commissioned");
    expect(cellUnder("Gone", "Current Stage")).toHaveTextContent("Cancelled");
    // A commissioned plant that was then refunded reads as refunded.
    expect(cellUnder("Back", "Current Stage")).toHaveTextContent("Refunded");
    expect(cellUnder("Back", "Current Stage")).not.toHaveTextContent("Commissioned");
  });

  it("calls a finished custom plan handed over, and its only stage Handover", () => {
    renderTable([
      projectListRow({
        client_name: "Open",
        plan_type: "custom",
        current_stage: "plant_commissioning",
      }),
      projectListRow({
        id: "2",
        client_name: "Shut",
        plan_type: "custom",
        current_stage: "plant_commissioning",
        is_completed: true,
      }),
    ]);
    expect(cellUnder("Open", "Current Stage")).toHaveTextContent("Handover");
    expect(cellUnder("Shut", "Current Stage")).toHaveTextContent("Handed over");
  });

  it("shows the plan next to its label", () => {
    renderTable([
      projectListRow({ client_name: "Custom", plan_type: "custom", plant_capacity: "1 panel" }),
      projectListRow({ id: "2", client_name: "Solar" }),
    ]);
    expect(cellUnder("Custom", "Capacity")).toHaveTextContent("1 panelCustom plan");
    expect(cellUnder("Solar", "Capacity")).toHaveTextContent(/^3kW$/);
  });

  it("has no feasibility for a custom plan or a cancelled project that never had a date", () => {
    renderTable([
      projectListRow({ client_name: "Custom", plan_type: "custom" }),
      projectListRow({ id: "2", client_name: "Cancelled", cancellation: "cancelled" }),
      projectListRow({ id: "3", client_name: "Plain" }),
    ]);
    expect(cellUnder("Custom", "Feasibility")).toHaveTextContent(/^—$/);
    expect(cellUnder("Cancelled", "Feasibility")).toHaveTextContent(/^—$/);
    // A live solar project without a date is still flagged.
    expect(cellUnder("Plain", "Feasibility")).toHaveTextContent("Feasibility not set");
  });

  it("keeps the renewal cost visible on a cancelled project whose clock ran", () => {
    renderTable([
      projectListRow({
        cancellation: "refunded",
        cancelled_on: "2026-09-20",
        feasibility_date: "2026-07-01",
        feasibility_periods: 3,
        feasibility_renewals: 2,
        feasibility_valid_until: "2026-09-29",
        feasibility_days_left: null,
        feasibility_extension_cost: 2000,
      }),
    ]);
    expect(cellUnder("Anand Kumar", "Feasibility")).toHaveTextContent("Closed · 2 renewals");
  });

  it("says nothing is due on a cancelled project, whatever its ledger shows", () => {
    renderTable([projectListRow({ cancellation: "refunded", balance_due: 175000 })]);
    const cell = cellUnder("Anand Kumar", "Payment");
    expect(cell).toHaveTextContent("Nothing due — refunded");
    expect(cell).not.toHaveTextContent(/balance|pending/i);
  });
});

describe("ProjectsTable — sorting", () => {
  function clientOrder(): string[] {
    return screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].querySelector("span")?.textContent ?? "");
  }

  it("sorts the Incentive column by the sale's incentive total", async () => {
    const user = userEvent.setup();
    renderTable(
      [
        projectListRow({
          client_name: "Mid",
          incentive_total: 3000,
          incentive_count: 1,
          incentive_unpaid_count: 1,
        }),
        projectListRow({ id: "2", client_name: "None" }),
        sharedSale({
          id: "3",
          client_name: "Top",
          incentive_total: 9000,
          incentive_count: 2,
          incentive_unpaid_count: 2,
        }),
      ],
      { isAdmin: true },
    );

    await user.click(screen.getByRole("button", { name: "Incentive" }));
    expect(clientOrder()).toEqual(["None", "Mid", "Top"]);
    await user.click(screen.getByRole("button", { name: "Incentive" }));
    expect(clientOrder()).toEqual(["Top", "Mid", "None"]);
  });

  it("does not sort by the deprecated single-incentive column", async () => {
    const user = userEvent.setup();
    renderTable(
      [
        projectListRow({
          client_name: "Legacy high",
          coordinator_incentive: 99999,
          incentive_total: 1000,
          incentive_count: 1,
          incentive_unpaid_count: 1,
        }),
        projectListRow({
          id: "2",
          client_name: "Total high",
          coordinator_incentive: null,
          incentive_total: 8000,
          incentive_count: 1,
          incentive_unpaid_count: 1,
        }),
      ],
      { isAdmin: true },
    );
    await user.click(screen.getByRole("button", { name: "Incentive" }));
    expect(clientOrder()).toEqual(["Legacy high", "Total high"]);
  });
});

describe("ProjectsTable — filters", () => {
  const LIVE = projectListRow({ client_name: "Live Sale" });
  const COMMISSIONED = projectListRow({
    id: "2",
    client_name: "Commissioned Sale",
    is_completed: true,
    payment_pending: true,
  });
  const CANCELLED = projectListRow({ id: "3", client_name: "Cancelled Sale", cancellation: "cancelled" });
  const REFUNDED = projectListRow({
    id: "4",
    client_name: "Refunded Sale",
    is_completed: true,
    payment_pending: false,
    cancellation: "refunded",
  });
  const CUSTOM = projectListRow({
    id: "5",
    client_name: "Custom Sale",
    plan_type: "custom",
    plant_capacity: "Inverter + panel",
  });
  const ALL = [LIVE, COMMISSIONED, CANCELLED, REFUNDED, CUSTOM];

  function shown(): string[] {
    return ALL.map((p) => p.client_name as string).filter((name) => screen.queryByText(name));
  }

  it("offers the cancelled and refunded statuses", async () => {
    renderTable(ALL, { isAdmin: true });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("combobox").find((c) => c.textContent === "All projects")!);
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "All projects",
      "Active",
      "Commissioned",
      "Commissioned · payment pending",
      "Cancelled",
      "Refunded",
      "Cancelled or refunded",
    ]);
  });

  it("keeps cancelled and refunded projects out of Active and Commissioned", async () => {
    renderTable(ALL, { isAdmin: true });
    await pickFilter("All projects", "Active");
    expect(shown()).toEqual(["Live Sale", "Custom Sale"]);
  });

  it("filters to the refunded projects", async () => {
    renderTable(ALL, { isAdmin: true });
    await pickFilter("All projects", "Refunded");
    expect(shown()).toEqual(["Refunded Sale"]);
  });

  it("filters to cancelled or refunded together", async () => {
    renderTable(ALL, { isAdmin: true });
    await pickFilter("All projects", "Cancelled or refunded");
    expect(shown()).toEqual(["Cancelled Sale", "Refunded Sale"]);
  });

  it("filters by plan", async () => {
    renderTable(ALL, { isAdmin: true });
    await pickFilter("Any plan", "Custom plan");
    expect(shown()).toEqual(["Custom Sale"]);
  });

  it("offers both plans", async () => {
    renderTable(ALL, { isAdmin: true });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("combobox").find((c) => c.textContent === "Any plan")!);
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Any plan",
      "Solar plant",
      "Custom plan",
    ]);
  });

  it("matches a coordinator on any of the sale's team, not only its first", async () => {
    renderTable(
      [
        projectListRow({ client_name: "Rahul Alone" }),
        sharedSale({ id: "2", client_name: "Rahul And Priya" }),
        projectListRow({
          id: "3",
          client_name: "Arun Alone",
          coordinator_ids: [ARUN],
          coordinator_names: ["Arun Krishnan"],
        }),
      ],
      { isAdmin: true },
    );
    await pickFilter("All coordinators", "Priya Suresh");
    expect(screen.queryByText("Rahul And Priya")).toBeInTheDocument();
    expect(screen.queryByText("Rahul Alone")).toBeNull();
    expect(screen.queryByText("Arun Alone")).toBeNull();
  });

  it("has no coordinator filter for a coordinator", () => {
    renderTable(ALL);
    expect(screen.queryByText("All coordinators")).toBeNull();
  });

  it("finds the incentives still to pay, a partly paid sale included", async () => {
    renderTable(
      [
        projectListRow({ client_name: "No Incentive Sale" }),
        projectListRow({ id: "2", client_name: "Pending Sale", ...PENDING_INCENTIVE }),
        sharedSale({
          id: "3",
          client_name: "Partly Sale",
          incentive_total: 9000,
          incentive_unpaid: 4000,
          incentive_count: 2,
          incentive_unpaid_count: 1,
        }),
        projectListRow({
          id: "4",
          client_name: "Paid Sale",
          incentive_total: 3000,
          incentive_count: 1,
          incentive_unpaid_count: 0,
        }),
      ],
      { isAdmin: true },
    );
    await pickFilter("Any incentive", "Incentive pending");
    expect(screen.queryByText("Pending Sale")).toBeInTheDocument();
    expect(screen.queryByText("Partly Sale")).toBeInTheDocument();
    expect(screen.queryByText("No Incentive Sale")).toBeNull();
    expect(screen.queryByText("Paid Sale")).toBeNull();
  });
});

describe("ProjectsTable — footer", () => {
  it("counts the rows it holds as projects", () => {
    renderTable([projectListRow()]);
    expect(screen.getByText("Showing 1–1 of 1 projects")).toBeInTheDocument();
  });

  it("names the rows as the caller says, so a capped slice never reads as the total", () => {
    renderTable([projectListRow()], { noun: "latest projects" });
    expect(screen.getByText("Showing 1–1 of 1 latest projects")).toBeInTheDocument();
  });
});
