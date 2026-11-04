import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

// redirect() throws in Next; emulate that so the target can be asserted.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(),
  requireSuperAdmin: vi.fn(),
}));
const adminClient = vi.hoisted(() => ({
  auth: { admin: { deleteUser: vi.fn(), createUser: vi.fn(), updateUserById: vi.fn() } },
  from: vi.fn(),
}));
const createAdminClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/server/data/profiles.repository", () => ({
  profilesRepository: {
    byId: vi.fn(),
    accounts: vi.fn(),
    adminCount: vi.fn(),
    ownedWorkCount: vi.fn(),
    setRole: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { deleteTeamMember, updateTeamMember, updateUserRole } from "./actions";

const profiles = vi.mocked(profilesRepository);

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;
const SUPERADMIN = { id: "super-1", role: "superadmin", full_name: "Boss" } as Profile;
/** Priya never logged a work order — she only joined Rahul's sale. */
const PRIYA = { id: "priya-1", role: "coordinator", full_name: "Priya Suresh" } as Profile;

const NOTHING = { workOrders: 0, projects: 0, activeTickets: 0 };
const SHARES_ONE_SALE = { workOrders: 1, projects: 1, activeTickets: 0 };

/** Every write the action makes to `profiles`: (patch, column, value). */
const profileWrite = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  vi.mocked(requireSuperAdmin).mockResolvedValue(SUPERADMIN);
  profiles.byId.mockResolvedValue(PRIYA);
  profiles.adminCount.mockResolvedValue(2);
  profiles.ownedWorkCount.mockResolvedValue(NOTHING);
  profiles.setRole.mockResolvedValue({ error: null });
  adminClient.auth.admin.deleteUser.mockResolvedValue({ error: null });
  adminClient.auth.admin.updateUserById.mockResolvedValue({ error: null });
  createAdminClient.mockReturnValue(adminClient);
  adminClient.from.mockReturnValue({
    update: (patch: unknown) => ({
      eq: (column: string, value: string) => profileWrite(patch, column, value),
    }),
  });
  profileWrite.mockResolvedValue({ error: null });
  profiles.accounts.mockResolvedValue({ accounts: DIRECTORY, error: null });
});

