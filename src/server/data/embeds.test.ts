import { describe, expect, it } from "vitest";
import { oneToOne } from "./embeds";

describe("oneToOne", () => {
  const project = { id: "p-1" };

  it("reads the array form (older PostgREST)", () => {
    expect(oneToOne([project])).toBe(project);
    expect(oneToOne([])).toBeNull();
  });

  it("reads the object form (newer PostgREST, UNIQUE foreign key)", () => {
    expect(oneToOne(project)).toBe(project);
  });

  it("treats a missing embed as no row", () => {
    expect(oneToOne(null)).toBeNull();
    expect(oneToOne(undefined)).toBeNull();
  });
});
