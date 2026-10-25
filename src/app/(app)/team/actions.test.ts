import { beforeEach, describe, expect, it, vi } from "vitest";
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
  auth: { admin: { deleteUser: vi.fn(), createUser: vi.fn() } },
  from: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));
vi.mock("@/server/data/profiles.repository", () => ({
  profilesRepository: {
    byId: vi.fn(),
    adminCount: vi.fn(),
    ownedWorkCount: vi.fn(),
    setRole: vi.fn(),
  },
}));

import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { profilesRepository } from "@/server/data";
import { deleteTeamMember, updateUserRole } from "./actions";

const profiles = vi.mocked(profilesRepository);

const ADMIN = { id: "admin-1", role: "admin", full_name: "BSS Admin" } as Profile;
const SUPERADMIN = { id: "super-1", role: "superadmin", full_name: "Boss" } as Profile;
/** Priya never logged a work order — she only joined Rahul's sale. */
const PRIYA = { id: "priya-1", role: "coordinator", full_name: "Priya Suresh" } as Profile;

const NOTHING = { workOrders: 0, projects: 0, activeTickets: 0 };
const SHARES_ONE_SALE = { workOrders: 1, projects: 1, activeTickets: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  vi.mocked(requireSuperAdmin).mockResolvedValue(SUPERADMIN);
  profiles.byId.mockResolvedValue(PRIYA);
  profiles.adminCount.mockResolvedValue(2);
  profiles.ownedWorkCount.mockResolvedValue(NOTHING);
  profiles.setRole.mockResolvedValue({ error: null });
  adminClient.auth.admin.deleteUser.mockResolvedValue({ error: null });
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

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
