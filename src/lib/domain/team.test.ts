import { describe, it, expect } from "vitest";
import type { UserRole } from "@/lib/types";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";
import {
  ADMIN_LOGIN_RESERVED,
  TEAM_PASSWORD_MAX_LENGTH,
  TEAM_PHONE_MAX_LENGTH,
  canEditMember,
  deletionBlocker,
  hasPlaceholderEmail,
  planTeamEdit,
  roleChangeBlocker,
  teamEditAuthority,
  type OwnedWork,
  type TeamEditAccount,
  type TeamEditAuthority,
  type TeamEditPosted,
  type TeamEditTarget,
} from "./team";

const NOTHING: OwnedWork = { workOrders: 0, projects: 0, activeTickets: 0 };

describe("deletionBlocker", () => {
  it("allows deleting a member with nothing attached", () => {
    expect(deletionBlocker("Rahul", NOTHING)).toBeNull();
  });

  it("refuses while they own or share sales work, naming what to move", () => {
    expect(deletionBlocker("Rahul", { ...NOTHING, workOrders: 2, projects: 1 })).toBe(
      "Rahul still owns or shares 2 work orders and 1 project. Take them off those sales (Change coordinators on each work order) or delete that business first.",
    );
    expect(deletionBlocker("Rahul", { ...NOTHING, projects: 3 })).toBe(
      "Rahul still owns or shares 3 projects. Take them off those sales (Change coordinators on each work order) or delete that business first.",
    );
  });

  it("counts a shared sale like an owned one", () => {
    // Priya only ever joined Rahul's sale: still business that would be stranded.
    expect(deletionBlocker("Priya", { ...NOTHING, workOrders: 1 })).toMatch(
      /^Priya still owns or shares 1 work order\./,
    );
  });

  it("refuses while an engineer still has open tickets", () => {
    expect(deletionBlocker("Vineeth", { ...NOTHING, activeTickets: 1 })).toBe(
      "Vineeth still has 1 open service ticket. Reassign them to another engineer first.",
    );
    expect(deletionBlocker("Vineeth", { ...NOTHING, activeTickets: 2 })).toMatch(
      /2 open service tickets/,
    );
  });
});

describe("roleChangeBlocker", () => {
  const change = (overrides: Partial<Parameters<typeof roleChangeBlocker>[0]>) =>
    roleChangeBlocker({
      name: "Vineeth",
      from: "coordinator",
      to: "admin",
      adminCount: 2,
      owned: NOTHING,
      ...overrides,
    });

  it("allows an ordinary change", () => {
    expect(change({})).toBeNull();
    expect(change({ from: "coordinator", to: "service_engineer" })).toBeNull();
    expect(change({ from: "service_engineer", to: "coordinator" })).toBeNull();
  });

  it("never removes the last administrator, whatever they become", () => {
    for (const to of ["coordinator", "service_engineer"] as const) {
      expect(change({ from: "admin", to, adminCount: 1 })).toBe(
        "At least one administrator is required.",
      );
    }
    expect(change({ from: "admin", to: "coordinator", adminCount: 2 })).toBeNull();
  });

  it("does not count non-office moves against the last administrator", () => {
    expect(
      change({ from: "service_engineer", to: "coordinator", adminCount: 1 }),
    ).toBeNull();
  });

  it("refuses to make a coordinator who owns business an engineer", () => {
    expect(
      change({
        from: "coordinator",
        to: "service_engineer",
        owned: { ...NOTHING, workOrders: 1 },
      }),
    ).toBe(
      "Vineeth owns or shares 1 work order. Service engineers cannot own sales work — take them off those sales first.",
    );
  });

  it("refuses to make a member of a shared sale an engineer, even a partner who owns nothing else", () => {
    expect(
      change({
        from: "coordinator",
        to: "service_engineer",
        owned: { ...NOTHING, workOrders: 1, projects: 1 },
      }),
    ).toBe(
      "Vineeth owns or shares 1 work order and 1 project. Service engineers cannot own sales work — take them off those sales first.",
    );
  });

  it("refuses to move an engineer off the role while they hold open tickets", () => {
    expect(
      change({
        from: "service_engineer",
        to: "admin",
        owned: { ...NOTHING, activeTickets: 2 },
      }),
    ).toMatch(/still has 2 open service tickets/);
  });

  it("is a no-op when the role does not change", () => {
    expect(
      change({ from: "admin", to: "admin", adminCount: 1, owned: { ...NOTHING, workOrders: 4 } }),
    ).toBeNull();
  });
});

