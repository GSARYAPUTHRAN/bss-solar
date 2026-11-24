import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/format";
import { formatFigure, growthTone } from "./report-format";

describe("formatFigure", () => {
  it("prints money in rupees, capacity in kW and counts plainly", () => {
    expect(formatFigure(125000.5, "money")).toBe(formatCurrency(125000.5));
    expect(formatFigure(12.5, "kw")).toBe("12.5 kW");
    expect(formatFigure(1234, "count")).toBe("1,234");
  });
});

describe("growthTone", () => {
  it("is good news when a figure that should rise rises", () => {
    expect(growthTone({ kind: "change", pct: 10 }, "up")).toBe("good");
    expect(growthTone({ kind: "new" }, "up")).toBe("good");
    expect(growthTone({ kind: "change", pct: -10 }, "up")).toBe("bad");
  });

  it("flips for figures that should fall (cancellations)", () => {
    expect(growthTone({ kind: "change", pct: 10 }, "down")).toBe("bad");
    expect(growthTone({ kind: "new" }, "down")).toBe("bad");
    expect(growthTone({ kind: "change", pct: -10 }, "down")).toBe("good");
  });

  it("is flat for no change, nothing to compare, or a neutral figure", () => {
    expect(growthTone({ kind: "change", pct: 0 }, "up")).toBe("flat");
    expect(growthTone(null, "up")).toBe("flat");
    expect(growthTone({ kind: "change", pct: 50 }, "neutral")).toBe("flat");
  });
});
