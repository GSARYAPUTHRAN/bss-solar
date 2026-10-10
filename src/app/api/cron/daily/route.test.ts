import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/server/cron/feasibility", () => ({
  runFeasibilityAlerts: vi.fn(),
  loadActiveFeasibilityProjects: vi.fn(),
  cronDeliverer: vi.fn(() => vi.fn()),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";
import { runFeasibilityAlerts } from "@/server/cron/feasibility";

const run = vi.mocked(runFeasibilityAlerts);
const SECRET = "cron-test-secret";

function call(authorization?: string) {
  const headers = authorization ? { authorization } : undefined;
  return GET(new NextRequest("http://localhost/api/cron/daily", { headers }));
}

const REPORT = {
  date: "2026-10-10",
  projectsScanned: 3,
  events: 2,
  delivered: 2,
  failed: 0,
  inserted: 4,
  pushed: 2,
  failedPushes: 0,
  prunedSubscriptions: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/daily", () => {
  it("refuses everything when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer token", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the feasibility alerts and returns the report", async () => {
    run.mockResolvedValue(REPORT);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, feasibility: REPORT });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    );
  });

  it("returns 500 without leaking internals when the job fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    run.mockRejectedValue(new Error("SUPABASE_SERVICE_ROLE_KEY is required"));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("SERVICE_ROLE");
    error.mockRestore();
  });
});
