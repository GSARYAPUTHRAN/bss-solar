import { describe, it, expect, vi, beforeEach } from "vitest";

// redirect() throws in Next; emulate that so we can assert the target.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import {
  getProfile,
  requireProfile,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireTicketRole,
  requireWorkOrderRole,
} from "./auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "./types";

const mockedCreateClient = vi.mocked(createClient);

function fakeSupabase(opts: {
  user: { id: string } | null;
  profile?: { id: string; role: UserRole; full_name: string } | null;
}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: opts.user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: opts.profile ?? null }),
        }),
      }),
    }),
  } as never;
}

function signInAs(role: UserRole) {
  const id = `${role}-1`;
  mockedCreateClient.mockResolvedValue(
    fakeSupabase({ user: { id }, profile: { id, role, full_name: role } }),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("getProfile", () => {
  it("returns null when there is no authenticated user", async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabase({ user: null }));
    expect(await getProfile()).toBeNull();
  });

  it("returns the profile for an authenticated user", async () => {
    mockedCreateClient.mockResolvedValue(
      fakeSupabase({
        user: { id: "u1" },
        profile: { id: "u1", role: "coordinator", full_name: "Rahul" },
      }),
    );
    const profile = await getProfile();
    expect(profile?.id).toBe("u1");
    expect(profile?.role).toBe("coordinator");
  });

  it("returns null for a signed-in user without a profile row", async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabase({ user: { id: "ghost" }, profile: null }));
    expect(await getProfile()).toBeNull();
  });
});

describe("requireProfile", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabase({ user: null }));
    await expect(requireProfile()).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /login when the profile row is missing", async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabase({ user: { id: "ghost" }, profile: null }));
    await expect(requireProfile()).rejects.toThrow("REDIRECT:/login");
  });

  it("admits a service engineer (signed in is enough)", async () => {
    signInAs("service_engineer");
    expect((await requireProfile()).role).toBe("service_engineer");
  });
});

describe("requireRole", () => {
  it("passes through when the role is allowed", async () => {
    signInAs("admin");
    const profile = await requireRole("admin");
    expect(profile.role).toBe("admin");
  });

  it("redirects a coordinator away from an admin-only route", async () => {
    signInAs("coordinator");
    // homeForRole('coordinator') === '/work-orders'
    await expect(requireRole("admin")).rejects.toThrow("REDIRECT:/work-orders");
  });

  it("redirects a service engineer to their tickets", async () => {
    signInAs("service_engineer");
    await expect(requireRole("coordinator")).rejects.toThrow("REDIRECT:/tickets");
  });

  it("redirects unauthenticated callers to /login before checking roles", async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabase({ user: null }));
    await expect(requireRole("admin")).rejects.toThrow("REDIRECT:/login");
  });

  it("admits nobody when given no roles", async () => {
    signInAs("superadmin");
    await expect(requireRole()).rejects.toThrow("REDIRECT:/");
  });
});

type Guard = () => Promise<Profile>;

/**
 * Every guard × every role. `null` = admitted; otherwise the redirect target,
 * which is always the caller's own home (homeForRole) — never a page that
 * would bounce them again.
 */
const MATRIX: [string, Guard, Record<UserRole, string | null>][] = [
  [
    "requireAdmin",
    requireAdmin,
    { admin: null, superadmin: null, coordinator: "/work-orders", service_engineer: "/tickets" },
  ],
  [
    "requireSuperAdmin",
    requireSuperAdmin,
    { admin: "/", superadmin: null, coordinator: "/work-orders", service_engineer: "/tickets" },
  ],
  [
    "requireWorkOrderRole",
    requireWorkOrderRole,
    { admin: null, superadmin: null, coordinator: null, service_engineer: "/tickets" },
  ],
  [
    "requireTicketRole",
    requireTicketRole,
    { admin: null, superadmin: null, coordinator: "/work-orders", service_engineer: null },
  ],
];

describe.each(MATRIX)("%s", (_name, guard, expected) => {
  it.each(Object.entries(expected) as [UserRole, string | null][])(
    "%s → %s",
    async (role, target) => {
      signInAs(role);
      if (target === null) {
        const profile = await guard();
        expect(profile.role).toBe(role);
        expect(profile.id).toBe(`${role}-1`);
      } else {
        await expect(guard()).rejects.toThrow(`REDIRECT:${target}`);
      }
    },
  );

  it("sends an unauthenticated caller to /login", async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabase({ user: null }));
    await expect(guard()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("guard redirects never loop", () => {
  it("a role turned away by the pipeline guard is admitted where it lands", async () => {
    // Engineers bounced from /work-orders land on /tickets (requireTicketRole).
    signInAs("service_engineer");
    await expect(requireWorkOrderRole()).rejects.toThrow("REDIRECT:/tickets");
    await expect(requireTicketRole()).resolves.toMatchObject({ role: "service_engineer" });
  });

  it("a coordinator bounced from /tickets is admitted on /work-orders", async () => {
    signInAs("coordinator");
    await expect(requireTicketRole()).rejects.toThrow("REDIRECT:/work-orders");
    await expect(requireWorkOrderRole()).resolves.toMatchObject({ role: "coordinator" });
  });
});
