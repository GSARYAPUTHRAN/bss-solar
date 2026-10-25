import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserRole, WorkOrderStatus } from "@/lib/types";
import {
  COORDINATOR_ERRORS,
  type DirectoryAccount,
  MAX_SALE_COORDINATORS,
  coordinatorChangeEvents,
  coordinatorsLabel,
  describeCoordinatorChange,
  diffCoordinators,
  isSaleCoordinator,
  mayAddToSale,
  normalizeCoordinatorIds,
  planCoordinatorChange,
  planNewSaleTeam,
  teamAuthority,
} from "./coordinators";
import { audienceFor, describe as describeEvent, resolveRecipients } from "./notifications";

// Ids here are plain strings: the planners compare them, they do not parse them.
const RAHUL = "rahul";
const PRIYA = "priya";
const ARUN = "arun";
const SNEHA = "sneha";
const ADMIN = "admin";
const MANOHAR = "manohar";
const ROOT = "root";

const coordinator = (id: string) => ({ id, role: "coordinator" as UserRole });
const office = { id: ADMIN, role: "admin" as UserRole };

/** coordinator_directory(): everyone who can own or share a sale, with their role. */
const directoryOf = (ids: readonly string[], role: UserRole = "coordinator") =>
  ids.map((id) => ({ id, role }));
const DIRECTORY: DirectoryAccount[] = [
  ...directoryOf([RAHUL, PRIYA, ARUN, SNEHA, MANOHAR]),
  { id: ADMIN, role: "admin" },
  { id: ROOT, role: "superadmin" },
];

describe("MAX_SALE_COORDINATORS", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  // The same number is in SQL (max_sale_coordinators(), which set_work_order_coordinators
  // and import_projects enforce) and here (the friendly pre-check, the picker).
  it.each([
    "supabase/migrations/20261022120000_sale_coordinators.sql",
    "supabase/schema.sql",
  ])("equals the literal returned by max_sale_coordinators() in %s", (file) => {
    const sql = read(file);
    const fn = /function (?:public\.)?max_sale_coordinators\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*;/i.exec(
      sql,
    );
    expect(fn, "max_sale_coordinators() not found").not.toBeNull();
    expect(Number(fn![1])).toBe(MAX_SALE_COORDINATORS);
  });

  it("is the number the error message quotes", () => {
    expect(COORDINATOR_ERRORS.tooMany).toBe("A sale can have at most 5 coordinators.");
  });
});

describe("COORDINATOR_ERRORS", () => {
  // set_work_order_coordinators() raises the same sentences (without the final
  // full stop), so a refusal reads the same whether TypeScript or the database
  // makes it.
  it.each([
    "supabase/migrations/20261022120000_sale_coordinators.sql",
    "supabase/schema.sql",
  ])("are the messages set_work_order_coordinators() raises in %s", (file) => {
    const sql = readFileSync(join(process.cwd(), file), "utf8");
    /** The SQL string literal for a message: no final full stop, quoted. */
    const literal = (message: string, suffix = "") => `'${message.replace(/\.$/, "")}${suffix}'`;
    expect(sql).toContain(literal(COORDINATOR_ERRORS.addPartnersOnly));
    expect(sql).toContain(literal(COORDINATOR_ERRORS.officeAfterReview));
    expect(sql).toContain(literal(COORDINATOR_ERRORS.officeRemoves));
    expect(sql).toContain(literal(COORDINATOR_ERRORS.atLeastOne));
    // The database fills the limit in from max_sale_coordinators().
    expect(sql).toContain(literal(COORDINATOR_ERRORS.tooMany).replace(/\d+/, "%"));
    // …and names who is not eligible after the colon.
    expect(sql).toContain(literal(COORDINATOR_ERRORS.notEligible, ": %"));
    expect(sql).toContain(literal(COORDINATOR_ERRORS.officeAccount, ": %"));
  });

  it("uses the wording shared with the RPC", () => {
    expect(COORDINATOR_ERRORS).toEqual({
      addPartnersOnly:
        "Only the office or the coordinator who logged this work order can add partners.",
      officeAfterReview:
        "Only the office can change who shares an approved or rejected work order.",
      officeRemoves: "Only the office can take a coordinator off a work order.",
      atLeastOne: "A work order needs at least one coordinator.",
      tooMany: "A sale can have at most 5 coordinators.",
      notEligible: "Only coordinator or office accounts can share a sale.",
      officeAccount: "Only the office can add an office account to a sale.",
    });
  });
});

