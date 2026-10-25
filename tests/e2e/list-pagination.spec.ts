import { test, expect } from "@playwright/test";
import { ACCOUNTS, signIn } from "./support/accounts";

test("admin can search the work orders list server-side", async ({ page }) => {
  await signIn(page, ACCOUNTS.admin);

  await page.goto("/work-orders");

  // Debounced search pushes ?q= to the URL and the server returns the match
  // (robust to how many rows exist / which page it would otherwise be on).
  await page.getByLabel("Search").fill("Meera");
  await expect(page).toHaveURL(/q=Meera/);
  await expect(page.getByText("Meera Nair")).toBeVisible();
  await expect(page.getByText("Anand Kumar")).toHaveCount(0);
});

test("the project list keeps its filter and sort in the URL while it is searched", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.admin);

  await page.goto("/projects?view=list&status=active&sort=incentive_total&dir=desc");
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toContainText(
    /^active$/i,
  );
  await expect(page.getByText(/^showing \d+–\d+ of \d+ projects$/i)).toBeVisible();

  // Searching keeps the filter and the sort the list was opened with.
  await page.getByLabel("Search").fill("Anand");
  await expect(page).toHaveURL(/q=Anand/);
  await expect(page).toHaveURL(/status=active/);
  await expect(page).toHaveURL(/sort=incentive_total/);
  await expect(page.getByRole("row").filter({ hasText: "Anand Kumar" })).toBeVisible();
});

test("the dashboard's recent tables do not pass off a capped slice as the total", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.admin);

  await page.getByRole("tab", { name: /recent projects/i }).click();
  // "of 25 projects" would contradict the KPI tiles whenever there are more.
  await expect(page.getByText(/^showing \d+–\d+ of \d+ latest projects$/i)).toBeVisible();
  // The way to the whole list names the real count.
  await expect(page.getByRole("link", { name: /^view all \d+ projects$/i })).toBeVisible();
});
