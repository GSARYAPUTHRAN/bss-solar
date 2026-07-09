import { describe, it, expect } from "vitest";
import { str, text, int, dec, num, json, enumValue } from "./form";

describe("form parsers", () => {
  describe("str (nullable trimmed string)", () => {
    it("trims and returns the value", () => {
      expect(str("  hello  ")).toBe("hello");
    });
    it("returns null for empty / whitespace / null", () => {
      expect(str("")).toBeNull();
      expect(str("   ")).toBeNull();
      expect(str(null)).toBeNull();
    });
  });

  describe("text (required trimmed string)", () => {
    it("trims and returns the value", () => {
      expect(text("  hi ")).toBe("hi");
    });
    it("returns empty string (not null) when missing", () => {
      expect(text(null)).toBe("");
      expect(text("   ")).toBe("");
    });
  });

  describe("int", () => {
    it("parses integers", () => {
      expect(int("42")).toBe(42);
      expect(int(" 7 ")).toBe(7);
    });
    it("truncates decimals via parseInt", () => {
      expect(int("3.9")).toBe(3);
    });
    it("returns null for empty/invalid", () => {
      expect(int("")).toBeNull();
      expect(int("abc")).toBeNull();
      expect(int(null)).toBeNull();
    });
  });

  describe("dec", () => {
    it("parses decimals", () => {
      expect(dec("3.14")).toBe(3.14);
      expect(dec(" 10 ")).toBe(10);
    });
    it("returns null for empty/invalid", () => {
      expect(dec("")).toBeNull();
      expect(dec("not-a-number")).toBeNull();
      expect(dec(null)).toBeNull();
    });
    it("differs from int: does NOT truncate", () => {
      expect(dec("3.9")).toBe(3.9);
      expect(int("3.9")).toBe(3);
    });
  });

  describe("num (required number, 0 fallback)", () => {
    it("parses numbers", () => {
      expect(num("199000")).toBe(199000);
    });
    it("falls back to 0 on empty/invalid (documented coercion)", () => {
      expect(num("")).toBe(0);
      expect(num("abc")).toBe(0);
      expect(num(null)).toBe(0);
    });
  });

  describe("json", () => {
    it("parses valid JSON", () => {
      expect(json('[{"a":1}]', [])).toEqual([{ a: 1 }]);
    });
    it("returns fallback on invalid JSON", () => {
      expect(json("not json", [])).toEqual([]);
      expect(json(null, [{ x: 1 }])).toEqual([{ x: 1 }]);
    });
  });

  describe("enumValue", () => {
    it("returns the trimmed value", () => {
      expect(enumValue(" approved ", "pending")).toBe("approved");
    });
    it("returns the fallback when empty", () => {
      expect(enumValue("", "pending")).toBe("pending");
      expect(enumValue(null, "pending")).toBe("pending");
    });
  });
});
