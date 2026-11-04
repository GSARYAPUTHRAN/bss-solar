import { test, expect } from "@playwright/test";
import { ACCOUNTS, signIn, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

test("a coordinator can edit their own work order, including the new fields", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.rahul);

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

test("the plan is chosen while the order is pending and fixed once the project exists", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const client = `E2E Plan ${Date.now()}`;
  const listUrl = `/work-orders?q=${encodeURIComponent(client)}`;

  // A custom plan, logged by the coordinator.
  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto("/work-orders/new");
  await rahul.getByLabel(/client name/i).fill(client);
  await rahul.locator("label", { hasText: "Custom plan" }).click();
  await rahul.getByLabel(/what was sold/i).fill("1 panel");
  await rahul.getByLabel(/total cost/i).fill("32000");
  await rahul.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(rahul, "Work order created.");

  // While pending the plan is still a choice — and each plan keeps its own label.
  await rahul.goto(listUrl);
  await rahul.getByRole("row").filter({ hasText: client }).click();
  await rahul.getByRole("link", { name: /^edit$/i }).click();
  await expect(rahul.getByRole("radio", { name: "Custom plan" })).toBeChecked();
  await rahul.locator("label", { hasText: "Solar plant" }).click();
  // "1 panel" did not follow it into the solar capacity.
  await expect(rahul.getByLabel(/plant capacity/i)).toHaveValue("");
  await rahul.locator("label", { hasText: "Custom plan" }).click();
  await expect(rahul.getByLabel(/what was sold/i)).toHaveValue("1 panel");
  await rahul.getByLabel(/what was sold/i).fill("Inverter + panel");
  await rahul.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(rahul, "Work order updated.");
  await expect(rahul.getByText("Inverter + panel").first()).toBeVisible();

  // The office approves: the project exists, so the plan is fixed.
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(listUrl);
  await admin.getByRole("row").filter({ hasText: client }).click();
  await admin.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(admin, /work order approved/i);

  await rahul.reload();
  await rahul.getByRole("link", { name: /^edit$/i }).click();
  await expect(rahul.getByRole("radio")).toHaveCount(0);
  await expect(
    rahul.getByText(/Custom plan — fixed once the project has started\./),
  ).toBeVisible();
  // What was sold can still be corrected; the money is the office's by now.
  await expect(rahul.getByLabel(/total cost/i)).toHaveAttribute("readonly", "");
  await rahul.getByLabel(/what was sold/i).fill("Inverter + 2 panels");
  await rahul.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(rahul, "Work order updated.");
  await expect(rahul.getByText("Inverter + 2 panels").first()).toBeVisible();
});

test("the advance's method, date and reference are recorded with the order and follow its lock", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const client = `E2E Advance ${Date.now()}`;
  const listUrl = `/work-orders?q=${encodeURIComponent(client)}`;

  // The coordinator logs a sale and says how the advance was paid.
  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto("/work-orders/new");
  await rahul.getByLabel(/client name/i).fill(client);
  await rahul.getByLabel(/plant capacity/i).fill("5kW");
  await rahul.getByLabel(/total cost/i).fill("300000");
  await rahul.getByLabel(/advance collected/i).fill("50000");
  await rahul.getByRole("combobox", { name: /advance method/i }).click();
  await rahul.getByRole("option", { name: "Cheque" }).click();
  await rahul.getByLabel(/advance received on/i).fill("2025-02-04");
  await rahul.getByLabel(/advance reference/i).fill("CHQ 3003");
  await rahul.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(rahul, "Work order created.");

  await rahul.goto(listUrl);
  await rahul.getByRole("row").filter({ hasText: client }).click();
  await expect(rahul.getByText("Advance ₹50,000.00 · Cheque · 04 Feb 2025 · CHQ 3003")).toBeVisible();

  // While the order is pending the coordinator may still correct them.
  await rahul.getByRole("link", { name: /^edit$/i }).click();
  await expect(rahul.getByRole("combobox", { name: /advance method/i })).toContainText("Cheque");
  await expect(rahul.getByLabel(/advance received on/i)).toHaveValue("2025-02-04");
  await rahul.getByLabel(/advance reference/i).fill("CHQ 4004");
  await rahul.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(rahul, "Work order updated.");
  await expect(rahul.getByText("Advance ₹50,000.00 · Cheque · 04 Feb 2025 · CHQ 4004")).toBeVisible();

  // The office approves: from now on the details are the office's, like the advance.
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(listUrl);
  await admin.getByRole("row").filter({ hasText: client }).click();
  await admin.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(admin, /work order approved/i);

  await rahul.reload();
  await rahul.getByRole("link", { name: /^edit$/i }).click();
  await expect(rahul.getByLabel(/advance method/i)).toHaveAttribute("readonly", "");
  await expect(rahul.getByLabel(/advance method/i)).toHaveValue("Cheque");
  await expect(rahul.getByLabel(/advance received on/i)).toHaveAttribute("readonly", "");
  await expect(rahul.getByLabel(/advance reference/i)).toHaveAttribute("readonly", "");
  await expect(rahul.getByLabel(/advance reference/i)).toHaveValue("CHQ 4004");

  // Editing something else still saves, and leaves the office's record as it was.
  await rahul.getByLabel(/^notes$/i).fill("Gate code 4411");
  await rahul.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(rahul, "Work order updated.");
  await expect(rahul.getByText(/Gate code 4411/)).toBeVisible();
  await expect(rahul.getByText("Advance ₹50,000.00 · Cheque · 04 Feb 2025 · CHQ 4004")).toBeVisible();

  // The office can still correct them.
  await admin.reload();
  await admin.getByRole("link", { name: /^edit$/i }).click();
  await admin.getByRole("combobox", { name: /advance method/i }).click();
  await admin.getByRole("option", { name: "Bank transfer" }).click();
  await admin.getByLabel(/advance reference/i).fill("UTR 7770012345");
  await admin.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(admin, "Work order updated.");
  await expect(
    admin.getByText("Advance ₹50,000.00 · Bank transfer · 04 Feb 2025 · UTR 7770012345"),
  ).toBeVisible();
});
