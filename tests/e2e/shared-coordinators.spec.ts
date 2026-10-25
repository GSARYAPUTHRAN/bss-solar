import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, signIn, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * A sale shared by coordinators, end to end: Rahul logs it on his phone with
 * Priya as a partner; Priya sees and edits it; the office approves (both are
 * told) and later swaps Priya for Arun (Priya is told, loses the sale; Arun is
 * told and gets it). The test creates its own data and asserts only on it.
 */

/** The page is no wider than the phone it is on. */
const fitsTheScreen = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/**
 * The inbox row for an alert. Delivery runs after the action responds, so the
 * inbox is re-read until it shows up.
 */
async function expectAlert(page: Page, title: RegExp) {
  const alert = page
    .getByRole("list", { name: /^notifications$/i })
    .getByRole("button", { name: title })
    .first();
  await expect(async () => {
    await page.goto("/notifications");
    await expect(alert).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
}

test("a sale shared by two coordinators is logged, edited, approved and re-staffed", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const client = `E2E Shared ${Date.now()}`;
  const listUrl = `/work-orders?q=${encodeURIComponent(client)}`;
  // Anything after the client name in an alert's text.
  const about = (title: string) => new RegExp(`${title}[\\s\\S]*${client}`, "i");

  // --- Rahul, on a phone, logs the sale with Priya as his partner ----------
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const rahul = await phone.newPage();
  await signIn(rahul, ACCOUNTS.rahul);

  await rahul.goto("/work-orders/new");
  expect(await fitsTheScreen(rahul)).toBe(true);
  await rahul.getByLabel(/client name/i).fill(client);
  await rahul.getByLabel(/plant capacity/i).fill("5kW");
  await rahul.getByLabel(/total cost/i).fill("300000");

  // He is first and cannot be taken off; partners come from a bottom sheet.
  const team = rahul.getByRole("group", { name: "Coordinators" });
  await expect(team).toContainText("You");
  await rahul.getByRole("button", { name: "Add partner" }).click();
  const sheet = rahul.getByRole("dialog", { name: "Add partner" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /Priya Suresh/ }).click();
  await expect(sheet).toBeHidden();
  await expect(team).toContainText("Priya Suresh");
  expect(await fitsTheScreen(rahul)).toBe(true);

  await rahul.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(rahul, /work order created and shared with Priya Suresh/i);

  // On his phone the list says who he shares it with, without a wide table.
  await rahul.goto(listUrl);
  await expect(rahul.getByRole("row").filter({ hasText: client })).toContainText(
    "with Priya Suresh",
  );
  expect(await fitsTheScreen(rahul)).toBe(true);

  // --- Priya sees it with both names, and may edit it -----------------------
  const priya = await signedInPage(browser, ACCOUNTS.priya);
  await expectAlert(priya, about("Rahul Menon added you to a sale"));

  await priya.goto(listUrl);
  const priyaRow = priya.getByRole("row").filter({ hasText: client });
  await expect(priyaRow).toContainText("Rahul Menon & Priya Suresh");
  await priyaRow.click();
  await expect(priya.getByRole("heading", { name: client })).toBeVisible();
  const priyaUrl = priya.url();

  const priyaTeam = priya.locator("#coordinators");
  await expect(priyaTeam).toContainText("Rahul Menon");
  await expect(priyaTeam).toContainText("Priya Suresh");
  // A partner cannot change who shares the sale.
  await expect(priyaTeam.getByRole("button")).toHaveCount(0);

  await priya.getByRole("link", { name: /^edit$/i }).click();
  await priya.getByLabel(/^address$/i).fill("Vytilla, Kochi — partner's visit");
  await priya.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(priya, "Work order updated.");
  await expect(priya.getByText("Vytilla, Kochi — partner's visit")).toBeVisible();

  // --- The office approves: both coordinators are told ----------------------
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(listUrl);
  await admin.getByRole("row").filter({ hasText: client }).click();
  await expect(admin.getByRole("heading", { name: client })).toBeVisible();
  const detailUrl = admin.url();
  expect(detailUrl).toBe(priyaUrl);
  await admin.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(admin, /work order approved/i);

  await expectAlert(rahul, about("Work order approved"));
  await expectAlert(priya, about("Work order approved"));

  // --- The office swaps Priya for Arun on the approved sale -----------------
  await admin.goto(detailUrl);
  const adminTeam = admin.locator("#coordinators");
  await adminTeam.getByRole("button", { name: "Change" }).click();
  const dialog = admin.getByRole("dialog", { name: "Change coordinators" });
  await dialog.getByRole("button", { name: "Remove Priya Suresh" }).click();
  await dialog.getByRole("button", { name: "Add coordinator" }).click();
  await admin
    .locator('[data-slot="popover-content"]')
    .getByRole("button", { name: /Arun Krishnan/ })
    .click();
  await dialog.getByRole("button", { name: "Save coordinators" }).click();
  await expectFlash(admin, /Arun Krishnan added, Priya Suresh removed/i);
  await expect(admin.locator("#coordinators")).toContainText("Arun Krishnan");
  await expect(admin.locator("#coordinators")).not.toContainText("Priya Suresh");

  // Priya is told, and the sale is gone from her list and her reach.
  await expectAlert(priya, about("You were taken off a sale"));
  await priya.goto(detailUrl);
  await expect(priya.getByText(/page not found/i).first()).toBeVisible();
  await priya.goto(listUrl);
  await expect(priya.getByRole("heading", { name: "Work Orders" })).toBeVisible();
  await expect(priya.getByRole("row").filter({ hasText: client })).toHaveCount(0);

  // Arun is told, and now sees it with Rahul.
  const arun = await signedInPage(browser, ACCOUNTS.arun);
  await expectAlert(arun, about("BSS Admin added you to a sale"));
  await arun.goto(detailUrl);
  await expect(arun.getByRole("heading", { name: client })).toBeVisible();
  await expect(arun.locator("#coordinators")).toContainText("Rahul Menon");
  await expect(arun.locator("#coordinators")).toContainText("Arun Krishnan");

  // Rahul, still first, keeps it.
  await rahul.goto(detailUrl);
  await expect(rahul.getByRole("heading", { name: client })).toBeVisible();
});

test("only the coordinator who logged a pending order can add a partner, and only the office takes one off", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const client = `E2E Partner Later ${Date.now()}`;

  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto("/work-orders/new");
  await rahul.getByLabel(/client name/i).fill(client);
  await rahul.getByLabel(/plant capacity/i).fill("4kW");
  await rahul.getByLabel(/total cost/i).fill("240000");
  await rahul.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(rahul, "Work order created.");

  // Alone on the sale: he adds a partner from the order's page.
  await rahul.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await rahul.getByRole("row").filter({ hasText: client }).click();
  const team = rahul.locator("#coordinators");
  await expect(team).toContainText("Rahul Menon");
  await team.getByRole("button", { name: "Add partner" }).click();
  const dialog = rahul.getByRole("dialog", { name: "Add a partner" });
  // Nobody can be taken off here — that is the office's call.
  await expect(dialog.getByRole("button", { name: /^remove/i })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add partner" }).click();
  await rahul
    .locator('[data-slot="popover-content"]')
    .getByRole("button", { name: /Priya Suresh/ })
    .click();
  await dialog.getByRole("button", { name: "Save partners" }).click();
  await expectFlash(rahul, /coordinators updated — Priya Suresh added/i);
  await expect(rahul.locator("#coordinators")).toContainText("Priya Suresh");

  // Once the office has approved it, the team is the office's to change.
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await admin.getByRole("row").filter({ hasText: client }).click();
  await admin.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(admin, /work order approved/i);

  await rahul.reload();
  await expect(rahul.locator("#coordinators")).toContainText("Priya Suresh");
  await expect(rahul.locator("#coordinators").getByRole("button")).toHaveCount(0);
  await expect(admin.locator("#coordinators").getByRole("button", { name: "Change" })).toBeVisible();
});
