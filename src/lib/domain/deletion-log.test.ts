import { describe, expect, it } from "vitest";
import { formatCurrencyWhole, formatDate } from "@/lib/format";
import {
  DELETED_TABLES,
  describeDeletion,
  groupDeletions,
  type DeletedRecord,
} from "./deletion-log";

const WO = "4f1c2a7e-0000-4000-8000-000000000001";
const RAHUL = "11111111-1111-4111-8111-111111111111";

let nextId = 0;

function row(
  tableName: string,
  snapshot: Record<string, unknown>,
  over: Partial<DeletedRecord> = {},
): DeletedRecord {
  nextId += 1;
  return {
    id: nextId,
    tableName,
    recordId: String(snapshot.id ?? `rec-${nextId}`),
    snapshot,
    deletedByName: "BSS Admin",
    deletedAt: "2026-11-25T06:30:00.000Z",
    tx: 500,
    ...over,
  };
}

const sale = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row(
    "work_orders",
    {
      id: WO,
      client_name: "Anil Kumar",
      order_date: "2025-02-12",
      total_cost: 235000,
      coordinator_id: RAHUL,
      ...over,
    },
    meta,
  );
const project = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row("projects", { id: "proj-1", work_order_id: WO, ...over }, meta);
const payment = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row(
    "payments",
    { id: "pay-1", work_order_id: WO, amount: 50000, purpose: "contract", paid_on: "2025-03-03", ...over },
    meta,
  );
const incentive = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row(
    "coordinator_incentives",
    { work_order_id: WO, coordinator_id: RAHUL, amount: 15000, ...over },
    { recordId: `${WO}:${RAHUL}`, ...meta },
  );
const instalment = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row(
    "coordinator_incentive_payments",
    { id: "ip-1", work_order_id: WO, coordinator_id: RAHUL, amount: 4000, paid_on: "2025-03-02", ...over },
    meta,
  );
const ticket = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row("service_tickets", { id: "t-1", ticket_no: "BSS-2606-1001", project_id: null, ...over }, meta);
const member = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row("profiles", { id: RAHUL, full_name: "Rahul Menon", role: "coordinator", ...over }, meta);
/** Who shared the sale (`work_order_coordinators`): no id of its own. */
const sharer = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row(
    "work_order_coordinators",
    { work_order_id: WO, coordinator_id: RAHUL, sort_order: 1, added_by: null, ...over },
    { recordId: `${WO}:${RAHUL}`, ...meta },
  );
const milestone = (over: Record<string, unknown> = {}, meta: Partial<DeletedRecord> = {}) =>
  row(
    "project_milestones",
    {
      id: "ms-1",
      project_id: "proj-1",
      stage: "site_feasibility_survey",
      status: "completed",
      notes: "Roof checked",
      completed_at: "2025-03-01T05:00:00+00:00",
      sort_order: 1,
      ...over,
    },
    meta,
  );

