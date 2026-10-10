import { expect, type Locator, type Page } from "@playwright/test";

type FlashType = "success" | "error";

/** The flash toast(s) of the given type whose text matches `message`. */
export function flashToast(
  page: Page,
  message: string | RegExp,
  type: FlashType = "success",
): Locator {
  return page
    .locator(`[data-sonner-toast][data-type="${type}"]`)
    .filter({ hasText: message });
}

/**
 * Assert that a server action finished with the given flash toast.
 *
 * Actions redirect to `…?flash=<message>`, but FlashToast strips those params
 * the moment it shows the toast, so the flash URL is transient and asserting on
 * it races the client. The toast is the durable signal; its type also rules out
 * a bounce back with an error.
 *
 * When the same action runs twice in a row, wait for the first toast to go
 * (`expect(flashToast(...)).toHaveCount(0)`) before acting again, or this could
 * pass on the stale one.
 */
export async function expectFlash(
  page: Page,
  message: string | RegExp,
  type: FlashType = "success",
): Promise<void> {
  await expect(flashToast(page, message, type).last()).toBeVisible();
}
