import { test, expect } from "@playwright/test";
import { expectFlash } from "./support/flash";

const COORD = { email: "coord@bsssolar.test", password: "Coord@12345" };

test("a coordinator can edit their own work order, including the new fields", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(COORD.email);
  await page.getByLabel("Password").fill(COORD.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/work-orders/);

  // Create one to edit, so the test owns its data.
  const client = `E2E Edit ${Date.now()}`;
  await page.goto("/work-orders/new");
  await page.getByLabel(/client name/i).fill(client);
  await page.getByLabel(/plant capacity/i).fill("5kW");
  await page.getByLabel(/total cost/i).fill("300000");
  await page.getByLabel(/advance collected/i).fill("50000");
  await page.getByRole("button", { name: /create work order/i }).click();
  // The success toast also rules out a validation bounce back to the form.
  await expectFlash(page, "Work order created.");

  await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await page.getByRole("row").filter({ hasText: client }).click();
  await expect(page.getByRole("heading", { name: client })).toBeVisible();

  // Balance before any instalments: 300000 - 50000.
  await expect(page.getByText("₹2,50,000").first()).toBeVisible();

  await page.getByRole("link", { name: /^edit$/i }).click();
  await expect(page).toHaveURL(/\/work-orders\/.+\/edit/);

  const consumerNumber = `115${Date.now()}`.slice(0, 13);
  await page.getByLabel(/kseb consumer number/i).fill(consumerNumber);
  await page.getByLabel(/kseb section/i).fill("Vytilla");
  // The bank field only appears once the order is marked as loan-financed.
  await page.getByRole("combobox", { name: /financing/i }).click();
  await page.getByRole("option", { name: /bank loan/i }).click();
  await page.getByLabel(/loan bank name/i).fill("State Bank of India");
  await page.getByLabel(/^notes$/i).fill("Scaffolding needed for the north array");
  await page.getByRole("button", { name: /save changes/i }).click();

  // Back on the detail page with the new values. Instalments now live in the
  // project's payments ledger (payments-ledger.spec.ts), so editing the work
  // order leaves the balance at 300000 - 50000.
  await expectFlash(page, "Work order updated.");
  await expect(page.getByText(consumerNumber)).toBeVisible();
  await expect(page.getByText("Vytilla")).toBeVisible();
  await expect(page.getByText(/State Bank of India/).first()).toBeVisible();
  await expect(page.getByText(/bank loan|loan ·/i).first()).toBeVisible();
  await expect(
    page.getByText(/Scaffolding needed for the north array/),
  ).toBeVisible();
  await expect(page.getByText("₹2,50,000").first()).toBeVisible();

  // And the consumer number is searchable from the list.
  await page.goto(`/work-orders?q=${encodeURIComponent(consumerNumber)}`);
  await expect(page.getByText(client).first()).toBeVisible();
});
