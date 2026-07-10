import { describe, it, expect } from "vitest";
import { ticketTotal } from "./ticket";

describe("ticketTotal", () => {
  it("sums the three billed components", () => {
    expect(
      ticketTotal({ serviceCharge: 1500, costOfSpares: 350, amcCharge: 500 }),
    ).toBe(2350);
  });

  it("is zero when nothing is billed", () => {
    expect(
      ticketTotal({ serviceCharge: 0, costOfSpares: 0, amcCharge: 0 }),
    ).toBe(0);
  });
});
