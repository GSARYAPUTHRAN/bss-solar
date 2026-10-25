import { test, expect } from "@playwright/test";
import { ACCOUNTS, signIn, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

test("a coordinator can create a work order and see it listed", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.rahul);
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

test("the office's coordinator filter finds a sale where that person is only a partner", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  const client = `E2E Filter ${Date.now()}`;

  // The office logs the sale for Rahul, with Priya as partner (and not itself).
  await admin.goto("/work-orders/new");
  await admin.getByLabel(/client name/i).fill(client);
  await admin.getByLabel(/plant capacity/i).fill("5kW");
  await admin.getByLabel(/total cost/i).fill("300000");
  const team = admin.getByRole("group", { name: "Coordinators" });
  await expect(team).toContainText("BSS Admin (me)");
  for (const person of ["Rahul Menon", "Priya Suresh"]) {
    await team.getByRole("button", { name: "Add coordinator" }).click();
    await admin
      .locator('[data-slot="popover-content"]')
      .getByRole("button", { name: new RegExp(person) })
      .click();
  }
  await team.getByRole("button", { name: "Remove BSS Admin" }).click();
  await admin.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(admin, /work order created and shared with Priya Suresh/i);

  await admin.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  const row = admin.getByRole("row").filter({ hasText: client });
  await expect(row).toContainText("Rahul Menon & Priya Suresh");

  // The first coordinator, and the partner, both find it.
  for (const person of ["Rahul Menon", "Priya Suresh"]) {
    await admin.getByRole("combobox", { name: "Coordinator" }).click();
    await admin.getByRole("option", { name: person }).click();
    await expect(admin).toHaveURL(/coordinator=/);
    await expect(row).toBeVisible();
  }

  // Someone who is not on it does not.
  await admin.getByRole("combobox", { name: "Coordinator" }).click();
  await admin.getByRole("option", { name: "Arun Krishnan" }).click();
  await expect(row).toHaveCount(0);
});

test("a coordinator can filter their sales by cancelled and refunded too", async ({ page }) => {
  await signIn(page, ACCOUNTS.rahul);
  await page.goto("/work-orders");
  await page.getByRole("combobox", { name: "Status" }).click();
  await expect(page.getByRole("option")).toHaveText([
    "All statuses",
    "Pending",
    "Approved (active)",
    "Rejected",
    "Cancelled",
    "Refunded",
  ]);
  await page.getByRole("option", { name: "Refunded" }).click();
  await expect(page).toHaveURL(/status=refunded/);
  // The coordinator filter stays the office's.
  await expect(page.getByRole("combobox", { name: "Coordinator" })).toHaveCount(0);
});

test("a custom plan is described rather than priced, and a solar capacity needs its unit", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.rahul);
  await page.goto("/work-orders/new");
  const client = `E2E Custom ${Date.now()}`;
  await page.getByLabel(/client name/i).fill(client);
  await page.getByLabel(/total cost/i).fill("45000");

  // "1 panel" is not a kW capacity: the form says so and will not send it.
  await page.getByLabel(/plant capacity/i).fill("1 panel");
  await expect(page.getByText(/write the capacity like 3kW/i)).toBeVisible();
  await page.getByRole("button", { name: /create work order/i }).click();
  await expect(page).toHaveURL(/\/work-orders\/new/);

  // Choose Custom plan: describe what was sold; no KSEB price.
  await page.locator("label", { hasText: "Custom plan" }).click();
  await expect(page.getByLabel(/plant capacity/i)).toHaveCount(0);
  await page.getByLabel(/what was sold/i).fill("Inverter + panel");
  await page.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(page, "Work order created.");

  await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  const row = page.getByRole("row").filter({ hasText: client });
  await expect(row).toContainText("Inverter + panel");
  await expect(row).toContainText("Custom plan");
  await row.click();
  await expect(page.getByRole("heading", { name: client })).toBeVisible();
  await expect(page.getByText("Custom plan — no KSEB registration or feasibility.")).toBeVisible();
  await expect(page.getByText(/KSEB charges \(paid by the customer\)/i)).toHaveCount(0);
});