describe("updateUserRole", () => {
  it("makes a coordinator with no sales an engineer", async () => {
    await expect(updateUserRole("priya-1", "service_engineer")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(profiles.setRole).toHaveBeenCalledWith("priya-1", "service_engineer");
  });

  it("will not make a member of a shared sale an engineer, and says how to fix it", async () => {
    profiles.ownedWorkCount.mockResolvedValue(SHARES_ONE_SALE);
    await expect(updateUserRole("priya-1", "service_engineer")).resolves.toEqual({
      ok: false,
      error:
        "Priya Suresh owns or shares 1 work order and 1 project. Service engineers cannot own sales work — take them off those sales first.",
    });
    expect(profiles.setRole).not.toHaveBeenCalled();
  });

  it("counts the sales before it changes anything (the count is the shared one)", async () => {
    profiles.ownedWorkCount.mockResolvedValue(SHARES_ONE_SALE);
    await updateUserRole("priya-1", "service_engineer");
    expect(profiles.ownedWorkCount).toHaveBeenCalledWith("priya-1");
  });

  it("lets a member of a shared sale move between the roles that may own one", async () => {
    profiles.ownedWorkCount.mockResolvedValue(SHARES_ONE_SALE);
    await expect(updateUserRole("priya-1", "admin")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(profiles.setRole).toHaveBeenCalledWith("priya-1", "admin");
  });
});

describe("deleteTeamMember", () => {
  it("will not delete a member who only shares a sale, and says how to fix it", async () => {
    profiles.ownedWorkCount.mockResolvedValue(SHARES_ONE_SALE);
    await expect(deleteTeamMember(form({ user_id: "priya-1" }))).rejects.toThrow(
      `REDIRECT:/team?error=${encodeURIComponent(
        "Priya Suresh still owns or shares 1 work order and 1 project. Take them off those sales (Change coordinators on each work order) or delete that business first.",
      )}`,
    );
    expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes a member with nothing attached", async () => {
    await expect(deleteTeamMember(form({ user_id: "priya-1" }))).rejects.toThrow(
      /^REDIRECT:\/team\?flash=/,
    );
    expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith("priya-1");
  });
});

// --- updateTeamMember ------------------------------------------------------------

/** Created with a placeholder e-mail and no usable password; the name is misspelled. */
const RAVEE = {
  id: "ravee-1",
  role: "coordinator",
  full_name: "Ravee Kumar",
  phone: "9048001332",
} as Profile;
/** Another admin: the viewer may fix their name, but not their login. */
const MEERA = { id: "admin-2", role: "admin", full_name: "Meera Pillai", phone: null } as Profile;
const BOSS = { id: "super-1", role: "superadmin", full_name: "Boss", phone: null } as Profile;

const DIRECTORY = [
  { id: "ravee-1", fullName: "Ravee Kumar", email: "ravi@bsssolar.invalid", role: "coordinator" as const },
  { id: "priya-1", fullName: "Priya Suresh", email: "priya@bsssolar.test", role: "coordinator" as const },
  { id: "admin-1", fullName: "BSS Admin", email: "admin@bsssolar.test", role: "admin" as const },
  { id: "admin-2", fullName: "Meera Pillai", email: "meera@bsssolar.test", role: "admin" as const },
  { id: "super-1", fullName: "Boss", email: "super@bsssolar.test", role: "superadmin" as const },
];

const NEW_PASSWORD = "a-brand-new-secret";

/** The edit dialog's form for `id`. */
function edit(id: string, fields: Record<string, string> = {}): FormData {
  return form({ id, ...fields });
}

/** Nothing reached the database, Auth or the caches. */
function expectNothingWritten() {
  expect(profileWrite).not.toHaveBeenCalled();
  expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
}

describe("updateTeamMember", () => {
  beforeEach(() => {
    profiles.byId.mockResolvedValue(RAVEE);
  });

  describe("fixing a coordinator", () => {
    it("renames them: the profile first, then the name Auth keeps, and says Saved.", async () => {
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" })),
      ).resolves.toEqual({ ok: true, data: { message: "Saved." } });

      expect(profileWrite).toHaveBeenCalledTimes(1);
      expect(profileWrite).toHaveBeenCalledWith({ full_name: "Ravi Kumar" }, "id", "ravee-1");
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith("ravee-1", {
        user_metadata: { full_name: "Ravi Kumar" },
      });
      // Profile before Auth, so a refusal from Auth can still undo it.
      expect(profileWrite.mock.invocationCallOrder[0]).toBeLessThan(
        adminClient.auth.admin.updateUserById.mock.invocationCallOrder[0],
      );
    });

    it("refreshes everywhere the name shows: team, work orders, projects, dashboard", async () => {
      await updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" }));
      const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
      expect(paths).toEqual(expect.arrayContaining(["/team", "/work-orders", "/projects", "/"]));
    });

    it("gives a placeholder account a real e-mail and a password, confirmed so nobody is mailed", async () => {
      await expect(
        updateTeamMember(
          null,
          edit("ravee-1", { email: "Ravi@BSSSolar.in", password: NEW_PASSWORD }),
        ),
      ).resolves.toEqual({ ok: true, data: { message: "Saved." } });

      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith("ravee-1", {
        email: "ravi@bsssolar.in",
        email_confirm: true,
        password: NEW_PASSWORD,
      });
      // The profile has nothing to change, so it is not written.
      expect(profileWrite).not.toHaveBeenCalled();
    });

    it("changes just the phone without touching Auth", async () => {
      await updateTeamMember(null, edit("ravee-1", { phone: "9847012345" }));
      expect(profileWrite).toHaveBeenCalledWith({ phone: "9847012345" }, "id", "ravee-1");
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    });

    it("clears a phone that is emptied", async () => {
      await updateTeamMember(null, edit("ravee-1", { phone: "" }));
      expect(profileWrite).toHaveBeenCalledWith({ phone: null }, "id", "ravee-1");
    });

    it("sends a form that repeats the current values as no change at all", async () => {
      await expect(
        updateTeamMember(
          null,
          edit("ravee-1", {
            full_name: "Ravee Kumar",
            phone: "9048001332",
            email: "ravi@bsssolar.invalid",
            password: "",
          }),
        ),
      ).resolves.toEqual({ ok: true, data: { message: "No changes to save." } });
      expectNothingWritten();
    });

    it("never writes a role, whatever the form says", async () => {
      await updateTeamMember(
        null,
        edit("ravee-1", { full_name: "Ravi Kumar", role: "superadmin" }),
      );
      expect(JSON.stringify(profileWrite.mock.calls)).not.toMatch(/role|superadmin/);
      expect(JSON.stringify(adminClient.auth.admin.updateUserById.mock.calls)).not.toMatch(
        /role|superadmin/,
      );
    });

    it("sends Auth one call with only what changed, so nobody's session is touched", async () => {
      // No sign-out, no ban, no session refresh: just the new e-mail, confirmed.
      await updateTeamMember(null, edit("ravee-1", { email: "ravi@bsssolar.in" }));
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledTimes(1);
      const [, attributes] = adminClient.auth.admin.updateUserById.mock.calls[0];
      expect(Object.keys(attributes).sort()).toEqual(["email", "email_confirm"]);
      expect(adminClient.auth.admin.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe("who may edit whom", () => {
    it("lets an admin fix another admin's name and phone", async () => {
      profiles.byId.mockResolvedValue(MEERA);
      await expect(
        updateTeamMember(null, edit("admin-2", { full_name: "Meera Pillay", phone: "9847000000" })),
      ).resolves.toEqual({ ok: true, data: { message: "Saved." } });
      expect(profileWrite).toHaveBeenCalledWith(
        { full_name: "Meera Pillay", phone: "9847000000" },
        "id",
        "admin-2",
      );
    });

    it.each([
      ["e-mail", { email: "meera@elsewhere.in" }],
      ["password", { password: NEW_PASSWORD }],
    ])("refuses an admin changing another admin's %s, and writes nothing", async (_f, fields) => {
      profiles.byId.mockResolvedValue(MEERA);
      await expect(updateTeamMember(null, edit("admin-2", fields))).resolves.toEqual({
        ok: false,
        error: "Only the Super Admin can change another admin's e-mail or password.",
      });
      expectNothingWritten();
    });

    it("refuses the whole edit when a forbidden change rides along with a permitted one", async () => {
      profiles.byId.mockResolvedValue(MEERA);
      await expect(
        updateTeamMember(null, edit("admin-2", { full_name: "Meera Pillay", email: "meera@elsewhere.in" })),
      ).resolves.toMatchObject({ ok: false });
      expectNothingWritten();
    });

    it.each([
      ["name", { full_name: "Not the boss" }],
      ["phone", { phone: "9847000000" }],
      ["e-mail", { email: "boss@elsewhere.in" }],
      ["password", { password: NEW_PASSWORD }],
    ])("refuses an admin changing the Super Admin's %s, and writes nothing", async (_f, fields) => {
      profiles.byId.mockResolvedValue(BOSS);
      await expect(updateTeamMember(null, edit("super-1", fields))).resolves.toEqual({
        ok: false,
        error: "Only the Super Admin can change the Super Admin's details.",
      });
      expectNothingWritten();
    });

    it("lets the Super Admin change an admin's e-mail and password", async () => {
      vi.mocked(requireAdmin).mockResolvedValue(SUPERADMIN);
      profiles.byId.mockResolvedValue(MEERA);
      await expect(
        updateTeamMember(null, edit("admin-2", { email: "meera@bsssolar.in", password: NEW_PASSWORD })),
      ).resolves.toEqual({ ok: true, data: { message: "Saved." } });
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith("admin-2", {
        email: "meera@bsssolar.in",
        email_confirm: true,
        password: NEW_PASSWORD,
      });
    });

    it("lets the Super Admin change their own details", async () => {
      vi.mocked(requireAdmin).mockResolvedValue(SUPERADMIN);
      profiles.byId.mockResolvedValue(BOSS);
      await expect(
        updateTeamMember(null, edit("super-1", { full_name: "BSS Boss", email: "boss@bsssolar.in" })),
      ).resolves.toEqual({ ok: true, data: { message: "Saved." } });
    });

    it("lets an admin change their own e-mail and password", async () => {
      profiles.byId.mockResolvedValue(ADMIN);
      await expect(
        updateTeamMember(null, edit("admin-1", { email: "office@bsssolar.in", password: NEW_PASSWORD })),
      ).resolves.toEqual({ ok: true, data: { message: "Saved." } });
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith("admin-1", {
        email: "office@bsssolar.in",
        email_confirm: true,
        password: NEW_PASSWORD,
      });
    });

    it("judges by the role the database holds, not the one the form claims", async () => {
      // The form insists Meera is a coordinator; the database says admin.
      profiles.byId.mockResolvedValue(MEERA);
      await expect(
        updateTeamMember(null, edit("admin-2", { role: "coordinator", email: "meera@elsewhere.in" })),
      ).resolves.toMatchObject({ ok: false });
      expectNothingWritten();
    });

    it("refuses a viewer who is not office even if the guard let them through", async () => {
      vi.mocked(requireAdmin).mockResolvedValue({
        id: "coord-9",
        role: "coordinator",
        full_name: "Sneha Das",
      } as Profile);
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" })),
      ).resolves.toEqual({ ok: false, error: "Only office staff can edit team members." });
      expectNothingWritten();
    });

    it("stops at the guard when the viewer is not signed in as office", async () => {
      vi.mocked(requireAdmin).mockRejectedValue(new Error("REDIRECT:/work-orders"));
      await expect(updateTeamMember(null, edit("ravee-1", { full_name: "Ravi" }))).rejects.toThrow(
        "REDIRECT:/work-orders",
      );
      expect(profiles.byId).not.toHaveBeenCalled();
      expectNothingWritten();
    });
  });

  describe("refusals before anything is written", () => {
    it("says so when the member is gone", async () => {
      profiles.byId.mockResolvedValue(null);
      await expect(updateTeamMember(null, edit("ghost", { full_name: "Ravi Kumar" }))).resolves.toEqual({
        ok: false,
        error: "That team member no longer exists.",
      });
      expectNothingWritten();
    });

    it("refuses a name another account already has, ignoring case and spacing", async () => {
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "  priya   SURESH " })),
      ).resolves.toEqual({
        ok: false,
        error:
          'Another team member is already named "priya SURESH". Names must be unique — the bulk import finds coordinators by name.',
      });
      expectNothingWritten();
    });

    it("refuses an e-mail another account already has", async () => {
      await expect(
        updateTeamMember(null, edit("ravee-1", { email: "Priya@bsssolar.test" })),
      ).resolves.toEqual({
        ok: false,
        error: "priya@bsssolar.test already belongs to another team member.",
      });
      expectNothingWritten();
    });

    it("checks duplicates before the first write, so a duplicate e-mail leaves the new name unsaved", async () => {
      await expect(
        updateTeamMember(
          null,
          edit("ravee-1", { full_name: "Ravi Kumar", email: "priya@bsssolar.test" }),
        ),
      ).resolves.toMatchObject({ ok: false });
      expect(profileWrite).not.toHaveBeenCalled();
    });

    it.each([
      ["a name that is too short", { full_name: "R" }, /name must be 2–80/],
      ["a name that is too long", { full_name: "R".repeat(81) }, /name must be 2–80/],
      ["an e-mail that is not one", { email: "ravi@" }, /valid e-mail/],
      ["an e-mail that is blank", { email: "" }, /valid e-mail/],
      ["a password that is too short", { password: "short" }, /at least 12 characters/],
    ])("refuses %s", async (_what, fields, message) => {
      await expect(updateTeamMember(null, edit("ravee-1", fields))).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(message),
      });
      expectNothingWritten();
    });

    it("refuses, rather than guess, when the team's accounts cannot be read", async () => {
      profiles.accounts.mockResolvedValue({ accounts: [], error: "boom" });
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" })),
      ).resolves.toEqual({
        ok: false,
        error: "Could not check the team's accounts just now — try again.",
      });
      expectNothingWritten();
    });

    it("explains a missing service-role key instead of failing", async () => {
      createAdminClient.mockImplementationOnce(() => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin operations.");
      });
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" })),
      ).resolves.toEqual({
        ok: false,
        error: "SUPABASE_SERVICE_ROLE_KEY is required for admin operations.",
      });
      expectNothingWritten();
    });
  });

  describe("when a write fails", () => {
    it("reports a profile that would not save, and never reaches Auth", async () => {
      profileWrite.mockResolvedValueOnce({ error: { message: "permission denied" } });
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar", email: "ravi@bsssolar.in" })),
      ).resolves.toEqual({ ok: false, error: "Could not save the changes: permission denied" });
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("puts the profile back when Auth refuses, and says nothing was saved", async () => {
      adminClient.auth.admin.updateUserById.mockResolvedValue({
        error: { message: "A user with this email address has already been registered", code: "email_exists" },
      });
      await expect(
        updateTeamMember(
          null,
          edit("ravee-1", { full_name: "Ravi Kumar", phone: "9847012345", email: "ravi@bsssolar.in" }),
        ),
      ).resolves.toEqual({
        ok: false,
        error: "ravi@bsssolar.in already belongs to another account. Nothing was saved.",
      });

      // The write, then exactly the columns it changed, back to what they were.
      expect(profileWrite).toHaveBeenCalledTimes(2);
      expect(profileWrite).toHaveBeenNthCalledWith(
        1,
        { full_name: "Ravi Kumar", phone: "9847012345" },
        "id",
        "ravee-1",
      );
      expect(profileWrite).toHaveBeenNthCalledWith(
        2,
        { full_name: "Ravee Kumar", phone: "9048001332" },
        "id",
        "ravee-1",
      );
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("restores only what it changed", async () => {
      adminClient.auth.admin.updateUserById.mockResolvedValue({ error: { message: "nope" } });
      await updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" }));
      expect(profileWrite).toHaveBeenNthCalledWith(2, { full_name: "Ravee Kumar" }, "id", "ravee-1");
    });

    it("says so when the profile could not be put back either", async () => {
      adminClient.auth.admin.updateUserById.mockResolvedValue({
        error: { message: "Database error updating user" },
      });
      profileWrite
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: { message: "connection lost" } });
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" })),
      ).resolves.toEqual({
        ok: false,
        error:
          "Could not update the account: Database error updating user. The new name or phone could not be undone — check Ravee Kumar's details.",
      });
    });

    it("rolls the profile back when Auth does not answer at all", async () => {
      adminClient.auth.admin.updateUserById.mockRejectedValue(new TypeError("fetch failed"));
      await expect(
        updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar" })),
      ).resolves.toEqual({
        ok: false,
        error: "The sign-in service did not respond. Nothing was saved.",
      });
      expect(profileWrite).toHaveBeenCalledTimes(2);
      expect(profileWrite).toHaveBeenLastCalledWith({ full_name: "Ravee Kumar" }, "id", "ravee-1");
    });

    it("does not touch the profile when only the sign-in was edited and Auth refuses", async () => {
      adminClient.auth.admin.updateUserById.mockResolvedValue({
        error: { message: "Password is known to be weak and easily guessable", code: "weak_password" },
      });
      await expect(
        updateTeamMember(null, edit("ravee-1", { password: NEW_PASSWORD })),
      ).resolves.toEqual({
        ok: false,
        error:
          "Could not update the account: Password is known to be weak and easily guessable. Nothing was saved.",
      });
      expect(profileWrite).not.toHaveBeenCalled();
    });

    it.each([
      ["same_password", "That is already their password — leave the field blank to keep it."],
      ["user_not_found", "That team member no longer exists."],
    ])("explains Auth's %s", async (code, message) => {
      adminClient.auth.admin.updateUserById.mockResolvedValue({ error: { message: "x", code } });
      await expect(
        updateTeamMember(null, edit("ravee-1", { password: NEW_PASSWORD })),
      ).resolves.toEqual({ ok: false, error: `${message} Nothing was saved.` });
    });
  });

  describe("the password", () => {
    let consoles: ReturnType<typeof vi.spyOn>[];

    beforeEach(() => {
      consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function expectNeverSeen(value: unknown) {
      expect(JSON.stringify(value)).not.toContain(NEW_PASSWORD);
      for (const spy of consoles) expect(spy).not.toHaveBeenCalled();
    }

    it("is not in the answer, and nothing is logged, when the edit succeeds", async () => {
      const result = await updateTeamMember(null, edit("ravee-1", { password: NEW_PASSWORD }));
      expect(result).toEqual({ ok: true, data: { message: "Saved." } });
      expectNeverSeen(result);
      // It reached Auth, and only Auth.
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(
        "ravee-1",
        expect.objectContaining({ password: NEW_PASSWORD }),
      );
      expect(JSON.stringify(profileWrite.mock.calls)).not.toContain(NEW_PASSWORD);
    });

    it("is not in the answer when it is refused as too short", async () => {
      const result = await updateTeamMember(null, edit("ravee-1", { password: "short-pw" }));
      expect(JSON.stringify(result)).not.toContain("short-pw");
    });

    it("is blotted out of an Auth error that echoes it, and nothing is logged", async () => {
      adminClient.auth.admin.updateUserById.mockResolvedValue({
        error: { message: `Password "${NEW_PASSWORD}" is not allowed` },
      });
      const result = await updateTeamMember(null, edit("ravee-1", { password: NEW_PASSWORD }));
      expect(result).toEqual({
        ok: false,
        error: 'Could not update the account: Password "•••" is not allowed. Nothing was saved.',
      });
      expectNeverSeen(result);
    });

    it("is not in the answer when an admin is refused", async () => {
      profiles.byId.mockResolvedValue(MEERA);
      const result = await updateTeamMember(null, edit("admin-2", { password: NEW_PASSWORD }));
      expect(result).toMatchObject({ ok: false });
      expectNeverSeen(result);
    });

    it("keeps the current one when the field is blank", async () => {
      await updateTeamMember(null, edit("ravee-1", { full_name: "Ravi Kumar", password: "" }));
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith("ravee-1", {
        user_metadata: { full_name: "Ravi Kumar" },
      });
    });
  });
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
