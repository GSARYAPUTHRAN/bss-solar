// @vitest-environment jsdom
// Amounts are compared through formatCurrency so the assertions do not depend on
// the ICU build's rupee formatting.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatCurrency } from "@/lib/format";
import type { WorkOrderListRow } from "@/lib/types";
import { WorkOrdersTable } from "./work-orders-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/work-orders",
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

const RAHUL = "11111111-1111-4111-8111-111111111111";
const PRIYA = "22222222-2222-4222-8222-222222222222";
const ARUN = "33333333-3333-4333-8333-333333333333";

const COORDINATORS = [
  { id: RAHUL, full_name: "Rahul Menon" },
  { id: PRIYA, full_name: "Priya Suresh" },
  { id: ARUN, full_name: "Arun Krishnan" },
];

let serial = 0;
function row(overrides: Partial<WorkOrderListRow> = {}): WorkOrderListRow {
  serial += 1;
  return {
    id: `wo-${serial}`,
    coordinator_id: RAHUL,
    client_name: `Client ${serial}`,
    client_phone: "98470 11111",
    address: null,
    plant_capacity: "3kW",
    plant_capacity_kw: 3,
    advance_amount: 20000,
    total_cost: 195000,
    order_date: "2026-09-01",
    status: "approved",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    coordinator_name: "Rahul Menon",
    coordinator_ids: [RAHUL],
    coordinator_names: ["Rahul Menon"],
    plan_type: "solar",
    cancellation: null,
    cancelled_on: null,
    project_id: "proj-1",
    current_stage: "material_dispatch",
    is_completed: false,
    consumer_number: null,
    notes: null,
    kseb_section: null,
    financing_type: "self",
    loan_bank_name: null,
    payments_total: 80000,
    payment_count: 1,
    last_payment_on: "2026-09-10",
    amount_received: 100000,
    balance_due: 95000,
    ...overrides,
  };
}

/** Rahul's sale, shared with Priya. */
function shared(overrides: Partial<WorkOrderListRow> = {}) {
  return row({
    client_name: "Anand Kumar",
    coordinator_name: "Rahul Menon, Priya Suresh",
    coordinator_ids: [RAHUL, PRIYA],
    coordinator_names: ["Rahul Menon", "Priya Suresh"],
    ...overrides,
  });
}

function renderTable(
  workOrders: WorkOrderListRow[],
  props: Partial<React.ComponentProps<typeof WorkOrdersTable>> = {},
) {
  return render(
    <WorkOrdersTable
      workOrders={workOrders}
      coordinators={COORDINATORS}
      isAdmin={false}
      viewerId={RAHUL}
      {...props}
    />,
  );
}

function rowFor(client: string): HTMLElement {
  const found = screen.getAllByRole("row").find((r) => r.textContent?.includes(client));
  if (!found) throw new Error(`no row for ${client}`);
  return found;
}

function clientCell(client: string): HTMLElement {
  return within(rowFor(client)).getAllByRole("cell")[0];
}

function cellUnder(client: string, header: string): HTMLElement {
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
  const at = headers.indexOf(header);
  if (at < 0) throw new Error(`no "${header}" column in ${headers.join(", ")}`);
  return within(rowFor(client)).getAllByRole("cell")[at];
}

/** The text of every data row on the page (not the header, not "No work orders found."). */
const shownClients = () =>
  screen
    .queryAllByRole("row")
    .filter((r) => within(r).queryAllByRole("cell").length > 1)
    .map((r) => r.textContent ?? "");

/** The filter trigger is named by what it currently shows ("All statuses", …). */
function filterShowing(current: string): HTMLElement {
  const trigger = screen.queryAllByRole("combobox").find((c) => c.textContent === current);
  if (!trigger) throw new Error(`no filter showing "${current}"`);
  return trigger;
}

