import { test, expect } from "@playwright/test";

test("admin can search the work orders list server-side", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@bsssolar.test");
  await page.getByLabel("Password").fill("Admin@12345");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);

  await page.goto("/work-orders");
  await expect(page.getByText("Meera Nair")).toBeVisible();

  // Debounced search pushes ?q= to the URL and the server returns the match.
  await page.getByLabel("Search").fill("Meera");
  await expect(page).toHaveURL(/q=Meera/);
  await expect(page.getByText("Meera Nair")).toBeVisible();
  await expect(page.getByText("Anand Kumar")).toHaveCount(0);
});
