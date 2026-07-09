import { test, expect } from "@playwright/test";

const COORD = { email: "coord@bsssolar.test", password: "Coord@12345" };

test("a coordinator can create a work order and see it listed", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(COORD.email);
  await page.getByLabel("Password").fill(COORD.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/work-orders/);

  await page.goto("/work-orders/new");

  const client = `E2E Client ${Date.now()}`;
  await page.getByLabel(/client name/i).fill(client);
  await page.getByLabel(/plant capacity/i).fill("5kW");
  await page.getByLabel(/total cost/i).fill("300000");
  await page.getByRole("button", { name: /create|save|submit/i }).click();

  await expect(page).toHaveURL(/\/work-orders/);
  await expect(page.getByText(client)).toBeVisible();
});