describe("describeDeletion", () => {
  it("describes a sale by client, order date and total", () => {
    expect(describeDeletion(sale())).toBe(
      `Sale — Anil Kumar, ${formatDate("2025-02-12")}, ${formatCurrencyWhole(235000)}`,
    );
    expect(describeDeletion(sale())).toBe("Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000");
  });

  it("reads numeric columns that arrive as strings", () => {
    expect(describeDeletion(sale({ total_cost: "235000.00" }))).toBe(
      "Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000",
    );
  });

  it("leaves out what a sale's snapshot lacks", () => {
    expect(describeDeletion(sale({ order_date: null, total_cost: null }))).toBe("Sale — Anil Kumar");
    expect(describeDeletion(sale({ client_name: "  " }))).toBe("Sale — 12 Feb 2025, ₹2,35,000");
    expect(describeDeletion(row("work_orders", {}))).toBe("Sale");
  });

  it("names a project after its sale deleted in the same transaction", () => {
    const p = project();
    expect(describeDeletion(p, { group: [sale(), p] })).toBe("Project — Anil Kumar");
  });

  it("falls back to the sale's short id when that sale was not deleted with it", () => {
    expect(describeDeletion(project())).toBe("Project — sale 4f1c2a7e");
    const other = sale({ id: "99999999-0000-4000-8000-000000000000", client_name: "Someone" });
    expect(describeDeletion(project(), { group: [other] })).toBe("Project — sale 4f1c2a7e");
  });

  it.each([
    ["contract", "Payment — ₹50,000 contract, 03 Mar 2025"],
    ["kseb_fees", "Payment — ₹50,000 KSEB fee, 03 Mar 2025"],
    ["refund", "Payment — ₹50,000 refund, 03 Mar 2025"],
    ["write_off", "Payment — ₹50,000 write-off, 03 Mar 2025"],
  ])("describes a %s ledger entry", (purpose, label) => {
    expect(describeDeletion(payment({ purpose }))).toBe(label);
  });

  it("describes a payment with an unknown purpose by its amount", () => {
    expect(describeDeletion(payment({ purpose: "mystery" }))).toBe("Payment — ₹50,000, 03 Mar 2025");
    expect(describeDeletion(payment({ amount: null, purpose: null, paid_on: null }))).toBe("Payment");
  });

  it("describes a ticket by its number, else its short id", () => {
    expect(describeDeletion(ticket())).toBe("Ticket BSS-2606-1001");
    expect(describeDeletion(ticket({ id: "abcdef12-3456", ticket_no: null }))).toBe("Ticket abcdef12");
  });

  it.each([
    ["coordinator", "Team member — Rahul Menon (Coordinator)"],
    ["service_engineer", "Team member — Rahul Menon (Service Engineer)"],
    ["admin", "Team member — Rahul Menon (Admin)"],
  ])("describes a %s", (role, label) => {
    expect(describeDeletion(member({ role }))).toBe(label);
  });

  it("does not print a role it does not know", () => {
    expect(describeDeletion(member({ role: "owner" }))).toBe("Team member — Rahul Menon");
    expect(describeDeletion(member({ full_name: null, role: null }))).toBe("Team member — Unknown");
  });

  it("describes an incentive, naming the coordinator when known", () => {
    expect(describeDeletion(incentive())).toBe("Incentive — ₹15,000");
    expect(describeDeletion(incentive(), { names: new Map([[RAHUL, "Rahul"]]) })).toBe(
      "Incentive — ₹15,000 (Rahul)",
    );
    expect(describeDeletion(incentive(), { names: new Map([["someone-else", "Priya"]]) })).toBe(
      "Incentive — ₹15,000",
    );
    expect(describeDeletion(incentive({ amount: null }))).toBe("Incentive");
  });

  it("describes an incentive instalment by amount and date", () => {
    expect(describeDeletion(instalment())).toBe("Incentive payment — ₹4,000, 02 Mar 2025");
  });

  it("names a project after its sale whatever else its snapshot carries (its tickets)", () => {
    const p = project({ service_ticket_ids: ["t-1", "t-2"] });
    expect(describeDeletion(p, { group: [sale(), p] })).toBe("Project — Anil Kumar");
    expect(describeDeletion(project({ service_ticket_ids: null }))).toBe("Project — sale 4f1c2a7e");
    expect(describeDeletion(project({ service_ticket_ids: "odd" }))).toBe("Project — sale 4f1c2a7e");
  });

  it("describes a sale's coordinator, naming them when known", () => {
    expect(describeDeletion(sharer())).toBe("Coordinator");
    expect(describeDeletion(sharer(), { names: new Map([[RAHUL, "Rahul Menon"]]) })).toBe(
      "Coordinator — Rahul Menon",
    );
  });

  it("describes a milestone by its stage", () => {
    expect(describeDeletion(milestone())).toBe("Milestone — Site Feasibility Survey");
    expect(describeDeletion(milestone({ stage: "new_stage" }))).toBe("Milestone — new_stage");
    expect(describeDeletion(milestone({ stage: null }))).toBe("Milestone");
  });

  it("shows a table it does not know by name and id", () => {
    expect(describeDeletion(row("mystery", { id: "x-1" }))).toBe("mystery x-1");
  });

  it("survives a missing snapshot", () => {
    const broken = { ...sale(), snapshot: null as unknown as Record<string, unknown> };
    expect(describeDeletion(broken)).toBe("Sale");
  });
});

