import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { NextRequest } from "next/server";
import { isPublicPath, isSessionlessPath, updateSession } from "./middleware";
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

  it("keeps API routes other than cron behind sign-in", async () => {
    withUser(null);
    for (const path of ["/api/other", "/api/cronjob", "/notifications"]) {
      const res = await updateSession(req(path));
      expect(res.headers.get("location")).toContain("/login");
    }
  });

  it.each(["/api/cron/daily", "/sw.js", "/manifest.webmanifest", "/icons/icon-192.png"])(
    "serves %s without a session and without an auth round-trip",
    async (path) => {
      withUser(null);
      const res = await updateSession(req(path));
      expect(res.headers.get("location")).toBeNull();
      expect(mocked).not.toHaveBeenCalled();
    },
  );
});

describe("public path rules", () => {
  it("matches whole path segments, not string prefixes", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/icons/badge-72.png")).toBe(true);
    expect(isPublicPath("/icons-private")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/cron-admin")).toBe(false);
  });

  it("only treats exact PWA files as public", () => {
    expect(isSessionlessPath("/sw.js")).toBe(true);
    expect(isSessionlessPath("/sw.js.map")).toBe(false);
    expect(isSessionlessPath("/manifest.webmanifest")).toBe(true);
    expect(isSessionlessPath("/work-orders")).toBe(false);
    expect(isSessionlessPath("/login")).toBe(false);
  });
});