// --- Editing a member ----------------------------------------------------------

const ALL: TeamEditAuthority = { name: true, phone: true, email: true, password: true };
const NONE: TeamEditAuthority = { name: false, phone: false, email: false, password: false };
const PROFILE_ONLY: TeamEditAuthority = { name: true, phone: true, email: false, password: false };

const SUPER = { id: "super-1", role: "superadmin" as const };
const ADMIN = { id: "admin-1", role: "admin" as const };
const OTHER_ADMIN = { id: "admin-2", role: "admin" as const };
const COORDINATOR = { id: "coord-1", role: "coordinator" as const };
const ENGINEER = { id: "eng-1", role: "service_engineer" as const };

type Who = { id: string; role: UserRole };

describe("teamEditAuthority", () => {
  // Every viewer against every kind of target. The Super Admin is exactly one
  // account, so as a target it is either the viewer (themself) or someone else's.
  type Case = {
    viewer: string;
    by: Who;
    target: string;
    of: Who;
    expected: TeamEditAuthority;
  };
  const MATRIX: Case[] = [
    // The Super Admin: everything, for anyone — admins and themself included.
    { viewer: "superadmin", by: SUPER, target: "themself", of: SUPER, expected: ALL },
    { viewer: "superadmin", by: SUPER, target: "an admin", of: ADMIN, expected: ALL },
    { viewer: "superadmin", by: SUPER, target: "a coordinator", of: COORDINATOR, expected: ALL },
    { viewer: "superadmin", by: SUPER, target: "a service engineer", of: ENGINEER, expected: ALL },
    // An admin: name and phone of everyone but the Super Admin; the login only
    // of coordinators, engineers and themself.
    { viewer: "admin", by: ADMIN, target: "the superadmin", of: SUPER, expected: NONE },
    { viewer: "admin", by: ADMIN, target: "themself", of: ADMIN, expected: ALL },
    { viewer: "admin", by: ADMIN, target: "another admin", of: OTHER_ADMIN, expected: PROFILE_ONLY },
    { viewer: "admin", by: ADMIN, target: "a coordinator", of: COORDINATOR, expected: ALL },
    { viewer: "admin", by: ADMIN, target: "a service engineer", of: ENGINEER, expected: ALL },
    // Everyone else gets nothing — not even their own row.
    { viewer: "coordinator", by: COORDINATOR, target: "the superadmin", of: SUPER, expected: NONE },
    { viewer: "coordinator", by: COORDINATOR, target: "an admin", of: ADMIN, expected: NONE },
    { viewer: "coordinator", by: COORDINATOR, target: "themself", of: COORDINATOR, expected: NONE },
    { viewer: "coordinator", by: COORDINATOR, target: "a service engineer", of: ENGINEER, expected: NONE },
    { viewer: "service_engineer", by: ENGINEER, target: "the superadmin", of: SUPER, expected: NONE },
    { viewer: "service_engineer", by: ENGINEER, target: "an admin", of: ADMIN, expected: NONE },
    { viewer: "service_engineer", by: ENGINEER, target: "a coordinator", of: COORDINATOR, expected: NONE },
    { viewer: "service_engineer", by: ENGINEER, target: "themself", of: ENGINEER, expected: NONE },
  ];

  it.each(MATRIX)("a $viewer viewing $target", ({ by, of, expected }) => {
    expect(teamEditAuthority(by, of)).toEqual(expected);
  });

  it("covers every viewer role against every target role", () => {
    const roles: UserRole[] = ["superadmin", "admin", "coordinator", "service_engineer"];
    const covered = new Set(MATRIX.map(({ by, of }) => `${by.role}>${of.role}`));
    for (const viewer of roles) {
      for (const target of roles) {
        expect(covered.has(`${viewer}>${target}`), `${viewer} > ${target}`).toBe(true);
      }
    }
  });

  it("keeps an admin's hands off another admin's login but not off their profile", () => {
    const allowed = teamEditAuthority(ADMIN, OTHER_ADMIN);
    expect(allowed.email).toBe(false);
    expect(allowed.password).toBe(false);
    expect(allowed.name).toBe(true);
    expect(allowed.phone).toBe(true);
  });

  it("returns a fresh object each call, so a caller cannot corrupt the next answer", () => {
    const first = teamEditAuthority(SUPER, ADMIN);
    first.email = false;
    expect(teamEditAuthority(SUPER, ADMIN).email).toBe(true);
  });
});

