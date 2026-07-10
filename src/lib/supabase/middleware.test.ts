import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { NextRequest } from "next/server";
import { updateSession } from "./middleware";
import { createServerClient } from "@supabase/ssr";

const mocked = vi.mocked(createServerClient);

function withUser(user: { id: string } | null) {
  mocked.mockReturnValue({
    auth: { getUser: async () => ({ data: { user } }) },
  } as never);
}

function req(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

beforeEach(() => vi.clearAllMocks());

describe("updateSession (route protection)", () => {
  it("redirects an unauthenticated user to /login", async () => {
    withUser(null);
    const res = await updateSession(req("/work-orders"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets an unauthenticated user reach /login", async () => {
    withUser(null);
    const res = await updateSession(req("/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an authenticated user away from /login", async () => {
    withUser({ id: "u1" });
    const res = await updateSession(req("/login"));
    expect(res.status).toBe(307);
  });

  it("redirects /signup to /login", async () => {
    withUser({ id: "u1" });
    const res = await updateSession(req("/signup"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets an authenticated user through to a protected route", async () => {
    withUser({ id: "u1" });
    const res = await updateSession(req("/work-orders"));
    expect(res.headers.get("location")).toBeNull();
  });
});
