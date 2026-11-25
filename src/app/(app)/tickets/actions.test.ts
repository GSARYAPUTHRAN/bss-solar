import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineerTicketRow, Profile, TicketStatus } from "@/lib/types";
import type { TicketSummary } from "@/server/data/tickets.repository";

// redirect() throws in Next; emulate that so the target can be asserted.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(),
  requireTicketRole: vi.fn(),
}));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/data", () => ({
  profilesRepository: { byId: vi.fn() },
  ticketsRepository: {
    summary: vi.fn(),
    engineerTicket: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { requireAdmin, requireTicketRole } from "@/lib/auth";
import { notify } from "@/server/notifications";
import { profilesRepository, ticketsRepository } from "@/server/data";
import { deleteTicket, setTicketStatus, updateTicket } from "./actions";

const tickets = vi.mocked(ticketsRepository);

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Office" } as Profile;
const ENGINEER = {
  id: "eng-1",
  role: "service_engineer",
  full_name: "Suresh",
} as Profile;

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: "t1",
    ticket_no: "BSS-2610-1001",
    status: "scheduled",
    scheduled_date: "2026-10-12",
    client_name: "Anand Kumar",
    assigned_to: "eng-1",
    assignee_name: "Suresh",
    ...overrides,
  };
}

/** The service sheet as the office submits it, unchanged unless overridden. */
function sheet(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values = {
    id: "t1",
    status: "scheduled",
    assigned_to: "eng-1",
    scheduled_date: "2026-10-12",
    ...fields,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

/** Every event the action announced, across notify() calls. */
function announced() {
  return vi.mocked(notify).mock.calls.flat();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  vi.mocked(profilesRepository.byId).mockResolvedValue({
    id: "eng-2",
    role: "service_engineer",
  } as Profile);
  tickets.summary.mockResolvedValue(summary());
  tickets.update.mockResolvedValue({ error: null });
  tickets.setStatus.mockResolvedValue({ error: null });
});

describe("updateTicket — telling the engineer who holds it", () => {
  async function save(fields: Record<string, string>) {
    await expect(updateTicket(sheet(fields))).rejects.toThrow(/^REDIRECT:\/tickets\/t1\?flash=/);
  }

  it("tells the engineer when the office moves the visit", async () => {
    await save({ scheduled_date: "2026-10-15" });
    expect(announced()).toEqual([
      {
        type: "ticket.updated",
        actorId: "admin-1",
        engineerId: "eng-1",
        ticketId: "t1",
        ticketNo: "BSS-2610-1001",
        clientName: "Anand Kumar",
        reason: "rescheduled",
        status: "scheduled",
        scheduledDate: "2026-10-15",
        stillAssigned: true,
      },
    ]);
  });

  it("tells the engineer when the office cancels and unassigns the ticket", async () => {
    await save({ status: "cancelled", assigned_to: "" });
    expect(announced()).toEqual([
      expect.objectContaining({
        type: "ticket.updated",
        engineerId: "eng-1",
        reason: "cancelled",
        stillAssigned: false,
      }),
    ]);
  });

  it("tells the engineer when the office reopens their completed ticket", async () => {
    tickets.summary.mockResolvedValue(summary({ status: "completed" }));
    await save({ status: "open" });
    expect(announced()).toEqual([
      expect.objectContaining({ engineerId: "eng-1", reason: "reopened", status: "open" }),
    ]);
  });

  it("still announces a change of hands as unassigned + assigned", async () => {
    await save({ assigned_to: "eng-2" });
    expect(announced().map((e) => [e.type, "engineerId" in e && e.engineerId])).toEqual([
      ["ticket.unassigned", "eng-1"],
      ["ticket.assigned", "eng-2"],
    ]);
  });

  it("says nothing when only the service sheet's details changed", async () => {
    await save({ defects_found: "Loose MC4 connector" });
    expect(tickets.update).toHaveBeenCalled();
    expect(announced()).toEqual([]);
  });
});

describe("setTicketStatus", () => {
  it("an office status change tells the engineer holding the ticket", async () => {
    vi.mocked(requireTicketRole).mockResolvedValue(ADMIN);
    expect(await setTicketStatus("t1", "cancelled")).toEqual({ ok: true, data: undefined });
    expect(announced()).toEqual([
      {
        type: "ticket.updated",
        actorId: "admin-1",
        engineerId: "eng-1",
        ticketId: "t1",
        ticketNo: "BSS-2610-1001",
        clientName: "Anand Kumar",
        reason: "cancelled",
        status: "cancelled",
        scheduledDate: "2026-10-12",
        stillAssigned: true,
      },
    ]);
  });

  it.each<[TicketStatus, TicketStatus, string]>([
    ["completed", "scheduled", "reopened"],
    ["scheduled", "in_progress", "status_changed"],
  ])("an office move %s → %s is announced as %s", async (from, to, reason) => {
    vi.mocked(requireTicketRole).mockResolvedValue(ADMIN);
    tickets.summary.mockResolvedValue(summary({ status: from }));
    await setTicketStatus("t1", to);
    expect(announced()).toEqual([expect.objectContaining({ engineerId: "eng-1", reason })]);
  });

  it("an office change to an unassigned ticket tells nobody", async () => {
    vi.mocked(requireTicketRole).mockResolvedValue(ADMIN);
    tickets.summary.mockResolvedValue(summary({ status: "open", assigned_to: null }));
    await setTicketStatus("t1", "cancelled");
    expect(announced()).toEqual([]);
  });

  it("an engineer's field move still tells the office, not the engineer", async () => {
    vi.mocked(requireTicketRole).mockResolvedValue(ENGINEER);
    tickets.engineerTicket.mockResolvedValue({
      id: "t1",
      ticket_no: "BSS-2610-1001",
      status: "scheduled",
      scheduled_date: "2026-10-12",
      client_name: "Anand Kumar",
    } as EngineerTicketRow);
    await setTicketStatus("t1", "in_progress");
    expect(announced()).toEqual([
      expect.objectContaining({ type: "ticket.status_changed", actorId: "eng-1" }),
    ]);
  });
});

describe("deleteTicket", () => {
  const revalidated = () => vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
  const remove = vi.mocked(ticketsRepository.remove);

  function body(id = "t1"): FormData {
    const fd = new FormData();
    fd.set("id", id);
    return fd;
  }

  beforeEach(() => {
    remove.mockResolvedValue({ projectId: "p1", error: null });
  });

  it("is office-only: a refused guard deletes nothing", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/tickets"));
    await expect(deleteTicket(body())).rejects.toThrow("REDIRECT:/tickets");
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin", ADMIN],
    ["the Super Admin", { ...ADMIN, role: "superadmin" } as Profile],
  ])("lets %s delete a ticket", async (_who, profile) => {
    vi.mocked(requireAdmin).mockResolvedValue(profile);
    await expect(deleteTicket(body())).rejects.toThrow("REDIRECT:/tickets?flash=Ticket%20deleted.");
    expect(remove).toHaveBeenCalledWith("t1");
  });

  it("refreshes the tickets, the ticket's project and the dashboard", async () => {
    await expect(deleteTicket(body())).rejects.toThrow(/flash=/);
    expect(revalidated()).toEqual(expect.arrayContaining(["/tickets", "/projects/p1", "/"]));
  });

  it("refreshes no project for a ticket that had none", async () => {
    remove.mockResolvedValue({ projectId: null, error: null });
    await expect(deleteTicket(body())).rejects.toThrow(/flash=/);
    expect(revalidated().filter((path) => path.startsWith("/projects"))).toEqual([]);
    expect(revalidated()).toEqual(expect.arrayContaining(["/tickets", "/"]));
  });

  it("says so when the ticket was already deleted, on the list (it has no page)", async () => {
    remove.mockResolvedValue({ projectId: null, error: "That ticket was already deleted." });
    await expect(deleteTicket(body())).rejects.toThrow(
      "REDIRECT:/tickets?flash=That%20ticket%20was%20already%20deleted.&flashType=error",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("shows any other refusal on the ticket's page", async () => {
    remove.mockResolvedValue({ projectId: null, error: "permission denied" });
    await expect(deleteTicket(body())).rejects.toThrow(
      "REDIRECT:/tickets/t1?error=permission%20denied",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
