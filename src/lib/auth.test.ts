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

import { getProfile, requireProfile, requireRole, requireAdmin } from "./auth";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "./types";

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
});

describe("requireProfile", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabase({ user: null }));
    await expect(requireProfile()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("requireRole", () => {
  it("passes through when the role is allowed", async () => {
    mockedCreateClient.mockResolvedValue(
      fakeSupabase({
        user: { id: "a1" },
        profile: { id: "a1", role: "admin", full_name: "Admin" },
      }),
    );
    const profile = await requireRole("admin");
    expect(profile.role).toBe("admin");
  });

  it("redirects a coordinator away from an admin-only route", async () => {
    mockedCreateClient.mockResolvedValue(
      fakeSupabase({
        user: { id: "c1" },
        profile: { id: "c1", role: "coordinator", full_name: "Coord" },
      }),
    );
    // homeForRole('coordinator') === '/work-orders'
    await expect(requireRole("admin")).rejects.toThrow("REDIRECT:/work-orders");
  });
});

describe("requireAdmin", () => {
  it("redirects a non-admin", async () => {
    mockedCreateClient.mockResolvedValue(
      fakeSupabase({
        user: { id: "c1" },
        profile: { id: "c1", role: "coordinator", full_name: "Coord" },
      }),
    );
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/work-orders");
  });

  it("returns the profile for an admin", async () => {
    mockedCreateClient.mockResolvedValue(
      fakeSupabase({
        user: { id: "a1" },
        profile: { id: "a1", role: "admin", full_name: "Admin" },
      }),
    );
    const profile = await requireAdmin();
    expect(profile.role).toBe("admin");
  });
});
