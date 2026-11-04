// @vitest-environment jsdom
// The project page decides who sees what: the office everything, the sale's
// coordinators a read-only view with only their own incentive. These render the
// page for each viewer and kind of project.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireWorkOrderRole: vi.fn() }));
vi.mock("@/server/data", () => ({
  projectsRepository: { byId: vi.fn() },
  ticketsRepository: { listByProject: vi.fn() },
}));
vi.mock("@/server/data/payments.repository", () => ({
  paymentsRepository: { listForWorkOrder: vi.fn() },
}));
vi.mock("../actions", () => ({
  advanceProject: vi.fn(),
  deleteProject: vi.fn(),
  updateMilestone: vi.fn(),
  updateProjectSettings: vi.fn(),
  updateCoordinatorIncentive: vi.fn(),
  recordIncentivePayment: vi.fn(),
  updateIncentivePayment: vi.fn(),
  deleteIncentivePayment: vi.fn(),
  setProjectCancellation: vi.fn(),
  reinstateProject: vi.fn(),
}));
// An async server component of its own; it has its own tests.
vi.mock("@/components/payments/project-payments-section", () => ({
  ProjectPaymentsSection: (props: { cancellation?: string | null }) => (
    <div data-testid="payments" data-cancellation={props.cancellation ?? ""} />
  ),
}));

import { requireWorkOrderRole } from "@/lib/auth";
import { projectsRepository, ticketsRepository } from "@/server/data";
import { paymentsRepository } from "@/server/data/payments.repository";
import { formatCurrency } from "@/lib/format";
import type { Payment, Profile, ServiceTicket } from "@/lib/types";
import type { ProjectCoordinator, ProjectDetail } from "@/server/data/projects.repository";
import ProjectDetailPage from "./page";

const projects = vi.mocked(projectsRepository);
const tickets = vi.mocked(ticketsRepository);
const payments = vi.mocked(paymentsRepository);

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;
const SUPERADMIN = { id: "super-1", role: "superadmin", full_name: "BSS SuperAdmin" } as Profile;
const RAVI_PROFILE = { id: "c1", role: "coordinator", full_name: "Ravi Kumar" } as Profile;

const RAVI = (incentive: ProjectCoordinator["incentive"]): ProjectCoordinator => ({
  id: "c1",
  full_name: "Ravi Kumar",
  sort_order: 1,
  incentive,
});
const ABHIJITH = (incentive: ProjectCoordinator["incentive"]): ProjectCoordinator => ({
  id: "c2",
  full_name: "Abhijith Nair",
  sort_order: 2,
  incentive,
});

/** Ravi: ₹6,000 agreed, ₹4,000 paid in two instalments (₹2,000 still to pay). */
const RAVI_PAID_IN_PART = {
  amount: 6000,
  paid_on: null,
  payments: [
    {
      id: "pay-1",
      amount: 2000,
      paid_on: "2026-09-01",
      note: "Advance",
      recorded_by: "admin-1",
      recorded_by_name: "BSS Admin",
    },
    {
      id: "pay-2",
      amount: 2000,
      paid_on: "2026-09-15",
      note: "Cheque 004211",
      recorded_by: "admin-1",
      recorded_by_name: "BSS Admin",
    },
  ],
  paid: 4000,
};
/** Abhijith: ₹3,500 agreed, ₹1,000 paid — what Ravi must never see. */
const ABHIJITH_PAID_IN_PART = {
  amount: 3500,
  paid_on: null,
  payments: [
    {
      id: "pay-9",
      amount: 1000,
      paid_on: "2026-09-20",
      note: "Abhijith only",
      recorded_by: "admin-1",
      recorded_by_name: "BSS Admin",
    },
  ],
  paid: 1000,
};

const MILESTONES: ProjectDetail["milestones"] = [
  {
    id: "m1",
    project_id: "p1",
    stage: "site_feasibility_survey",
    sort_order: 1,
    status: "completed",
    notes: null,
    completed_at: "2026-08-02T05:00:00Z",
  },
  {
    id: "m2",
    project_id: "p1",
    stage: "kseb_portal_registration",
    sort_order: 2,
    status: "in_progress",
    notes: null,
    completed_at: null,
  },
];

