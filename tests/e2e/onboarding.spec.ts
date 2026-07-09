import { test, expect } from "@playwright/test";

test("admin can bulk import an existing project", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@bsssolar.test");
  await page.getByLabel("Password").fill("Admin@12345");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);

  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: /import existing projects/i }),
  ).toBeVisible();

  const client = `E2E Import ${Date.now()}`;
  const csv = [
    "client_name,plant_capacity,total_cost,current_stage,is_completed",
    `${client},5kW,300000,material_dispatch,false`,
    // A deliberately invalid row to prove per-row error reporting.
    "No Capacity Co,,100000,site_feasibility_survey,false",
  ].join("\n");

  await page.getByLabel("CSV data").fill(csv);
  await page.getByRole("button", { name: /import projects/i }).click();

  await expect(page.getByText(/1 imported/i)).toBeVisible();
  await expect(page.getByText(/1 failed/i)).toBeVisible();
  await expect(page.getByText(client).first()).toBeVisible();

  // The imported project shows up in the project list.
  await page.goto(`/projects?view=list&q=${encodeURIComponent(client)}`);
  await expect(page.getByText(client).first()).toBeVisible();
});
