import { describe, it, expect } from "vitest";
import { formatKw, isValidCapacity, parseCapacityKw } from "./capacity";

/**
 * `parseCapacityKw` must agree with the SQL `parse_capacity_kw()` behind the
 * generated column `work_orders.plant_capacity_kw` (migration
 * 20261010120100). The expected values below are what Postgres returns for the
 * same label, so a mismatch here is a UI/DB drift in the KSEB fee.
 */
describe("parseCapacityKw — label shapes", () => {
  it.each([
    ["3kW", 3],
    ["3 kW", 3],
    ["3KW", 3],
    ["5 kWp", 5],
    ["5kwp", 5],
    ["10 k", 10],
    ["3", 3],
    ["3.5", 3.5],
    ["3.5 kW", 3.5],
    ["  4 kW  ", 4],
  ])("reads %j as %d kW", (label, kw) => {
    expect(parseCapacityKw(label)).toBe(kw);
  });

  it.each([
    ["3000 W", 3],
    ["3000W", 3],
    ["3000 Wp", 3],
    ["1500wp", 1.5],
    ["500 W", 0.5],
    ["3000 Watts", 3],
  ])("treats a watt unit as watts: %j → %d kW", (label, kw) => {
    expect(parseCapacityKw(label)).toBe(kw);
  });

  it("ignores thousands separators", () => {
    expect(parseCapacityKw("3,000 W")).toBe(3);
    expect(parseCapacityKw("1,500Wp")).toBe(1.5);
    expect(parseCapacityKw("1,000 kW")).toBe(1000);
  });

  it("finds the first number after leading text", () => {
    expect(parseCapacityKw("On-grid 3kW")).toBe(3);
    expect(parseCapacityKw("approx. 5 kWp rooftop")).toBe(5);
  });

  it("uses only the FIRST number when there are several", () => {
    expect(parseCapacityKw("3kW + 2kW")).toBe(3);
    expect(parseCapacityKw("10 x 540Wp")).toBe(10);
    expect(parseCapacityKw("3kW 2026")).toBe(3);
  });

  it("does not read a minus sign — '-3kW' is 3 kW, as in SQL", () => {
    expect(parseCapacityKw("-3kW")).toBe(3);
  });

  it("takes the first decimal only from a malformed version-like label", () => {
    expect(parseCapacityKw("3.5.2kW")).toBe(3.5);
    // A dangling point is not part of the number.
    expect(parseCapacityKw("3. kW")).toBe(3);
  });

  it.each([[null], [undefined], [""], ["   "], ["abc"], ["kW"], ["W"], ["—"]])(
    "is null when there is no number: %j",
    (label) => {
      expect(parseCapacityKw(label)).toBeNull();
    },
  );

  it("returns zero (not null) for an explicit zero", () => {
    expect(parseCapacityKw("0 kW")).toBe(0);
  });
});

describe("parseCapacityKw — rounding parity with Postgres round(numeric, 2)", () => {
  it.each([
    ["1.005", 1.01],
    ["1.004", 1],
    ["2.675", 2.68],
    ["8.125", 8.13],
    ["1.255", 1.26],
    ["3.333", 3.33],
    ["0.005", 0.01],
    ["1005 W", 1.01],
    ["2675 W", 2.68],
    ["3815 Wp", 3.82], // 7 × 545 Wp panels
    ["4905 Wp", 4.91], // 9 × 545 Wp panels
    ["5995 Wp", 6],
    ["1 W", 0], // 0.001 kW rounds to zero, as round(0.001, 2) does
  ])("rounds %j half away from zero to %d", (label, kw) => {
    expect(parseCapacityKw(label)).toBe(kw);
  });

  // the `+ Number.EPSILON` nudge only rescues half-way values
  // below 2 kW. From 2 kW up the nudge is smaller than half an ULP, so binary
  // representation error wins and the value rounds DOWN, while Postgres
  // round(numeric, 2) rounds the exact decimal UP. 557 labels between 0 and
  // 100 kW disagree with the generated column, e.g. "8325 W" (15 × 555 Wp:
  // JS 8.32, SQL 8.33), "2135 W" (2.13 vs 2.14), "4.475 kW" (4.47 vs 4.48).
  // Fix: round the decimal representation instead of the binary one, e.g.
  //   Math.round(Number(`${kw.toFixed(6)}e2`)) / 100
  // (verified to match SQL for every 3-decimal label from 0.001 to 2000 kW).
  it.each([
    ["8325 W", 8.33], // 15 × 555 Wp — a real array size
    ["2135 W", 2.14],
    ["2.135 kW", 2.14],
    ["4015 Wp", 4.02],
    ["4.475 kW", 4.48],
    ["4975 W", 4.98],
  ])("rounds %j to %d like SQL above 2 kW", (label, kw) => {
    expect(parseCapacityKw(label)).toBe(kw);
  });
});

describe("isValidCapacity", () => {
  it("accepts a positive capacity", () => {
    expect(isValidCapacity("3kW")).toBe(true);
    expect(isValidCapacity("500 W")).toBe(true);
  });

  it("rejects zero, missing and number-less labels", () => {
    expect(isValidCapacity("0 kW")).toBe(false);
    expect(isValidCapacity("1 W")).toBe(false); // rounds to 0.00 kW
    expect(isValidCapacity("")).toBe(false);
    expect(isValidCapacity(null)).toBe(false);
    expect(isValidCapacity(undefined)).toBe(false);
    expect(isValidCapacity("abc")).toBe(false);
  });
});

describe("formatKw", () => {
  it("trims trailing zeros", () => {
    expect(formatKw(3)).toBe("3 kW");
    expect(formatKw(3.5)).toBe("3.5 kW");
    expect(formatKw(3.25)).toBe("3.25 kW");
  });

  it("accepts PostgREST numeric strings", () => {
    expect(formatKw("3.00")).toBe("3 kW");
    expect(formatKw("10.50")).toBe("10.5 kW");
  });

  it("shows at most two decimals", () => {
    expect(formatKw(3.14159)).toBe("3.14 kW");
  });

  it("formats zero as a capacity, not as missing", () => {
    expect(formatKw(0)).toBe("0 kW");
    expect(formatKw("0")).toBe("0 kW");
  });

  it.each([[null], [undefined], ["abc"], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "renders a dash for %j",
    (value) => {
      expect(formatKw(value)).toBe("—");
    },
  );
});