function project(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    work_order_id: "wo1",
    current_stage: "kseb_portal_registration",
    is_completed: false,
    started_at: "2026-08-01T05:00:00Z",
    completed_at: null,
    created_at: "2026-08-01T05:00:00Z",
    updated_at: "2026-08-01T05:00:00Z",
    feasibility_date: "2026-09-25",
    cancellation: null,
    cancelled_on: null,
    cancelled_by: null,
    cancellation_remarks: null,
    cancelled_by_name: null,
    // As the office loads it: everyone's incentive.
    coordinators: [
      RAVI({ amount: 2000, paid_on: null, payments: [], paid: 0 }),
      ABHIJITH({ amount: 3500, paid_on: null, payments: [], paid: 0 }),
    ],
    milestones: MILESTONES,
    work_order: {
      id: "wo1",
      coordinator_id: "c1",
      client_name: "Anand Kumar",
      client_phone: "9876543210",
      address: "Kochi",
      plant_capacity: "3kW",
      plan_type: "solar",
      plant_capacity_kw: 3,
      advance_amount: 20000,
      advance_method: null,
      advance_paid_on: null,
      advance_reference: null,
      total_cost: 195000,
      order_date: "2026-08-01",
      status: "approved",
      consumer_number: null,
      notes: null,
      kseb_section: null,
      financing_type: "self",
      loan_bank_name: null,
      created_at: "2026-08-01T05:00:00Z",
      updated_at: "2026-08-01T05:00:00Z",
    },
    ...over,
  };
}

/** What Ravi loads: RLS hides his partner's incentive. */
const asSeenByRavi = (p: ProjectDetail): ProjectDetail => ({
  ...p,
  coordinators: [RAVI({ amount: 2000, paid_on: null, payments: [], paid: 0 }), ABHIJITH(null)],
});

const REFUNDED = {
  cancellation: "refunded",
  cancelled_on: "2026-10-01",
  cancelled_by: "admin-1",
  cancelled_by_name: "BSS Admin",
  cancellation_remarks: "Refunded ₹50,000 by bank transfer",
} as const;

function customPlan(over: Partial<ProjectDetail> = {}): ProjectDetail {
  const base = project({
    current_stage: "plant_commissioning",
    feasibility_date: null,
    milestones: [
      {
        id: "h",
        project_id: "p1",
        stage: "plant_commissioning",
        sort_order: 9,
        status: "in_progress",
        notes: null,
        completed_at: null,
      },
    ],
    ...over,
  });
  base.work_order = {
    ...base.work_order!,
    plan_type: "custom",
    plant_capacity: "Inverter + panel",
    plant_capacity_kw: null,
  };
  return base;
}