describe("canEditMember", () => {
  it("is true when any one field may be changed", () => {
    expect(canEditMember(ALL)).toBe(true);
    expect(canEditMember(PROFILE_ONLY)).toBe(true);
    expect(canEditMember({ ...NONE, phone: true })).toBe(true);
  });

  it("is false when nothing may be", () => {
    expect(canEditMember(NONE)).toBe(false);
  });
});

describe("hasPlaceholderEmail", () => {
  it("spots the reserved .invalid domain, in any case", () => {
    expect(hasPlaceholderEmail("ravi@bsssolar.invalid")).toBe(true);
    expect(hasPlaceholderEmail("RAVI@BSSSOLAR.INVALID")).toBe(true);
    expect(hasPlaceholderEmail(" ravi@bsssolar.invalid ")).toBe(true);
  });

  it("leaves real addresses, unknown ones and look-alikes alone", () => {
    expect(hasPlaceholderEmail("ravi@bsssolar.in")).toBe(false);
    expect(hasPlaceholderEmail("ravi@invalid.in")).toBe(false);
    expect(hasPlaceholderEmail("invalid@bsssolar.com")).toBe(false);
    expect(hasPlaceholderEmail(null)).toBe(false);
  });
});

describe("planTeamEdit", () => {
  const RAVEE: TeamEditTarget = {
    id: COORDINATOR.id,
    role: "coordinator",
    full_name: "Ravee Kumar",
    phone: "9048001332",
    email: "ravi@bsssolar.invalid",
  };
  const ACCOUNTS: TeamEditAccount[] = [
    { id: RAVEE.id, fullName: "Ravee Kumar", email: "ravi@bsssolar.invalid" },
    { id: SUPER.id, fullName: "BSS SuperAdmin", email: "super@bsssolar.test" },
    { id: ADMIN.id, fullName: "BSS Admin", email: "admin@bsssolar.test" },
    { id: OTHER_ADMIN.id, fullName: "Meera Pillai", email: "meera@bsssolar.test" },
    { id: "priya-1", fullName: "Priya Suresh", email: "priya@bsssolar.test" },
  ];

  const plan = (
    posted: TeamEditPosted,
    options: { viewer?: Who; target?: TeamEditTarget } = {},
  ) =>
    planTeamEdit({
      viewer: options.viewer ?? ADMIN,
      target: options.target ?? RAVEE,
      posted,
      accounts: ACCOUNTS,
    });

  const refused = (result: ReturnType<typeof plan>) =>
    result.ok ? "(accepted)" : result.error;

  describe("what it writes", () => {
    it("plans nothing when nothing changed", () => {
      expect(plan({})).toEqual({ ok: true, data: { profile: null, auth: null } });
      // A form that posts every field as it already is changes nothing either.
      expect(
        plan({
          fullName: "Ravee Kumar",
          phone: "9048001332",
          email: "ravi@bsssolar.invalid",
          password: "",
        }),
      ).toEqual({ ok: true, data: { profile: null, auth: null } });
    });

    it("renames: the profile, and the name Auth keeps beside the login", () => {
      expect(plan({ fullName: "Ravi Kumar" })).toEqual({
        ok: true,
        data: { profile: { full_name: "Ravi Kumar" }, auth: { fullName: "Ravi Kumar" } },
      });
    });

    it("stores a name trimmed, with runs of spaces made single", () => {
      expect(plan({ fullName: "  Ravi   Kumar  " })).toMatchObject({
        ok: true,
        data: { profile: { full_name: "Ravi Kumar" } },
      });
    });

    it("changes only the phone without touching Auth", () => {
      expect(plan({ phone: " 0471 2439322 " })).toEqual({
        ok: true,
        data: { profile: { phone: "0471 2439322" }, auth: null },
      });
    });

    it("clears the phone when it is emptied", () => {
      expect(plan({ phone: "  " })).toEqual({
        ok: true,
        data: { profile: { phone: null }, auth: null },
      });
      // …and an empty phone on a member who has none is no change.
      expect(plan({ phone: "" }, { target: { ...RAVEE, phone: null } })).toEqual({
        ok: true,
        data: { profile: null, auth: null },
      });
    });

    it("sets the e-mail trimmed and lower-cased", () => {
      expect(plan({ email: "  Ravi.Kumar@BSSSolar.IN " })).toEqual({
        ok: true,
        data: { profile: null, auth: { email: "ravi.kumar@bsssolar.in" } },
      });
    });

    it("does not count a different spelling of the same e-mail as a change", () => {
      expect(
        plan({ email: "RAVI@bsssolar.invalid" }),
      ).toEqual({ ok: true, data: { profile: null, auth: null } });
    });

    it("sets a new password, exactly as typed", () => {
      const password = "  correct horse battery  ";
      expect(plan({ password })).toEqual({
        ok: true,
        data: { profile: null, auth: { password } },
      });
    });

    it.each([undefined, "", "   "])("keeps the current password when the field is %j", (password) => {
      expect(plan({ password })).toEqual({ ok: true, data: { profile: null, auth: null } });
    });

    it("plans every field in one edit", () => {
      expect(
        plan({
          fullName: "Ravi Kumar",
          phone: "9847012345",
          email: "ravi@bsssolar.in",
          password: "a-brand-new-secret",
        }),
      ).toEqual({
        ok: true,
        data: {
          profile: { full_name: "Ravi Kumar", phone: "9847012345" },
          auth: {
            email: "ravi@bsssolar.in",
            password: "a-brand-new-secret",
            fullName: "Ravi Kumar",
          },
        },
      });
    });

    it("never plans a role", () => {
      const result = plan({ fullName: "Ravi Kumar", email: "ravi@bsssolar.in" });
      expect(JSON.stringify(result)).not.toMatch(/role/);
    });
  });

  describe("who may change what", () => {
    it("lets the Super Admin change an admin's e-mail and password", () => {
      const meera: TeamEditTarget = {
        id: OTHER_ADMIN.id,
        role: "admin",
        full_name: "Meera Pillai",
        phone: null,
        email: "meera@bsssolar.test",
      };
      expect(
        plan({ email: "meera@bsssolar.in", password: "a-brand-new-secret" }, { viewer: SUPER, target: meera }),
      ).toEqual({
        ok: true,
        data: {
          profile: null,
          auth: { email: "meera@bsssolar.in", password: "a-brand-new-secret" },
        },
      });
    });

    describe("an admin editing another admin", () => {
      const meera: TeamEditTarget = {
        id: OTHER_ADMIN.id,
        role: "admin",
        full_name: "Meera Pillai",
        phone: null,
        email: "meera@bsssolar.test",
      };
      const asAdmin = (posted: TeamEditPosted) => plan(posted, { viewer: ADMIN, target: meera });

      it("may correct the name and phone", () => {
        expect(asAdmin({ fullName: "Meera Pillay", phone: "9847000000" })).toEqual({
          ok: true,
          data: {
            profile: { full_name: "Meera Pillay", phone: "9847000000" },
            auth: { fullName: "Meera Pillay" },
          },
        });
      });

      it("may not change the e-mail", () => {
        expect(refused(asAdmin({ email: "meera@elsewhere.in" }))).toBe(ADMIN_LOGIN_RESERVED);
      });

      it("may not change the password", () => {
        expect(refused(asAdmin({ password: "a-brand-new-secret" }))).toBe(ADMIN_LOGIN_RESERVED);
      });

      it("is refused whole when a permitted change rides along with a forbidden one", () => {
        expect(refused(asAdmin({ fullName: "Meera Pillay", email: "meera@elsewhere.in" }))).toBe(
          ADMIN_LOGIN_RESERVED,
        );
      });

      it("is not penalised for posting the e-mail unchanged", () => {
        expect(asAdmin({ fullName: "Meera Pillay", email: "meera@bsssolar.test", password: "" })).toMatchObject({
          ok: true,
          data: { profile: { full_name: "Meera Pillay" }, auth: { fullName: "Meera Pillay" } },
        });
      });
    });

    it("lets an admin change their own e-mail and password", () => {
      const self: TeamEditTarget = {
        id: ADMIN.id,
        role: "admin",
        full_name: "BSS Admin",
        phone: null,
        email: "admin@bsssolar.test",
      };
      expect(
        plan({ email: "office@bsssolar.in", password: "a-brand-new-secret" }, { viewer: ADMIN, target: self }),
      ).toMatchObject({ ok: true, data: { auth: { email: "office@bsssolar.in", password: "a-brand-new-secret" } } });
    });

    describe("the Super Admin's own details", () => {
      const boss: TeamEditTarget = {
        id: SUPER.id,
        role: "superadmin",
        full_name: "BSS SuperAdmin",
        phone: null,
        email: "super@bsssolar.test",
      };
      const asAdmin = (posted: TeamEditPosted) => plan(posted, { viewer: ADMIN, target: boss });
      const REFUSAL = "Only the Super Admin can change the Super Admin's details.";

      it.each([
        ["name", { fullName: "Boss" }],
        ["phone", { phone: "9847000000" }],
        ["e-mail", { email: "boss@elsewhere.in" }],
        ["password", { password: "a-brand-new-secret" }],
      ] as [string, TeamEditPosted][])("refuses an admin changing their %s", (_field, posted) => {
        expect(refused(asAdmin(posted))).toBe(REFUSAL);
      });

      it("refuses an admin even when the form changes nothing", () => {
        expect(refused(asAdmin({}))).toBe(REFUSAL);
        expect(refused(asAdmin({ fullName: "BSS SuperAdmin" }))).toBe(REFUSAL);
      });

      it("lets the Super Admin change their own", () => {
        expect(
          plan(
            { fullName: "BSS Super Admin", email: "boss@bsssolar.in", password: "a-brand-new-secret" },
            { viewer: SUPER, target: boss },
          ),
        ).toMatchObject({
          ok: true,
          data: { profile: { full_name: "BSS Super Admin" }, auth: { email: "boss@bsssolar.in" } },
        });
      });
    });

    it.each([
      ["a coordinator", COORDINATOR],
      ["a service engineer", ENGINEER],
    ])("refuses %s, whatever they post", (_who, viewer) => {
      expect(refused(plan({ fullName: "Ravi Kumar" }, { viewer }))).toBe(
        "Only office staff can edit team members.",
      );
      expect(refused(plan({}, { viewer }))).toBe("Only office staff can edit team members.");
    });
  });

  describe("validation", () => {
    it("wants a name of 2 to 80 characters once trimmed", () => {
      const MESSAGE = "The name must be 2–80 characters.";
      expect(refused(plan({ fullName: "" }))).toBe(MESSAGE);
      expect(refused(plan({ fullName: "  R  " }))).toBe(MESSAGE);
      expect(refused(plan({ fullName: "R".repeat(81) }))).toBe(MESSAGE);
      expect(plan({ fullName: "Ra" }).ok).toBe(true);
      expect(plan({ fullName: "R".repeat(80) }).ok).toBe(true);
    });

    it("wants an e-mail address", () => {
      for (const email of ["", "ravi", "ravi@", "@bsssolar.in", "ravi@bsssolar", "ra vi@bsssolar.in", `${"a".repeat(250)}@x.in`]) {
        expect(refused(plan({ email })), email).toBe("Enter a valid e-mail address.");
      }
      expect(plan({ email: "ravi+sales@bsssolar.co.in" }).ok).toBe(true);
    });

    it("caps the phone number", () => {
      expect(refused(plan({ phone: "9".repeat(TEAM_PHONE_MAX_LENGTH + 1) }))).toBe(
        `The phone number can be at most ${TEAM_PHONE_MAX_LENGTH} characters.`,
      );
      expect(plan({ phone: "9".repeat(TEAM_PHONE_MAX_LENGTH) }).ok).toBe(true);
    });

    it("wants a password of the minimum length, and not more than Auth can hash", () => {
      expect(refused(plan({ password: "x".repeat(MIN_PASSWORD_LENGTH - 1) }))).toBe(
        `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      expect(refused(plan({ password: "x".repeat(TEAM_PASSWORD_MAX_LENGTH + 1) }))).toBe(
        `The password can be at most ${TEAM_PASSWORD_MAX_LENGTH} characters.`,
      );
      expect(plan({ password: "x".repeat(MIN_PASSWORD_LENGTH) }).ok).toBe(true);
      expect(plan({ password: "x".repeat(TEAM_PASSWORD_MAX_LENGTH) }).ok).toBe(true);
    });

    it("never repeats the password in a message", () => {
      const password = "short-pw";
      expect(refused(plan({ password }))).not.toContain(password);
    });

    it("does not re-validate what was not changed", () => {
      // A legacy one-letter name that is not being touched must not block a phone fix.
      const legacy: TeamEditTarget = { ...RAVEE, full_name: "R" };
      expect(plan({ fullName: "R", phone: "9847012345" }, { target: legacy }).ok).toBe(true);
    });
  });

  describe("duplicates", () => {
    it("refuses another account's name, ignoring case and spacing", () => {
      for (const fullName of ["Priya Suresh", "priya suresh", "PRIYA   SURESH", " Priya Suresh "]) {
        expect(refused(plan({ fullName })), fullName).toMatch(
          /^Another team member is already named "/,
        );
      }
    });

    it("says why: the importer finds coordinators by name", () => {
      expect(refused(plan({ fullName: "Priya Suresh" }))).toBe(
        'Another team member is already named "Priya Suresh". Names must be unique — the bulk import finds coordinators by name.',
      );
    });

    it("lets a name differ from another's by more than case", () => {
      expect(plan({ fullName: "Priya Suresh Nair" }).ok).toBe(true);
      expect(plan({ fullName: "Priya Sureshan" }).ok).toBe(true);
    });

    it("lets a member change the case of their own name", () => {
      expect(plan({ fullName: "ravee kumar" })).toMatchObject({
        ok: true,
        data: { profile: { full_name: "ravee kumar" } },
      });
    });

    it("does not let a name that is already taken block an edit that leaves the name alone", () => {
      // A duplicate that already exists in the data is not this edit's problem.
      const twin: TeamEditTarget = { ...RAVEE, full_name: "Priya Suresh" };
      expect(plan({ fullName: "Priya Suresh", phone: "9847012345" }, { target: twin })).toMatchObject({
        ok: true,
        data: { profile: { phone: "9847012345" } },
      });
    });

    it("refuses another account's e-mail, ignoring case", () => {
      expect(refused(plan({ email: "Priya@BSSSolar.test" }))).toBe(
        "priya@bsssolar.test already belongs to another team member.",
      );
    });

    it("lets a member keep or re-case their own e-mail", () => {
      expect(plan({ email: "RAVI@bsssolar.invalid" }).ok).toBe(true);
    });

    it("answers a forbidden change before a duplicate, so a refusal reveals nothing about the team", () => {
      const meera: TeamEditTarget = {
        id: OTHER_ADMIN.id,
        role: "admin",
        full_name: "Meera Pillai",
        phone: null,
        email: "meera@bsssolar.test",
      };
      // Super's address is taken, but an admin is told only that it is not theirs to change.
      expect(refused(plan({ email: "super@bsssolar.test" }, { viewer: ADMIN, target: meera }))).toBe(
        ADMIN_LOGIN_RESERVED,
      );
    });

    it("validates before it looks for duplicates", () => {
      const result = planTeamEdit({
        viewer: ADMIN,
        target: RAVEE,
        posted: { fullName: "P" },
        accounts: [{ id: "someone", fullName: "P", email: null }],
      });
      expect(refused(result)).toBe("The name must be 2–80 characters.");
    });
  });
});
