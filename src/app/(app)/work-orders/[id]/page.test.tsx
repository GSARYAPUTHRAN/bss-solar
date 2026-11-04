// @vitest-environment jsdom
// The work order's page shows the same payment pieces as the project's payments
// section: the contract summary, the advance line and the ledger. These render
// it for a sale with every kind of entry in its ledger.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireWorkOrderRole: vi.fn() }));
vi.mock("@/server/data", () => ({
  profilesRepository: { coordinatorDirectory: vi.fn() },
  workOrdersRepository: { byId: vi.fn() },
}));
vi.mock("@/server/data/payments.repository", () => ({
  paymentsRepository: { listForWorkOrder: vi.fn() },
}));
vi.mock("../actions", () => ({
  approveWorkOrder: vi.fn(),
  rejectWorkOrder: vi.fn(),
  deleteWorkOrder: vi.fn(),
  setWorkOrderCoordinators: vi.fn(),
}));

import { requireWorkOrderRole } from "@/lib/auth";
import { profilesRepository, workOrdersRepository } from "@/server/data";
import { paymentsRepository } from "@/server/data/payments.repository";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Payment, Profile } from "@/lib/types";
import type { WorkOrderDetail } from "@/server/data/work-orders.repository";
import WorkOrderDetailPage from "./page";

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;
const RAHUL = { id: "c1", role: "coordinator", full_name: "Rahul Menon" } as Profile;

function entry(overrides: Partial<Payment> & Pick<Payment, "id" | "amount">): Payment {
  return {
    work_order_id: "wo-1",
    paid_on: "2026-09-20",
    method: "bank_transfer",
    purpose: "contract",
    paid_by_office: false,
    reference: null,
    notes: null,
    recorded_by: "admin-1",
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

// ₹3,00,000 sold. ₹40,000 advance by UPI, ₹1,50,000 + ₹1,20,000 in, ₹10,000 back.
const WORK_ORDER = {
  id: "wo-1",
  coordinator_id: "c1",
  client_name: "Gopinathan Pillai",
  client_phone: "+91 98470 12121",
  address: "Ettumanoor, Kottayam",
  plan_type: "solar",
  plant_capacity: "5kW",
  plant_capacity_kw: 5,
  advance_amount: 40000,
  advance_method: "upi",
  advance_paid_on: "2025-02-04",
  advance_reference: "UPI 4410021199",
  total_cost: 300000,
  order_date: "2025-02-01",
  status: "approved",
  financing_type: "self",
  loan_bank_name: null,
  consumer_number: null,
  kseb_section: null,
  notes: null,
  coordinators: [{ id: "c1", full_name: "Rahul Menon", sort_order: 1, incentive: null }],
  project: {
    id: "proj-1",
    current_stage: "plant_commissioning",
    is_completed: true,
    cancellation: null,
  },
} as unknown as WorkOrderDetail;

const LEDGER = [
  entry({ id: "p1", amount: 150000, paid_on: "2025-03-01", reference: "UTR 6620091144" }),
  entry({ id: "p2", amount: 120000, paid_on: "2025-04-01", reference: "CHQ 003317" }),
  entry({
    id: "r1",
    amount: 10000,
    purpose: "refund",
    paid_on: "2025-04-20",
    reference: "UTR 6620099021",
  }),
  entry({
    id: "k1",
    amount: 4720,
    purpose: "kseb_fees",
    paid_on: "2025-02-02",
    method: "upi",
  }),
  entry({
    id: "k2",
    amount: 5720,
    purpose: "kseb_fees",
    paid_by_office: true,
    paid_on: "2025-02-03",
    method: "cash",
  }),
];

async function renderPage(profile: Profile, wo: WorkOrderDetail | null = WORK_ORDER) {
  vi.mocked(requireWorkOrderRole).mockResolvedValue(profile);
  vi.mocked(workOrdersRepository.byId).mockResolvedValue(wo);
  const ui = await WorkOrderDetailPage({
    params: Promise.resolve({ id: "wo-1" }),
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

/** The value shown under a label. */
function valueOf(label: string): HTMLElement {
  const value = screen.getByText(label).nextElementSibling;
  if (!value) throw new Error(`no value for ${label}`);
  return value as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue(LEDGER);
  vi.mocked(profilesRepository.coordinatorDirectory).mockResolvedValue([]);
});

describe("the work order's page — payments", () => {
  it("heads the ledger with how and when the advance was paid", async () => {
    await renderPage(ADMIN);
    expect(
      screen.getByText(
        `Advance ${formatCurrency(40000)} · UPI · ${formatDate("2025-02-04")} · UPI 4410021199`,
      ),
    ).toBeInTheDocument();
  });

  it("splits what was collected, what went back and what is held", async () => {
    await renderPage(ADMIN);
    expect(valueOf("Collected")).toHaveTextContent(formatCurrency(310000));
    expect(valueOf("Refunded")).toHaveTextContent(`−${formatCurrency(10000)}`);
    expect(valueOf("Net received")).toHaveTextContent(formatCurrency(300000));
    expect(valueOf("Balance due")).toHaveTextContent(formatCurrency(0));
  });

  it("keeps the KSEB fees apart, the customer's from the office's", async () => {
    await renderPage(ADMIN);
    expect(valueOf("KSEB fees collected")).toHaveTextContent(formatCurrency(4720));
    expect(valueOf("KSEB fees paid by office")).toHaveTextContent(formatCurrency(5720));
  });

  it("lists a refund as a negative line and the office's fee with its tag", async () => {
    await renderPage(ADMIN);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const refund = rows.find((r) => within(r).getAllByRole("cell")[0].textContent === "Refund");
    expect(within(refund!).getByText(`−${formatCurrency(10000)}`)).toBeInTheDocument();
    expect(screen.getAllByText("Paid by office").length).toBeGreaterThan(0);
  });

  it("says a written-off sale is settled, with the reason in the ledger", async () => {
    vi.mocked(paymentsRepository.listForWorkOrder).mockResolvedValue([
      entry({ id: "p1", amount: 159200 }),
      entry({
        id: "w1",
        amount: 800,
        purpose: "write_off",
        method: "other",
        notes: "Customer was short at handover",
      }),
    ]);
    await renderPage(ADMIN, { ...WORK_ORDER, total_cost: 175000, advance_amount: 15000 });
    expect(screen.getByText(`Settled — ${formatCurrency(800)} written off`)).toBeInTheDocument();
    expect(
      screen.getAllByText("Written off — Customer was short at handover").length,
    ).toBeGreaterThan(0);
  });

  it("shows a coordinator the same figures, and no way to change them", async () => {
    await renderPage(RAHUL);
    expect(valueOf("Net received")).toHaveTextContent(formatCurrency(300000));
    expect(screen.getByText(/^Advance ₹/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record payment|write off|edit refund/i })).toBeNull();
    // The way to the ledger's controls is the project, for the office only.
    expect(screen.getByRole("link", { name: /open the payments ledger/i })).toHaveAttribute(
      "href",
      "/projects/proj-1#payments",
    );
  });

  it("shows no advance line for a sale with no advance and nothing recorded", async () => {
    await renderPage(ADMIN, {
      ...WORK_ORDER,
      advance_amount: 0,
      advance_method: null,
      advance_paid_on: null,
      advance_reference: null,
    });
    expect(screen.queryByText(/^Advance ₹/)).not.toBeInTheDocument();
  });

  it("is not found for an order the viewer cannot see", async () => {
    await expect(renderPage(RAHUL, null)).rejects.toThrow("NOT_FOUND");
  });
});
