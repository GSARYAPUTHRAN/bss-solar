import { beforeEach, describe, expect, it, vi } from "vitest";

// redirect() throws in Next; emulate that so the target can be asserted.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));

const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithPassword,
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { role: "admin" } }) }),
      }),
    }),
  })),
}));

import { __resetRateLimiter } from "@/lib/rate-limit";
import { LOGIN_RATE_LIMIT } from "@/lib/constants";
import { login } from "./actions";

function credentials(password = "wrong"): FormData {
  const fd = new FormData();
  fd.set("email", "office@bss.example");
  fd.set("password", password);
  return fd;
}

/** GoTrue answering after a network round trip. */
function slowSignIn(result: { error: { message: string } | null }) {
  return () => new Promise((resolve) => setTimeout(() => resolve(result), 20));
}

const WRONG = { error: { message: "Invalid login credentials" } };

beforeEach(() => {
  __resetRateLimiter();
  signInWithPassword.mockReset();
});

describe("login throttle", () => {
  it("lets at most the limit of a parallel burst reach GoTrue", async () => {
    signInWithPassword.mockImplementation(slowSignIn(WRONG));

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => login(credentials())),
    );

    expect(signInWithPassword).toHaveBeenCalledTimes(LOGIN_RATE_LIMIT.max);
    const throttled = outcomes.filter(
      (o) => o.status === "rejected" && String(o.reason).includes("Too%20many"),
    );
    expect(throttled).toHaveLength(10 - LOGIN_RATE_LIMIT.max);
  });

  it("counts a failure once — the limit is reached after exactly max failures", async () => {
    signInWithPassword.mockResolvedValue(WRONG);
    for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
      await expect(login(credentials())).rejects.toThrow(
        "REDIRECT:/login?error=Invalid%20login%20credentials",
      );
    }
    await expect(login(credentials())).rejects.toThrow(/Too%20many%20failed/);
    expect(signInWithPassword).toHaveBeenCalledTimes(LOGIN_RATE_LIMIT.max);
  });

  it("a successful sign-in clears earlier failures", async () => {
    signInWithPassword.mockResolvedValue(WRONG);
    for (let i = 0; i < LOGIN_RATE_LIMIT.max - 1; i++) {
      await expect(login(credentials())).rejects.toThrow(/Invalid/);
    }

    signInWithPassword.mockResolvedValueOnce({ error: null });
    await expect(login(credentials("right"))).rejects.toThrow(/^REDIRECT:\/$/);

    // The slate is clean: the full allowance of failures is available again.
    for (let i = 0; i < LOGIN_RATE_LIMIT.max; i++) {
      await expect(login(credentials())).rejects.toThrow(/Invalid/);
    }
    await expect(login(credentials())).rejects.toThrow(/Too%20many/);
  });
});