describe("normalizeCoordinatorIds", () => {
  const A = "00000000-0000-0000-0000-000000000002";
  const B = "00000000-0000-0000-0000-000000000003";
  const C = "10000000-0000-0000-0000-00000000000a";

  it("keeps UUIDs in the order given", () => {
    expect(normalizeCoordinatorIds([B, A, C])).toEqual([B, A, C]);
  });

  it("trims and lower-cases", () => {
    expect(normalizeCoordinatorIds([`  ${C.toUpperCase()} `])).toEqual([C]);
  });

  it("drops anything that is not a UUID, blanks and nulls included", () => {
    expect(
      normalizeCoordinatorIds([A, "", "  ", null, undefined, "rahul", "123", `${A}x`, "not-a-uuid"]),
    ).toEqual([A]);
  });

  it("removes duplicates keeping the first — case-insensitively", () => {
    expect(normalizeCoordinatorIds([B, A, B, A.toUpperCase()])).toEqual([B, A]);
  });

  it("is empty for nothing", () => {
    expect(normalizeCoordinatorIds([])).toEqual([]);
  });
});

describe("coordinatorsLabel", () => {
  it("reads as one phrase", () => {
    expect(coordinatorsLabel([])).toBe("—");
    expect(coordinatorsLabel(["Ravi"])).toBe("Ravi");
    expect(coordinatorsLabel(["Ravi", "Abhijith"])).toBe("Ravi & Abhijith");
    expect(coordinatorsLabel(["Ravi", "Abhijith", "Manohar"])).toBe("Ravi, Abhijith & Manohar");
    expect(coordinatorsLabel(["A", "B", "C", "D", "E"])).toBe("A, B, C, D & E");
  });

  it("ignores blank names", () => {
    expect(coordinatorsLabel(["", "  "])).toBe("—");
    expect(coordinatorsLabel(["Ravi", " ", "Abhijith"])).toBe("Ravi & Abhijith");
  });
});

describe("isSaleCoordinator", () => {
  it("reads a loaded sale's coordinators", () => {
    const sale = { coordinators: [{ id: RAHUL }, { id: PRIYA }] };
    expect(isSaleCoordinator(sale, RAHUL)).toBe(true);
    expect(isSaleCoordinator(sale, PRIYA)).toBe(true);
    expect(isSaleCoordinator(sale, ARUN)).toBe(false);
    expect(isSaleCoordinator({ coordinators: [] }, RAHUL)).toBe(false);
  });

  it("reads a list row's coordinator_ids", () => {
    const row = { coordinator_ids: [RAHUL, PRIYA] };
    expect(isSaleCoordinator(row, PRIYA)).toBe(true);
    expect(isSaleCoordinator(row, ARUN)).toBe(false);
    expect(isSaleCoordinator({ coordinator_ids: [] }, RAHUL)).toBe(false);
    expect(isSaleCoordinator({ coordinator_ids: null }, RAHUL)).toBe(false);
  });
});

