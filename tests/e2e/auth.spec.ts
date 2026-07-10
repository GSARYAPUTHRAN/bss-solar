import { test, expect } from "@playwright/test";

const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };
const COORD = { email: "coord@bsssolar.test", password: "Coord@12345" };

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test("unauthenticated visit redirects to login", async ({ page }) => {
  await page.goto("/work-orders");
  await expect(page).toHaveURL(/\/login/);
});

test("admin signs in and lands on the dashboard", async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/$|\/\?/);
  await expect(page.getByText(/welcome/i)).toBeVisible();
});

test("coordinator signs in and lands on work orders", async ({ page }) => {
  await signIn(page, COORD.email, COORD.password);
  await expect(page).toHaveURL(/\/work-orders/);
});

test("invalid credentials show an error and stay on login", async ({ page }) => {
  await signIn(page, COORD.email, "wrong-password");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/invalid|credential/i)).toBeVisible();
});
