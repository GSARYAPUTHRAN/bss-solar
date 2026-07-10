import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  todayISO,
} from "./format";

describe("todayISO", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts an explicit time zone", () => {
    expect(todayISO("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatCurrency", () => {
  it("uses Indian digit grouping", () => {
    expect(formatCurrency(100000)).toMatch(/1,00,000/);
    expect(formatCurrency(195000)).toMatch(/1,95,000/);
  });

  it("treats null/undefined as zero", () => {
    expect(formatCurrency(null)).toBe(formatCurrency(0));
    expect(formatCurrency(undefined)).toBe(formatCurrency(0));
  });

  it("includes a rupee indicator", () => {
    expect(formatCurrency(50)).toMatch(/₹|INR/);
  });
});

describe("formatDate", () => {
  it("returns a dash for missing/invalid input", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate("")).toBe("-");
    expect(formatDate("not-a-date")).toBe("-");
  });

  it("formats a valid ISO date", () => {
    const out = formatDate("2026-07-09T12:00:00Z");
    expect(out).not.toBe("-");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Jul/);
  });
});

describe("formatDateTime", () => {
  it("returns a dash for missing/invalid input", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime("garbage")).toBe("-");
  });

  it("includes a time component for valid input", () => {
    const out = formatDateTime("2026-07-09T12:30:00Z");
    expect(out).not.toBe("-");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/:|\d{2}\s?(am|pm|AM|PM)/);
  });
});
