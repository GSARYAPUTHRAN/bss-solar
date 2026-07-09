import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, __resetRateLimiter } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimiter());

  it("allows up to the limit within the window", () => {
    expect(rateLimit("a", 3, 1000, 0).allowed).toBe(true);
    expect(rateLimit("a", 3, 1000, 0).allowed).toBe(true);
    expect(rateLimit("a", 3, 1000, 0).allowed).toBe(true);
  });

  it("blocks the request that exceeds the limit", () => {
    rateLimit("b", 2, 1000, 0);
    rateLimit("b", 2, 1000, 0);
    const blocked = rateLimit("b", 2, 1000, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    rateLimit("c", 1, 1000, 0);
    expect(rateLimit("c", 1, 1000, 500).allowed).toBe(false);
    expect(rateLimit("c", 1, 1000, 1000).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    rateLimit("x", 1, 1000, 0);
    expect(rateLimit("x", 1, 1000, 0).allowed).toBe(false);
    expect(rateLimit("y", 1, 1000, 0).allowed).toBe(true);
  });

  it("reports decreasing remaining allowance", () => {
    expect(rateLimit("r", 3, 1000, 0).remaining).toBe(2);
    expect(rateLimit("r", 3, 1000, 0).remaining).toBe(1);
    expect(rateLimit("r", 3, 1000, 0).remaining).toBe(0);
  });
});