async function pickFilter(current: string, option: string) {
  const user = userEvent.setup();
  await user.click(filterShowing(current));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("WorkOrdersTable — coordinators", () => {
  it("lists every coordinator on a shared sale, for the office and for a coordinator", () => {
    const { unmount } = renderTable([shared()], { isAdmin: true });
    expect(cellUnder("Anand Kumar", "Coordinators")).toHaveTextContent("Rahul Menon & Priya Suresh");
    unmount();

    renderTable([shared()], { viewerId: PRIYA });
    expect(cellUnder("Anand Kumar", "Coordinators")).toHaveTextContent("Rahul Menon & Priya Suresh");
  });

  it("names everyone on the sale for the office on a phone", () => {
    renderTable([shared()], { isAdmin: true, viewerId: undefined });
    expect(clientCell("Anand Kumar")).toHaveTextContent("3kW · 98470 11111 · Rahul Menon & Priya Suresh");
  });

  it("tells a coordinator who they share a sale with on a phone, and nothing about their own sales", () => {
    renderTable([shared(), row({ client_name: "Meera Nair" })], { viewerId: RAHUL });
    expect(clientCell("Anand Kumar")).toHaveTextContent("· with Priya Suresh");
    expect(clientCell("Meera Nair")).not.toHaveTextContent(/with|Rahul/);

    // Priya sees Rahul, not herself.
    const priya = renderTable([shared({ client_name: "Joint Sale" })], { viewerId: PRIYA });
    expect(within(priya.container).getAllByRole("row")[1]).toHaveTextContent("· with Rahul Menon");
  });
});

describe("WorkOrdersTable — a cancelled or refunded sale", () => {
  it("says so in the status, and is not outstanding", () => {
    renderTable([row({ client_name: "Refund Co", cancellation: "refunded", cancelled_on: "2026-09-20" })]);
    const status = cellUnder("Refund Co", "Status");
    expect(within(status).getByText("Approved")).toBeInTheDocument();
    expect(within(status).getByText("Refunded")).toBeInTheDocument();
    expect(within(status).queryByText(/balance/i)).toBeNull();
    expect(within(status).queryByText(/payment pending/i)).toBeNull();
    // The unpaid balance is not shown as owed.
    expect(cellUnder("Refund Co", "Balance")).toHaveTextContent("—");
    expect(cellUnder("Refund Co", "Balance")).not.toHaveTextContent(formatCurrency(95000));
  });

  it("a live approved sale shows its balance and payment state as before", () => {
    renderTable([row({ client_name: "Live Co" })]);
    expect(cellUnder("Live Co", "Balance")).toHaveTextContent(formatCurrency(95000));
    expect(within(cellUnder("Live Co", "Status")).getByText(/balance/i)).toBeInTheDocument();
  });

  it("marks a custom plan beside what was sold", () => {
    renderTable([row({ client_name: "Panel Co", plan_type: "custom", plant_capacity: "Inverter + panel" })]);
    const capacity = cellUnder("Panel Co", "Capacity");
    expect(capacity).toHaveTextContent("Inverter + panel");
    expect(within(capacity).getByText("Custom plan")).toBeInTheDocument();
  });
});

describe("WorkOrdersTable — filters", () => {
  it("offers every viewer the five states, cancelled and refunded included", async () => {
    renderTable([row()], { isAdmin: false });
    const user = userEvent.setup();
    await user.click(filterShowing("All statuses"));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["All statuses", "Pending", "Approved (active)", "Rejected", "Cancelled", "Refunded"]);
  });

  it("Approved (active) leaves out a refunded sale; Refunded finds it", async () => {
    renderTable([
      row({ client_name: "Live Co" }),
      row({ client_name: "Refund Co", cancellation: "refunded" }),
      row({ client_name: "Draft Co", status: "pending", project_id: null }),
    ]);
    await pickFilter("All statuses", "Approved (active)");
    expect(shownClients().join()).toContain("Live Co");
    expect(shownClients().join()).not.toContain("Refund Co");
    expect(shownClients().join()).not.toContain("Draft Co");

    await pickFilter("Approved (active)", "Refunded");
    expect(shownClients()).toHaveLength(1);
    expect(shownClients()[0]).toContain("Refund Co");
  });

  it("the office's coordinator filter finds a sale where that person is a partner", async () => {
    renderTable(
      [
        shared(),
        row({
          client_name: "Arun Only",
          coordinator_id: ARUN,
          coordinator_ids: [ARUN],
          coordinator_names: ["Arun Krishnan"],
          coordinator_name: "Arun Krishnan",
        }),
      ],
      { isAdmin: true },
    );
    await pickFilter("All coordinators", "Priya Suresh");
    expect(shownClients()).toHaveLength(1);
    expect(shownClients()[0]).toContain("Anand Kumar");

    await pickFilter("Priya Suresh", "Arun Krishnan");
    expect(shownClients()).toHaveLength(1);
    expect(shownClients()[0]).toContain("Arun Only");
  });

  it("has no coordinator filter for a coordinator", () => {
    renderTable([row()], { isAdmin: false });
    expect(() => filterShowing("All coordinators")).toThrow();
    expect(filterShowing("Any plan")).toBeInTheDocument();
  });

  it("filters by plan", async () => {
    renderTable([
      row({ client_name: "Solar Co" }),
      row({ client_name: "Panel Co", plan_type: "custom", plant_capacity: "1 panel" }),
    ]);
    await pickFilter("Any plan", "Custom plan");
    expect(shownClients()).toHaveLength(1);
    expect(shownClients()[0]).toContain("Panel Co");
    await pickFilter("Custom plan", "Solar plant");
    expect(shownClients()).toHaveLength(1);
    expect(shownClients()[0]).toContain("Solar Co");
  });

  it("Balance outstanding leaves out a refunded sale", async () => {
    renderTable([
      row({ client_name: "Owing Co" }),
      row({ client_name: "Refund Co", cancellation: "refunded" }),
      row({ client_name: "Paid Co", payments_total: 175000, amount_received: 195000, balance_due: 0 }),
    ]);
    await pickFilter("Any payment state", "Balance outstanding");
    expect(shownClients()).toHaveLength(1);
    expect(shownClients()[0]).toContain("Owing Co");
  });

  it("searches by any coordinator's name", async () => {
    renderTable([shared(), row({ client_name: "Meera Nair" })]);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/search client, phone/i), "priya");
    expect(shownClients()).toHaveLength(1);
    expect(shownClients()[0]).toContain("Anand Kumar");
  });
});