async function renderPage(profile: Profile, p: ProjectDetail | null) {
  vi.mocked(requireWorkOrderRole).mockResolvedValue(profile);
  projects.byId.mockResolvedValue(p);
  const ui = await ProjectDetailPage({
    params: Promise.resolve({ id: "p1" }),
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  payments.listForWorkOrder.mockResolvedValue([]);
  tickets.listByProject.mockResolvedValue([
    {
      id: "t1",
      ticket_no: "BSS-2610-1001",
      ticket_type: "routine_6m",
      status: "completed",
      scheduled_date: "2026-10-02",
      total: 1500,
    } as ServiceTicket,
  ]);
});

describe("the office's view of a live solar project", () => {
  beforeEach(async () => {
    await renderPage(ADMIN, project());
  });

  it("shows the whole sale: each coordinator's incentive block, the status card and the KSEB clock", () => {
    expect(screen.getByRole("group", { name: "Incentive for Ravi Kumar" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Incentive for Abhijith Nair" })).toBeInTheDocument();
    expect(screen.getByText("Project status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark cancelled" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark refunded" })).toBeInTheDocument();
    expect(screen.getByText("Feasibility validity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save settings/i })).toBeInTheDocument();
    expect(screen.getByText("KSEB / ANERT Milestones")).toBeInTheDocument();
  });

  it("totals the sale's incentives and lets the office change who shares it", () => {
    const row = screen.getByText("Incentives", { selector: "dt" }).nextElementSibling;
    expect(row).toHaveTextContent("Pending");
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute(
      "href",
      "/work-orders/wo1#coordinators",
    );
    expect(screen.queryByText("Your incentive")).not.toBeInTheDocument();
  });

  it("can advance the project, edit its details and raise service tickets", () => {
    expect(screen.getByRole("button", { name: /complete next milestone/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit details/i })).toHaveAttribute(
      "href",
      "/work-orders/wo1/edit",
    );
    expect(screen.getByText("Service Tickets")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new ticket/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete project" })).not.toBeInTheDocument();
  });

  it("edits milestones in place and passes the project's state to the payments section", () => {
    expect(
      screen.getByLabelText("Status for KSEB Portal Registration / PM Surya Ghar"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("payments")).toHaveAttribute("data-cancellation", "");
  });
});

describe("the office's view of incentive instalments", () => {
  beforeEach(async () => {
    await renderPage(
      ADMIN,
      project({
        coordinators: [RAVI(RAVI_PAID_IN_PART), ABHIJITH(ABHIJITH_PAID_IN_PART)],
      }),
    );
  });

  it("lists every coordinator's instalments in their own block, and can record, edit and remove them", () => {
    const ravi = within(screen.getByRole("group", { name: "Incentive for Ravi Kumar" }));
    expect(ravi.getByRole("list", { name: "Payments to Ravi Kumar" })).toHaveTextContent(
      "Cheque 004211",
    );
    expect(ravi.getByRole("button", { name: "Record payment for Ravi Kumar" })).toBeEnabled();
    expect(ravi.getAllByRole("button", { name: /^edit the/i })).toHaveLength(2);
    expect(ravi.getAllByRole("button", { name: /^remove the/i })).toHaveLength(2);

    const abhijith = within(screen.getByRole("group", { name: "Incentive for Abhijith Nair" }));
    expect(abhijith.getByRole("list", { name: "Payments to Abhijith Nair" })).toHaveTextContent(
      "Abhijith only",
    );
  });

  it("totals the sale as agreed, paid and where it stands", () => {
    const row = screen.getByText("Incentives", { selector: "dt" }).nextElementSibling;
    expect(row).toHaveTextContent(formatCurrency(9500));
    expect(row).toHaveTextContent(`${formatCurrency(5000)} paid`);
    expect(row).toHaveTextContent("Partly paid");
  });

  it("has no read-only 'your incentive' section — that is for the coordinator", () => {
    expect(screen.queryByText("Your incentive payments")).not.toBeInTheDocument();
  });
});

describe("the office's view of a refunded project", () => {
  beforeEach(async () => {
    await renderPage(ADMIN, project({ ...REFUNDED }));
  });

  it("says so in the header and the status card, with who recorded it", () => {
    expect(screen.getAllByText("Refunded").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Recorded by")).toBeInTheDocument();
    expect(screen.getByText("BSS Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reinstate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark refunded" })).not.toBeInTheDocument();
  });

  it("freezes the milestones, and says how to unlock them", () => {
    expect(screen.getByText("Reinstate the project to change its milestones.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete next milestone/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Status for/)).not.toBeInTheDocument();
  });

  it("still lets the office change or clear an incentive that will not be paid", () => {
    expect(screen.getByRole("group", { name: "Incentive for Ravi Kumar" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Agreed incentive for Ravi Kumar" })).toBeInTheDocument();
  });

  it("owes nothing, and the payments section knows", () => {
    expect(screen.getByTestId("payments")).toHaveAttribute("data-cancellation", "refunded");
    const payment = screen.getByText("Payment", { selector: "dt" }).nextElementSibling;
    expect(payment).toHaveTextContent("Nothing due — refunded");
  });

  it("shows where the feasibility clock stopped, not a running one", () => {
    expect(screen.getByText(/Stopped — project refunded/)).toBeInTheDocument();
  });
});

describe("a sale whose ledger holds a refund and a write-off", () => {
  // ₹1,95,000 sale: ₹20,000 advance + ₹1,80,000 contract − ₹10,000 refunded
  // = ₹1,90,000 held, and the ₹5,000 left is written off.
  const LEDGER = [
    { id: "a", amount: 180000, purpose: "contract", paid_on: "2026-09-01", paid_by_office: false },
    { id: "b", amount: 10000, purpose: "refund", paid_on: "2026-09-20", paid_by_office: false },
    {
      id: "c",
      amount: 5000,
      purpose: "write_off",
      paid_on: "2026-09-21",
      paid_by_office: false,
      notes: "Customer short at handover",
    },
  ] as unknown as Payment[];

  beforeEach(async () => {
    payments.listForWorkOrder.mockResolvedValue(LEDGER);
    await renderPage(ADMIN, project({ is_completed: true }));
  });

  it("reads Received net of the refund, like the ledger and the lists", () => {
    const received = screen.getByText("Received", { selector: "dt" }).nextElementSibling;
    expect(received).toHaveTextContent(formatCurrency(190000));
    expect(received).not.toHaveTextContent(formatCurrency(200000));
  });

  it("calls a written-off balance settled, not 'Payment pending'", () => {
    const payment = screen.getByText("Payment", { selector: "dt" }).nextElementSibling;
    expect(payment).toHaveTextContent("Settled — written off");
    expect(payment).not.toHaveTextContent(/Payment pending|Paid in full/);
  });

  it("tells the cancel dialog what is held now and that nothing is still outstanding", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Mark cancelled" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(`${formatCurrency(190000)} collected stays in the ledger`);
    expect(dialog).not.toHaveTextContent(/balance is no longer counted as outstanding/);
  });
});

describe("a coordinator's view of a shared project", () => {
  beforeEach(async () => {
    await renderPage(RAVI_PROFILE, asSeenByRavi(project()));
  });

  it("sees their own incentive and nobody else's", () => {
    const row = screen.getByText("Your incentive", { selector: "dt" }).nextElementSibling;
    expect(row).toHaveTextContent("2,000");
    // Abhijith's ₹3,500 never reaches the page.
    expect(screen.queryByText(/3,500/)).not.toBeInTheDocument();
    expect(screen.queryByText("Incentives", { selector: "dt" })).not.toBeInTheDocument();
    expect(screen.queryByText("Coordinator incentives")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("sees the team and can edit the work order, but changes nothing on the project", () => {
    expect(screen.getByText("Abhijith Nair")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit details/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Change" })).not.toBeInTheDocument();
    expect(screen.queryByText("Project status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark (cancelled|refunded)/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete next milestone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save settings/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Status for/)).not.toBeInTheDocument();
  });

  it("reads the service history, with no way into /tickets", () => {
    expect(screen.getByText("Service History")).toBeInTheDocument();
    expect(screen.getByText("BSS-2610-1001")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /bss-2610-1001/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /new ticket/i })).not.toBeInTheDocument();
    expect(tickets.listByProject).toHaveBeenCalledWith("p1");
  });
});

describe("a coordinator's view of their incentive payments", () => {
  /** What Ravi loads: his own instalments; RLS hides Abhijith's row and its payments. */
  const asRavi = () =>
    project({
      coordinators: [RAVI(RAVI_PAID_IN_PART), ABHIJITH(null)],
    });

  beforeEach(async () => {
    await renderPage(RAVI_PROFILE, asRavi());
  });

  it("reads what was agreed, what was paid, each payment and what is to come — only his own", () => {
    const section = screen.getByText("Your incentive payments").closest('[data-slot="card"]')!;
    const own = within(section as HTMLElement);
    expect(own.getByText("Agreed").nextElementSibling).toHaveTextContent(formatCurrency(6000));
    expect(own.getByText("Paid").nextElementSibling).toHaveTextContent(formatCurrency(4000));
    expect(own.getByText("Still to pay").nextElementSibling).toHaveTextContent(
      formatCurrency(2000),
    );
    expect(own.getByRole("list", { name: "Payments to you" })).toHaveTextContent("Cheque 004211");
    expect(own.getByText("Partly paid")).toBeInTheDocument();
  });

  it("never sees a partner's amount, payments or notes — nor any control to record one", () => {
    expect(screen.queryByText(/3,500/)).not.toBeInTheDocument();
    expect(screen.queryByText("Abhijith only")).not.toBeInTheDocument();
    expect(screen.queryByText(/Payments to Abhijith/)).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Incentive for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(edit|remove) the/i })).not.toBeInTheDocument();
  });

  it("the summary card's row reads the same figures", () => {
    const row = screen.getByText("Your incentive", { selector: "dt" }).nextElementSibling;
    expect(row).toHaveTextContent(formatCurrency(6000));
    expect(row).toHaveTextContent(`${formatCurrency(4000)} paid`);
  });
});

describe("a coordinator whose incentive is not set yet", () => {
  it("is told so, not shown zeros", async () => {
    await renderPage(
      RAVI_PROFILE,
      project({
        coordinators: [RAVI({ amount: null, paid_on: null, payments: [], paid: 0 }), ABHIJITH(null)],
      }),
    );
    expect(
      screen.getByText("The office has not set your incentive on this sale yet."),
    ).toBeInTheDocument();
  });
});

describe("a coordinator's view of a refunded project", () => {
  beforeEach(async () => {
    await renderPage(RAVI_PROFILE, asSeenByRavi(project({ ...REFUNDED })));
  });

  it("is a read-only banner with the office's remarks", () => {
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("This project was refunded on 01 Oct 2026.");
    expect(within(banner).getByText("Refunded ₹50,000 by bank transfer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reinstate" })).not.toBeInTheDocument();
    // Who recorded it is the office's business.
    expect(screen.queryByText("Recorded by")).not.toBeInTheDocument();
  });

  it("has frozen milestones", () => {
    expect(screen.queryByLabelText(/^Status for/)).not.toBeInTheDocument();
  });
});

describe("a custom plan's project", () => {
  it("has one Handover step, no KSEB, and is handed over rather than advanced", async () => {
    await renderPage(ADMIN, customPlan());

    expect(screen.getAllByText("Handover").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Status for Handover")).toBeInTheDocument();
    expect(screen.queryByText("KSEB / ANERT Milestones")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark handed over/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete next milestone/i })).not.toBeInTheDocument();

    expect(
      screen.getByText("Custom plan — no KSEB registration or feasibility."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Feasibility validity")).not.toBeInTheDocument();
    expect(screen.queryByText(/feasibility not set/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save settings/i })).not.toBeInTheDocument();
    expect(screen.getByText("Custom plan")).toBeInTheDocument();
  });

  it("keeps incentives, payments and tickets like any sale", async () => {
    await renderPage(ADMIN, customPlan());
    expect(screen.getByRole("group", { name: "Incentive for Ravi Kumar" })).toBeInTheDocument();
    expect(screen.getByTestId("payments")).toBeInTheDocument();
    expect(screen.getByText("Service Tickets")).toBeInTheDocument();
  });
});

describe("the SuperAdmin", () => {
  it("may delete the project, and is told what happens to the incentives", async () => {
    const user = userEvent.setup();
    await renderPage(SUPERADMIN, project());

    await user.click(screen.getByRole("button", { name: "Delete project" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Coordinator incentives stay with the sale and reappear if it is approved again.",
    );
  });

  it("is the only role that can; an admin is not offered it", async () => {
    await renderPage(ADMIN, project());
    expect(screen.queryByRole("button", { name: "Delete project" })).not.toBeInTheDocument();
  });
});

describe("access", () => {
  it("a project RLS hides is a 404", async () => {
    vi.mocked(requireWorkOrderRole).mockResolvedValue(RAVI_PROFILE);
    projects.byId.mockResolvedValue(null);
    await expect(
      ProjectDetailPage({
        params: Promise.resolve({ id: "p1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("someone who is not on the sale gets no service history and no edit link", async () => {
    // Should not happen (RLS hides the project), but the page does not rely on it.
    await renderPage(
      { ...RAVI_PROFILE, id: "stranger" } as Profile,
      asSeenByRavi(project()),
    );
    expect(tickets.listByProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /edit details/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Service History")).not.toBeInTheDocument();
    expect(screen.queryByText("Your incentive")).not.toBeInTheDocument();
  });
});
