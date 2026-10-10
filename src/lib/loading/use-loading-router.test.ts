import { describe, expect, it } from "vitest";
import { isSameLocation } from "./use-loading-router";

const here = new URL("https://app.bss-solar.com/projects?view=list") as unknown as Location;

describe("isSameLocation", () => {
  it("matches the page already showing (relative or absolute, hash ignored)", () => {
    expect(isSameLocation("/projects?view=list", here)).toBe(true);
    expect(isSameLocation("https://app.bss-solar.com/projects?view=list", here)).toBe(true);
    expect(isSameLocation("/projects?view=list#payments", here)).toBe(true);
  });

  it("does not match a different path, query or origin", () => {
    expect(isSameLocation("/projects", here)).toBe(false);
    expect(isSameLocation("/projects?view=board", here)).toBe(false);
    expect(isSameLocation("/work-orders", here)).toBe(false);
    expect(isSameLocation("https://evil.example/projects?view=list", here)).toBe(false);
  });
});
