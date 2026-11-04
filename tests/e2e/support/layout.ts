import { expect, type Locator } from "@playwright/test";

/**
 * Nothing inside the section's card is wider than its own box. The section
 * itself is no evidence: its card clips (overflow-hidden), so whatever sticks out
 * is cut off without ever widening the section or the page — measure the card
 * and everything in it. (Text meant to be cut with an ellipsis would count too:
 * the sections measured this way wrap their text instead.)
 */
export async function expectNothingClipped(section: Locator) {
  const { measured, clipped } = await section.evaluate((el) => {
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-slot="card"], [data-slot="card"] *')];
    return {
      measured: nodes.length,
      clipped: nodes.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.tagName),
    };
  });
  expect(measured).toBeGreaterThan(0);
  expect(clipped).toEqual([]);
}
