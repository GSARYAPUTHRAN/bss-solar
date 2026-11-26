import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * The page itself never scrolls sideways on this screen. A table that scrolls
 * inside its own card is fine (and is not measured here): only the document
 * being wider than the viewport makes a phone user pan the whole page.
 */
export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * The control is at least `min` px tall and wide to a finger. Measured from
 * layout (offsetWidth / offsetHeight), not the on-screen box, so a dialog still
 * zooming in (95% → 100%) cannot shave it. A hit area widened by an absolutely
 * placed ::after (a 16px checkbox with `after:-inset-3`) takes the taps too, so
 * its overhang on each side is added on.
 */
export async function expectTapTarget(control: Locator, min = 40) {
  const size = await control.evaluate((el) => {
    const box = el as HTMLElement;
    const after = getComputedStyle(box, "::after");
    const pseudo =
      after.position === "absolute" && after.content !== "none" && after.content !== "normal";
    // A negative inset is how far the hit area reaches past the box on that side.
    const out = (value: string) => (pseudo ? Math.max(0, -(parseFloat(value) || 0)) : 0);
    return {
      width: box.offsetWidth + out(after.left) + out(after.right),
      height: box.offsetHeight + out(after.top) + out(after.bottom),
    };
  });
  expect(size.height, "tap target height").toBeGreaterThanOrEqual(min);
  expect(size.width, "tap target width").toBeGreaterThanOrEqual(min);
}