describe("teamAuthority", () => {
  const sale = (status: WorkOrderStatus, ids = [RAHUL, PRIYA]) => ({
    status,
    coordinatorIds: ids,
  });

  it.each<WorkOrderStatus>(["pending", "approved", "rejected"])(
    "gives the office everything on a %s order",
    (status) => {
      expect(teamAuthority(office, sale(status))).toBe("office");
      expect(teamAuthority({ id: "root", role: "superadmin" }, sale(status))).toBe("office");
    },
  );

  it("lets the first coordinator add partners while the order is pending", () => {
    expect(teamAuthority(coordinator(RAHUL), sale("pending"))).toBe("add_partners");
    expect(teamAuthority(coordinator(RAHUL), sale("pending", [RAHUL]))).toBe("add_partners");
  });

  it("takes that away once the office has approved or rejected it", () => {
    expect(teamAuthority(coordinator(RAHUL), sale("approved"))).toBe("none");
    expect(teamAuthority(coordinator(RAHUL), sale("rejected"))).toBe("none");
  });

  it("gives a partner nothing, even on a pending order", () => {
    expect(teamAuthority(coordinator(PRIYA), sale("pending"))).toBe("none");
  });

  it("gives a stranger and an engineer nothing", () => {
    expect(teamAuthority(coordinator(ARUN), sale("pending"))).toBe("none");
    expect(teamAuthority({ id: RAHUL, role: "service_engineer" }, sale("pending"))).toBe("none");
  });

  it("gives nothing on a sale with no team", () => {
    expect(teamAuthority(coordinator(RAHUL), sale("pending", []))).toBe("none");
  });
});

describe("mayAddToSale", () => {
  // A partner is not asked and sharing opens their profile to the sale's team, so
  // only the office puts an office account on a sale (mirrors the RPC).
  it.each<[UserRole, UserRole, boolean]>([
    ["admin", "coordinator", true],
    ["admin", "admin", true],
    ["admin", "superadmin", true],
    ["superadmin", "coordinator", true],
    ["superadmin", "admin", true],
    ["superadmin", "superadmin", true],
    ["coordinator", "coordinator", true],
    ["coordinator", "admin", false],
    ["coordinator", "superadmin", false],
    ["service_engineer", "admin", false],
    ["service_engineer", "superadmin", false],
  ])("%s adding role %s: %s", (adder, account, expected) => {
    expect(mayAddToSale({ role: adder }, { role: account })).toBe(expected);
  });
});

describe("planNewSaleTeam", () => {
  const plan = (
    actor: { id: string; role: UserRole },
    requested: string[],
    directory: readonly DirectoryAccount[] = DIRECTORY,
  ) => planNewSaleTeam({ actor, requested, directory });

  describe("a coordinator", () => {
    it("is always first, followed by the partners in the order named", () => {
      expect(plan(coordinator(RAHUL), [PRIYA, ARUN])).toEqual({
        ok: true,
        data: [RAHUL, PRIYA, ARUN],
      });
    });

    it("works alone when no partner is named", () => {
      expect(plan(coordinator(RAHUL), [])).toEqual({ ok: true, data: [RAHUL] });
    });

    it("is not listed twice, wherever they appear in the request", () => {
      expect(plan(coordinator(RAHUL), [PRIYA, RAHUL, PRIYA])).toEqual({
        ok: true,
        data: [RAHUL, PRIYA],
      });
    });

    it("stays first however the partners are ordered", () => {
      expect(plan(coordinator(RAHUL), [ARUN, PRIYA])).toEqual({
        ok: true,
        data: [RAHUL, ARUN, PRIYA],
      });
    });

    it("is trusted as an owner even when the directory somehow omits them", () => {
      expect(plan(coordinator(RAHUL), [PRIYA], directoryOf([PRIYA]))).toEqual({
        ok: true,
        data: [RAHUL, PRIYA],
      });
    });

    it("may not name someone who cannot own a sale", () => {
      expect(plan(coordinator(RAHUL), ["engineer-1"])).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.notEligible,
      });
    });

    it.each([
      ["an admin", ADMIN],
      ["the SuperAdmin", ROOT],
    ])("may not name %s as a partner: only the office adds office accounts", (_who, id) => {
      expect(plan(coordinator(RAHUL), [PRIYA, id])).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.officeAccount,
      });
      expect(plan(coordinator(RAHUL), [id])).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.officeAccount,
      });
    });

    it("is told 'not eligible' first when someone else on the list cannot share a sale at all", () => {
      // The database checks who can share a sale before who may add them.
      expect(plan(coordinator(RAHUL), [ADMIN, "engineer-1"])).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.notEligible,
      });
    });

    it("may share with up to four partners, not five", () => {
      const four = [PRIYA, ARUN, SNEHA, MANOHAR];
      expect(plan(coordinator(RAHUL), four)).toEqual({ ok: true, data: [RAHUL, ...four] });
      expect(plan(coordinator(RAHUL), [...four, ADMIN])).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.tooMany,
      });
    });
  });

  describe("the office", () => {
    it("gets what it asked for, in order — the first is the one who logged it", () => {
      expect(plan(office, [PRIYA, RAHUL])).toEqual({ ok: true, data: [PRIYA, RAHUL] });
    });

    it("may leave itself off", () => {
      expect(plan(office, [PRIYA])).toEqual({ ok: true, data: [PRIYA] });
    });

    it("may put any office account on the sale, the SuperAdmin included", () => {
      expect(plan(office, [PRIYA, ROOT])).toEqual({ ok: true, data: [PRIYA, ROOT] });
      expect(plan({ id: ROOT, role: "superadmin" }, [RAHUL, ADMIN])).toEqual({
        ok: true,
        data: [RAHUL, ADMIN],
      });
    });

    it("is the sole coordinator when it names no one", () => {
      expect(plan(office, [])).toEqual({ ok: true, data: [ADMIN] });
    });

    it("drops repeats, keeping the first", () => {
      expect(plan(office, [ARUN, PRIYA, ARUN])).toEqual({ ok: true, data: [ARUN, PRIYA] });
    });

    it("refuses someone who cannot own a sale", () => {
      expect(plan(office, [PRIYA, "engineer-1"])).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.notEligible,
      });
    });

    it("allows exactly five and refuses six", () => {
      const directory = directoryOf(["a", "b", "c", "d", "e", "f"]);
      expect(plan(office, ["a", "b", "c", "d", "e"], directory).ok).toBe(true);
      expect(plan(office, ["a", "b", "c", "d", "e", "f"], directory)).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.tooMany,
      });
    });
  });

  it("never trusts an engineer as an owner", () => {
    expect(plan({ id: "eng", role: "service_engineer" }, [])).toEqual({
      ok: false,
      error: COORDINATOR_ERRORS.notEligible,
    });
  });

  it("ignores blanks in the request", () => {
    expect(plan(coordinator(RAHUL), ["", " ", PRIYA])).toEqual({
      ok: true,
      data: [RAHUL, PRIYA],
    });
  });
});

