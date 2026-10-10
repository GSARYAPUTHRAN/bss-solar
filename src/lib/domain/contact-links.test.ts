import { describe, it, expect } from "vitest";
import { mapsSearchHref, telHref } from "./contact-links";

describe("telHref", () => {
  it("strips the formatting people type, keeping the country code", () => {
    expect(telHref("+91 98470 20001")).toBe("tel:+919847020001");
    expect(telHref(" (0484) 236-1234 ")).toBe("tel:04842361234");
    expect(telHref("98470.20001")).toBe("tel:9847020001");
  });

  it("returns null when there is no dialable number", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("n/a")).toBeNull();
    expect(telHref("+1")).toBeNull();
  });
});

describe("mapsSearchHref", () => {
  it("builds an encoded Google Maps search, collapsing whitespace", () => {
    expect(mapsSearchHref("12/3, MG Road,\n  Kochi & Ernakulam")).toBe(
      "https://www.google.com/maps/search/?api=1&query=12%2F3%2C%20MG%20Road%2C%20Kochi%20%26%20Ernakulam",
    );
  });

  it("returns null for a blank address", () => {
    expect(mapsSearchHref(null)).toBeNull();
    expect(mapsSearchHref("   ")).toBeNull();
  });
});
