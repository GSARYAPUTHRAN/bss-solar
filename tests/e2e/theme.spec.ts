import { test, expect } from "@playwright/test";

test("theme toggle switches to dark and persists across reloads", async ({
  page,
}) => {
  await page.goto("/login");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole("button", { name: /toggle.*theme/i }).click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(html).toHaveClass(/dark/); // persisted via localStorage
});