describe("planCoordinatorChange", () => {
  type Input = Parameters<typeof planCoordinatorChange>[0];
  const change = (overrides: Partial<Input> & Pick<Input, "viewer">) =>
    planCoordinatorChange({
      status: "pending",
      before: [RAHUL],
      requested: [RAHUL],
      directory: DIRECTORY,
      ...overrides,
    });

  describe("the office", () => {
    it("may add, remove and reorder, on an order in any state", () => {
      for (const status of ["pending", "approved", "rejected"] as const) {
        expect(
          change({ viewer: office, status, before: [RAHUL, PRIYA], requested: [ARUN, RAHUL] }),
        ).toEqual({
          ok: true,
          data: { after: [ARUN, RAHUL], added: [ARUN], removed: [PRIYA] },
        });
      }
    });

    it("may reorder alone — the first coordinator changes, nobody joins or leaves", () => {
      expect(
        change({ viewer: office, status: "approved", before: [RAHUL, PRIYA], requested: [PRIYA, RAHUL] }),
      ).toEqual({ ok: true, data: { after: [PRIYA, RAHUL], added: [], removed: [] } });
    });

    it("may take the logging coordinator off", () => {
      expect(
        change({ viewer: office, before: [RAHUL, PRIYA], requested: [PRIYA] }),
      ).toEqual({ ok: true, data: { after: [PRIYA], added: [], removed: [RAHUL] } });
    });

    it("may add an admin or the SuperAdmin", () => {
      expect(change({ viewer: office, requested: [RAHUL, ROOT] })).toEqual({
        ok: true,
        data: { after: [RAHUL, ROOT], added: [ROOT], removed: [] },
      });
    });

    it("is refused an empty list", () => {
      expect(change({ viewer: office, requested: [] })).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.atLeastOne,
      });
    });

    it("is refused more than five", () => {
      const result = change({
        viewer: office,
        before: ["a"],
        requested: ["a", "b", "c", "d", "e", "f"],
        directory: directoryOf(["a", "b", "c", "d", "e", "f"]),
      });
      expect(result).toEqual({ ok: false, error: COORDINATOR_ERRORS.tooMany });
    });

    it("is refused someone who cannot own a sale", () => {
      expect(
        change({ viewer: office, requested: [RAHUL, "engineer-1"] }),
      ).toEqual({ ok: false, error: COORDINATOR_ERRORS.notEligible });
    });

    it("does not re-check people already on the sale", () => {
      // Whoever the directory lists today, an existing member stays a member.
      expect(
        change({
          viewer: office,
          before: [RAHUL, "legacy"],
          requested: [RAHUL, "legacy", PRIYA],
          directory: directoryOf([RAHUL, PRIYA]),
        }),
      ).toEqual({
        ok: true,
        data: { after: [RAHUL, "legacy", PRIYA], added: [PRIYA], removed: [] },
      });
    });

    it("de-duplicates the request, keeping the first", () => {
      expect(change({ viewer: office, requested: [PRIYA, RAHUL, PRIYA] })).toEqual({
        ok: true,
        data: { after: [PRIYA, RAHUL], added: [PRIYA], removed: [] },
      });
    });
  });

  describe("the coordinator who logged a pending order", () => {
    const first = coordinator(RAHUL);

    it("appends partners and keeps the order they already had", () => {
      expect(
        change({ viewer: first, before: [RAHUL, PRIYA], requested: [RAHUL, PRIYA, ARUN] }),
      ).toEqual({ ok: true, data: { after: [RAHUL, PRIYA, ARUN], added: [ARUN], removed: [] } });
    });

    it("cannot reorder: a partner asked for first still comes after the existing team", () => {
      expect(
        change({ viewer: first, before: [RAHUL], requested: [ARUN, RAHUL] }),
      ).toEqual({ ok: true, data: { after: [RAHUL, ARUN], added: [ARUN], removed: [] } });
    });

    it("is a no-op when nothing is added", () => {
      expect(change({ viewer: first, before: [RAHUL, PRIYA], requested: [RAHUL, PRIYA] })).toEqual({
        ok: true,
        data: { after: [RAHUL, PRIYA], added: [], removed: [] },
      });
    });

    it("cannot take anyone off — themselves included", () => {
      const refusal = { ok: false, error: COORDINATOR_ERRORS.officeRemoves };
      expect(change({ viewer: first, before: [RAHUL, PRIYA], requested: [RAHUL] })).toEqual(refusal);
      expect(change({ viewer: first, before: [RAHUL, PRIYA], requested: [PRIYA, ARUN] })).toEqual(
        refusal,
      );
      expect(change({ viewer: first, requested: [] })).toEqual(refusal);
    });

    it("cannot add someone who cannot own a sale", () => {
      expect(change({ viewer: first, requested: [RAHUL, "engineer-1"] })).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.notEligible,
      });
    });

    it.each([
      ["an admin", ADMIN],
      ["the SuperAdmin", ROOT],
    ])("cannot add %s: only the office adds office accounts", (_who, id) => {
      expect(change({ viewer: first, requested: [RAHUL, id] })).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.officeAccount,
      });
      expect(change({ viewer: first, requested: [RAHUL, PRIYA, id] })).toEqual({
        ok: false,
        error: COORDINATOR_ERRORS.officeAccount,
      });
    });

    it("is not stopped by an office account already on the sale (existing members are never re-checked)", () => {
      // The office put the admin on it earlier; a new coordinator partner still joins.
      expect(
        change({ viewer: first, before: [RAHUL, ADMIN], requested: [RAHUL, ADMIN, ARUN] }),
      ).toEqual({ ok: true, data: { after: [RAHUL, ADMIN, ARUN], added: [ARUN], removed: [] } });
    });

    it("is held to five like everyone", () => {
      expect(
        change({
          viewer: coordinator("a"),
          before: ["a", "b", "c", "d", "e"],
          requested: ["a", "b", "c", "d", "e", "f"],
          directory: directoryOf(["a", "b", "c", "d", "e", "f"]),
        }),
      ).toEqual({ ok: false, error: COORDINATOR_ERRORS.tooMany });
    });

    it("is refused once the order is approved or rejected", () => {
      for (const status of ["approved", "rejected"] as const) {
        expect(change({ viewer: first, status, requested: [RAHUL, PRIYA] })).toEqual({
          ok: false,
          error: COORDINATOR_ERRORS.officeAfterReview,
        });
      }
    });
  });

  describe("everyone else", () => {
    const refusal = { ok: false, error: COORDINATOR_ERRORS.addPartnersOnly };

    it("refuses a partner, even on a pending order", () => {
      expect(
        change({ viewer: coordinator(PRIYA), before: [RAHUL, PRIYA], requested: [RAHUL, PRIYA, ARUN] }),
      ).toEqual(refusal);
    });

    it("refuses a coordinator who is not on the sale", () => {
      expect(change({ viewer: coordinator(ARUN), requested: [RAHUL, ARUN] })).toEqual(refusal);
    });

    it("refuses an engineer", () => {
      expect(
        change({ viewer: { id: RAHUL, role: "service_engineer" }, requested: [RAHUL, ARUN] }),
      ).toEqual(refusal);
    });

    it("says who may add partners before it says the order is closed", () => {
      expect(
        change({ viewer: coordinator(PRIYA), status: "approved", before: [RAHUL, PRIYA] }),
      ).toEqual(refusal);
    });
  });
});