describe("groupDeletions", () => {
  it("is empty for an empty log", () => {
    expect(groupDeletions([])).toEqual([]);
  });

  it("heads a sale's delete with the sale and counts what went with it", () => {
    const rows = [
      // As the repository returns them: newest first.
      instalment({}, { id: 9 }),
      incentive({}, { id: 8 }),
      payment({ id: "pay-2" }, { id: 7 }),
      payment({}, { id: 6 }),
      payment({ id: "pay-3", purpose: "refund" }, { id: 5 }),
      project({}, { id: 4 }),
      sale({}, { id: 3 }),
    ];
    expect(groupDeletions(rows)).toEqual([
      {
        tx: 500,
        deletedAt: "2026-11-25T06:30:00.000Z",
        deletedByName: "BSS Admin",
        kind: "work_orders",
        headline: ["Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000"],
        alsoRemoved: [
          { kind: "projects", count: 1, label: "1 project" },
          { kind: "payments", count: 3, label: "3 ledger entries" },
          { kind: "coordinator_incentives", count: 1, label: "1 incentive" },
          { kind: "coordinator_incentive_payments", count: 1, label: "1 incentive payment" },
        ],
      },
    ]);
  });

  it("counts a sale's milestones and coordinators only under also removed, after the rest", () => {
    const second = "22222222-2222-4222-8222-222222222222";
    const rows = [
      milestone({ id: "ms-2", stage: "kseb_feasibility_clearance" }, { id: 10 }),
      milestone({}, { id: 9 }),
      sharer({ coordinator_id: second, sort_order: 2 }, { id: 8 }),
      sharer({}, { id: 7 }),
      incentive({}, { id: 6 }),
      payment({}, { id: 5 }),
      project({ service_ticket_ids: ["t-1"] }, { id: 4 }),
      sale({}, { id: 3 }),
    ];
    const [group] = groupDeletions(rows);
    expect(group.kind).toBe("work_orders");
    expect(group.headline).toEqual(["Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000"]);
    expect(group.alsoRemoved.map((a) => a.label)).toEqual([
      "1 project",
      "1 ledger entry",
      "1 incentive",
      "2 coordinators",
      "2 milestones",
    ]);
  });

  it("heads a project's delete with the project, its milestones counted", () => {
    const [group] = groupDeletions([milestone({}, { id: 2 }), project({}, { id: 1 })]);
    expect(group.kind).toBe("projects");
    expect(group.alsoRemoved).toEqual([
      { kind: "project_milestones", count: 1, label: "1 milestone" },
    ]);
  });

  it("keeps separate deletes apart and lists the newest first", () => {
    const rows = [
      ticket({}, { tx: 3, deletedAt: "2026-11-25T08:00:00Z" }),
      payment({}, { tx: 2, deletedAt: "2026-11-25T07:00:00Z", deletedByName: "Boss" }),
      sale({}, { tx: 1, deletedAt: "2026-11-24T07:00:00Z" }),
      project({}, { tx: 1, deletedAt: "2026-11-24T07:00:00Z" }),
    ];
    const groups = groupDeletions(rows);
    expect(groups.map((g) => g.tx)).toEqual([3, 2, 1]);
    expect(groups.map((g) => g.headline)).toEqual([
      ["Ticket BSS-2606-1001"],
      ["Payment — ₹50,000 contract, 03 Mar 2025"],
      ["Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000"],
    ]);
    expect(groups[1].deletedByName).toBe("Boss");
    expect(groups[2].alsoRemoved).toEqual([{ kind: "projects", count: 1, label: "1 project" }]);
  });

  it("orders deletes at the same instant by the later log row first", () => {
    const rows = [
      ticket({}, { id: 1, tx: 10 }),
      payment({}, { id: 2, tx: 11 }),
    ];
    expect(groupDeletions(rows).map((g) => g.tx)).toEqual([11, 10]);
  });

  it("orders by the instant, whatever order the rows come in", () => {
    const rows = [
      ticket({}, { id: 5, tx: 10, deletedAt: "2026-11-01T00:00:00Z" }),
      payment({}, { id: 1, tx: 11, deletedAt: "2026-11-20T00:00:00Z" }),
    ];
    expect(groupDeletions(rows).map((g) => g.tx)).toEqual([11, 10]);
  });

  it("heads a bulk delete with every sale in it, in the order deleted", () => {
    const second = "4f1c2a7e-0000-4000-8000-000000000002";
    const rows = [
      project({ id: "proj-2", work_order_id: second }, { id: 4 }),
      sale({ id: second, client_name: "Anil K" }, { id: 3 }),
      project({}, { id: 2 }),
      sale({}, { id: 1 }),
    ];
    const [group] = groupDeletions(rows);
    expect(group.headline).toEqual([
      "Sale — Anil Kumar, 12 Feb 2025, ₹2,35,000",
      "Sale — Anil K, 12 Feb 2025, ₹2,35,000",
    ]);
    expect(group.alsoRemoved).toEqual([{ kind: "projects", count: 2, label: "2 projects" }]);
  });

  it("heads a project's own delete with the project, named by its sale's id", () => {
    const [group] = groupDeletions([project()]);
    expect(group.kind).toBe("projects");
    expect(group.headline).toEqual(["Project — sale 4f1c2a7e"]);
    expect(group.alsoRemoved).toEqual([]);
  });

  it("heads an incentive's delete with its instalments", () => {
    const rows = [
      instalment({ id: "ip-2", amount: 2000, paid_on: "2025-03-05" }),
      instalment(),
    ];
    const [group] = groupDeletions(rows);
    expect(group.kind).toBe("coordinator_incentive_payments");
    expect(group.headline).toEqual([
      "Incentive payment — ₹2,000, 05 Mar 2025",
      "Incentive payment — ₹4,000, 02 Mar 2025",
    ]);
  });

  it("names the coordinator of a deleted incentive from the names given", () => {
    const [group] = groupDeletions([incentive()], new Map([[RAHUL, "Rahul Menon"]]));
    expect(group.headline).toEqual(["Incentive — ₹15,000 (Rahul Menon)"]);
  });

  it("ranks the kinds: sale, team member, project, ticket, ledger entry, incentive, instalment, coordinator, milestone", () => {
    expect(DELETED_TABLES).toEqual([
      "work_orders",
      "profiles",
      "projects",
      "service_tickets",
      "payments",
      "coordinator_incentives",
      "coordinator_incentive_payments",
      "work_order_coordinators",
      "project_milestones",
    ]);
    const all = [
      milestone(),
      sharer(),
      instalment(),
      incentive(),
      payment(),
      ticket(),
      project(),
      member(),
      sale(),
    ];
    // Drop the most important kind each time: the next one heads the group.
    for (let i = 0; i < DELETED_TABLES.length; i++) {
      const rows = all.filter((r) => DELETED_TABLES.indexOf(r.tableName as never) >= i);
      const [group] = groupDeletions(rows);
      expect(group.kind).toBe(DELETED_TABLES[i]);
      expect(group.alsoRemoved.map((a) => a.kind)).toEqual(DELETED_TABLES.slice(i + 1));
    }
  });

  it("puts a table it does not know after every known one", () => {
    const [group] = groupDeletions([row("mystery", { id: "m" }), payment()]);
    expect(group.kind).toBe("payments");
    expect(group.alsoRemoved).toEqual([{ kind: "mystery", count: 1, label: "1 mystery" }]);
    expect(groupDeletions([row("mystery", { id: "m" })])[0].headline).toEqual(["mystery m"]);
  });

  it("uses singular and plural nouns", () => {
    const [one] = groupDeletions([sale(), member({ id: "x" })]);
    expect(one.alsoRemoved[0].label).toBe("1 team member");
    const [many] = groupDeletions([
      sale(),
      ticket(),
      ticket({ id: "t-2" }),
      instalment(),
      instalment({ id: "ip-2" }),
      incentive(),
      incentive(),
    ]);
    expect(many.alsoRemoved.map((a) => a.label)).toEqual([
      "2 service tickets",
      "2 incentives",
      "2 incentive payments",
    ]);
  });

  it("takes who deleted it from any row that knows", () => {
    const rows = [
      project({}, { deletedByName: null }),
      sale({}, { deletedByName: "BSS SuperAdmin" }),
    ];
    expect(groupDeletions(rows)[0].deletedByName).toBe("BSS SuperAdmin");
    expect(groupDeletions([project({}, { deletedByName: null })])[0].deletedByName).toBeNull();
  });
});
