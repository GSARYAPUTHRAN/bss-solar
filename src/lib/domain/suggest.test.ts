import { describe, it, expect } from "vitest";
import { closestMatch, editDistance } from "./suggest";

describe("editDistance", () => {
  it.each([
    ["", "", 0],
    ["abc", "", 3],
    ["", "abc", 3],
    ["kitten", "sitting", 3],
    ["client_name", "client nme", 2],
    ["same", "same", 0],
  ])("%s → %s = %i", (a, b, d) => {
    expect(editDistance(a, b)).toBe(d);
    expect(editDistance(b, a)).toBe(d);
  });
});

describe("closestMatch", () => {
  const columns = ["client_name", "client_phone", "total_cost", "notes"];

  it("suggests the nearest candidate for a typo", () => {
    expect(closestMatch("client nme", columns)).toBe("client_name");
    expect(closestMatch("Total Cost", columns)).toBe("total_cost");
  });

  it("returns null when nothing is close", () => {
    expect(closestMatch("phone", columns)).toBeNull();
    expect(closestMatch("subsidy_amount", columns)).toBeNull();
  });

  it("returns null for blank input or no candidates", () => {
    expect(closestMatch("  ", columns)).toBeNull();
    expect(closestMatch("notes", [])).toBeNull();
  });
});