describe("diffCoordinators", () => {
  it("lists who joined (in the new order) and who left (in the old)", () => {
    expect(diffCoordinators([RAHUL, PRIYA, ARUN], [SNEHA, RAHUL, MANOHAR])).toEqual({
      added: [SNEHA, MANOHAR],
      removed: [PRIYA, ARUN],
    });
  });

  it("is empty for the same people, however ordered", () => {
    expect(diffCoordinators([RAHUL, PRIYA], [PRIYA, RAHUL])).toEqual({ added: [], removed: [] });
    expect(diffCoordinators([], [])).toEqual({ added: [], removed: [] });
  });

  it("treats a whole new team as all added and all removed", () => {
    expect(diffCoordinators([RAHUL], [PRIYA])).toEqual({ added: [PRIYA], removed: [RAHUL] });
  });
});

describe("describeCoordinatorChange", () => {
  it("names who was added and removed", () => {
    expect(describeCoordinatorChange(["Abhijith Nair"], ["Manohar"])).toBe(
      "Coordinators updated — Abhijith Nair added, Manohar removed.",
    );
  });

  it("says only what happened", () => {
    expect(describeCoordinatorChange(["Abhijith Nair"], [])).toBe(
      "Coordinators updated — Abhijith Nair added.",
    );
    expect(describeCoordinatorChange([], ["Manohar"])).toBe(
      "Coordinators updated — Manohar removed.",
    );
  });

  it("joins several names", () => {
    expect(describeCoordinatorChange(["Ravi", "Abhijith", "Manohar"], ["Anil", "Sneha"])).toBe(
      "Coordinators updated — Ravi, Abhijith & Manohar added, Anil & Sneha removed.",
    );
  });

  it("says so when nothing changed", () => {
    expect(describeCoordinatorChange([], [])).toBe("Coordinators unchanged.");
  });
});

describe("coordinatorChangeEvents", () => {
  const TEAM = [
    { id: RAHUL, full_name: "Rahul Menon" },
    { id: PRIYA, full_name: "Priya Suresh" },
    { id: ARUN, full_name: "Arun Krishnan" },
  ];
  type Input = Parameters<typeof coordinatorChangeEvents>[0];
  const base: Input = {
    actor: { id: RAHUL, full_name: "Rahul Menon", role: "coordinator" },
    workOrderId: "wo-1",
    projectId: null,
    clientName: "Anand Kumar",
    capacity: "3kW",
    team: TEAM,
    added: [PRIYA, ARUN],
    removed: [],
    atCreate: false,
  };

  it("tells the people who were added, once, with the whole team", () => {
    expect(coordinatorChangeEvents(base)).toEqual([
      {
        type: "work_order.coordinator_added",
        actorId: RAHUL,
        actorName: "Rahul Menon",
        addedIds: [PRIYA, ARUN],
        notifyOffice: true,
        workOrderId: "wo-1",
        projectId: null,
        clientName: "Anand Kumar",
        capacity: "3kW",
        teamNames: ["Rahul Menon", "Priya Suresh", "Arun Krishnan"],
      },
    ]);
  });

  it("tells the people who were removed, in a separate event", () => {
    const events = coordinatorChangeEvents({
      ...base,
      actor: { id: ADMIN, full_name: "BSS Admin", role: "admin" },
      team: [TEAM[0]],
      added: [],
      removed: [PRIYA, ARUN],
    });
    expect(events).toEqual([
      {
        type: "work_order.coordinator_removed",
        actorId: ADMIN,
        actorName: "BSS Admin",
        removedIds: [PRIYA, ARUN],
        clientName: "Anand Kumar",
      },
    ]);
  });

  it("makes both events when one change adds and removes", () => {
    const events = coordinatorChangeEvents({
      ...base,
      actor: { id: ADMIN, full_name: "BSS Admin", role: "admin" },
      added: [ARUN],
      removed: [PRIYA],
    });
    expect(events.map((e) => e.type)).toEqual([
      "work_order.coordinator_added",
      "work_order.coordinator_removed",
    ]);
  });

  it("makes nothing when no one joined or left", () => {
    expect(coordinatorChangeEvents({ ...base, added: [], removed: [] })).toEqual([]);
  });

  it("links to the project once there is one", () => {
    const [event] = coordinatorChangeEvents({ ...base, projectId: "pr-1" });
    expect(describeEvent(event).link).toBe("/projects/pr-1");
    expect(describeEvent(coordinatorChangeEvents(base)[0]).link).toBe("/work-orders/wo-1");
  });

  describe("who else hears about added partners", () => {
    const heard = (input: Input) => {
      const [event] = coordinatorChangeEvents(input);
      return resolveRecipients(audienceFor(event), {
        officeIds: [ADMIN, "root"],
        actorId: event.actorId,
      }).sort();
    };

    it("is the office too, when a coordinator brings partners onto an existing sale", () => {
      expect(heard(base)).toEqual([ADMIN, ARUN, PRIYA, "root"].sort());
    });

    it("is only the partners when the sale has just been logged (the office was told by `submitted`)", () => {
      expect(heard({ ...base, atCreate: true })).toEqual([ARUN, PRIYA]);
      expect(coordinatorChangeEvents({ ...base, atCreate: true })[0]).toMatchObject({
        notifyOffice: false,
      });
    });

    it("is only the partners when the office itself added them", () => {
      expect(
        heard({
          ...base,
          actor: { id: ADMIN, full_name: "BSS Admin", role: "admin" },
        }),
      ).toEqual([ARUN, PRIYA]);
    });

    it("never includes the actor, even when the actor adds themselves", () => {
      expect(
        heard({
          ...base,
          actor: { id: ADMIN, full_name: "BSS Admin", role: "admin" },
          added: [ADMIN, PRIYA],
        }),
      ).toEqual([PRIYA]);
    });
  });

  it("tells only the removed person about a removal — never the team or the office", () => {
    const [event] = coordinatorChangeEvents({
      ...base,
      actor: { id: ADMIN, full_name: "BSS Admin", role: "admin" },
      added: [],
      removed: [PRIYA],
    });
    expect(audienceFor(event)).toEqual({ office: false, users: [PRIYA] });
  });

  it("words the copy for the people who read it", () => {
    const [added] = coordinatorChangeEvents(base);
    expect(describeEvent(added)).toMatchObject({
      title: "Rahul Menon added you to a sale",
      body: "Anand Kumar · 3kW — with Rahul Menon, Priya Suresh & Arun Krishnan",
    });
    const [removed] = coordinatorChangeEvents({
      ...base,
      actor: { id: ADMIN, full_name: "BSS Admin", role: "admin" },
      added: [],
      removed: [PRIYA],
    });
    expect(describeEvent(removed)).toMatchObject({
      title: "You were taken off a sale",
      link: "/work-orders",
    });
  });
});
