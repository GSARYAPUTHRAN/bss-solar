import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signedInPage } from "./support/accounts";
import { expectFlash, flashToast } from "./support/flash";

// Seeded (supabase/seed.sql): Rahul Menon's 5 kW plant, on a Federal Bank loan,
// 40 days into its KSEB feasibility (one ₹1,000 renewal) with no incentive.
const CLIENT = "Vijay Menon";

const SAVED = "Project settings saved.";

/** An IST calendar date `days` before today, as the date inputs expect it. */
function istDaysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() - days * 86_400_000),
  );
}

async function openProject(page: Page) {
  await page.goto(`/projects?view=list&q=${encodeURIComponent(CLIENT)}`);
  await page.getByRole("row").filter({ hasText: CLIENT }).click();
  await expect(page.getByRole("heading", { name: CLIENT })).toBeVisible();
}

/** The summary-card row (term + value) with the given label. */
function summaryRow(page: Page, label: RegExp) {
  return page.locator("dt", { hasText: label }).locator("xpath=..");
}

/** One coordinator's incentive block on the project page (office): amount, payments, balance. */
const incentiveBlock = (page: Page, name: string) =>
  page.getByRole("group", { name: `Incentive for ${name}` });

async function saveFeasibilityDate(page: Page, date: string) {
  await page.getByLabel(/kseb feasibility date/i).fill(date);
  // A toast left over from an earlier save must not satisfy this one.
  await expect(flashToast(page, SAVED)).toHaveCount(0);
  await page.getByRole("button", { name: /save settings/i }).click();
  await expectFlash(page, SAVED);
}

/**
 * Agree (or, with an empty amount, clear) one person's incentive and wait for its
 * toast. The paid date is never typed: it follows the instalments recorded.
 */
async function saveIncentive(page: Page, name: string, amount: string) {
  const block = incentiveBlock(page, name);
  await block.getByLabel(/agreed amount/i).fill(amount);
  // The previous person's toast must not satisfy this one.
  const saved = new RegExp(`incentive saved for ${name}`, "i");
  await expect(flashToast(page, saved)).toHaveCount(0);
  await block.getByRole("button", { name: "Save", exact: true }).click();
  await expectFlash(page, saved);
}

/** A state badge inside `scope` (the label alone would also match the "Paid" figure beside it). */
const badge = (scope: Locator, label: string) =>
  scope.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${label}$`) });

/** Record one instalment against a person's incentive and wait for its toast. */
async function recordInstalment(page: Page, name: string, amount: number, toast: RegExp) {
  await incentiveBlock(page, name)
    .getByRole("button", { name: `Record payment for ${name}` })
    .click();
  const dialog = page.getByRole("dialog", { name: /record payment/i });
  await dialog.getByLabel(/^amount/i).fill(String(amount));
  await dialog.getByRole("button", { name: /^record payment$/i }).click();
  await expectFlash(page, toast);
  await expect(dialog).toBeHidden();
}

test("the office sets feasibility and an incentive; the coordinator sees them read-only", async ({
  browser,
}) => {
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await openProject(admin);

  // 20 days into the first 30-day validity period: 10 days left, no renewals.
  await saveFeasibilityDate(admin, istDaysAgo(20));
  await expect(admin.getByText(/^feasibility valid$/i).first()).toBeVisible();
  await expect(admin.getByText("10 days", { exact: true })).toBeVisible();

  // The incentive is Rahul's own, set on his form.
  await saveIncentive(admin, ACCOUNTS.rahul.fullName, "2750");
  const officeIncentive = summaryRow(admin, /^incentives$/i);
  await expect(officeIncentive).toContainText("₹2,750");
  await expect(officeIncentive).toContainText("Pending");
  await expect(badge(incentiveBlock(admin, ACCOUNTS.rahul.fullName), "Pending")).toBeVisible();

  const coord = await signedInPage(browser, ACCOUNTS.rahul);
  await openProject(coord);

  // Their own incentive, the financing and the customer's KSEB fees…
  await expect(summaryRow(coord, /^your incentive$/i)).toContainText("₹2,750");
  await expect(coord.getByText(/loan · federal bank/i).first()).toBeVisible();
  await expect(coord.getByText(/registration · 5 kW/i)).toBeVisible();
  // ₹1,000 feasibility + 5 kW × ₹1,000 + 18% GST (₹900).
  await expect(coord.getByText("₹6,900")).toBeVisible();
  await expect(coord.getByText("10 days", { exact: true })).toBeVisible();

  // …but nothing to change them with.
  await expect(coord.getByText("Coordinator incentives")).toHaveCount(0);
  await expect(coord.getByRole("group", { name: /^incentive for/i })).toHaveCount(0);
  await expect(coord.getByRole("form")).toHaveCount(0);
  await expect(coord.getByLabel(/kseb feasibility date/i)).toHaveCount(0);
  await expect(coord.getByRole("button", { name: /save settings/i })).toHaveCount(0);
  await expect(
    coord.getByRole("button", { name: /complete next milestone/i }),
  ).toHaveCount(0);
  await coord.context().close();

  // Put the seeded state back so the rest of the suite sees what seed.sql set
  // up: 40 days in (one renewal), and an empty amount removes the incentive.
  await saveFeasibilityDate(admin, istDaysAgo(40));
  await expect(admin.getByText(/^extended ×1$/i).first()).toBeVisible();
  await saveIncentive(admin, ACCOUNTS.rahul.fullName, "");
  await expect(summaryRow(admin, /^incentives$/i)).not.toContainText("₹");
  await admin.context().close();
});

/** Rahul logs a sale; the office approves it. Returns the project's path. */
async function approvedProjectOfRahul(browser: Browser, client: string): Promise<string> {
  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto("/work-orders/new");
  await rahul.getByLabel(/client name/i).fill(client);
  await rahul.getByLabel(/plant capacity/i).fill("3kW");
  await rahul.getByLabel(/total cost/i).fill("180000");
  await rahul.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(rahul, "Work order created.");
  await rahul.context().close();

  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await admin.getByRole("row").filter({ hasText: client }).click();
  await admin.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(admin, "Work order approved — project created.");
  await admin.getByRole("link", { name: /view project/i }).click();
  await expect(admin).toHaveURL(/\/projects\/[^/?#]+/);
  const path = new URL(admin.url()).pathname;
  await admin.context().close();
  return path;
}

/**
 * The office puts Priya on the sale (work-order page → Change coordinators).
 * Kept in one place: it follows the work-order page's coordinators dialog.
 */
async function sharePriya(page: Page) {
  await page.getByRole("link", { name: "Change", exact: true }).click();
  await expect(page).toHaveURL(/\/work-orders\/[^/?#]+/);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /change coordinators/i });
  await dialog.getByRole("button", { name: /add (coordinator|partner)/i }).click();
  const name = new RegExp(ACCOUNTS.priya.fullName, "i");
  await page
    .getByRole("option", { name })
    .or(page.getByRole("button", { name }))
    .first()
    .click();
  await dialog.getByRole("button", { name: /save coordinators/i }).click();
  await expectFlash(page, new RegExp(`${ACCOUNTS.priya.fullName} added`, "i"));
}

test("two coordinators on one sale: each incentive is their own and private to them", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const client = `E2E Incentives ${Date.now()}`;
  const project = await approvedProjectOfRahul(browser, client);

  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(project);
  await sharePriya(admin);
  await admin.goto(project);

  // One block each, in the sale's order.
  const rahulName = ACCOUNTS.rahul.fullName;
  const priyaName = ACCOUNTS.priya.fullName;
  await expect(incentiveBlock(admin, rahulName)).toBeVisible();
  await expect(incentiveBlock(admin, priyaName)).toBeVisible();
  await expect(badge(incentiveBlock(admin, rahulName), "Not set")).toBeVisible();

  await saveIncentive(admin, rahulName, "2750");
  await saveIncentive(admin, priyaName, "4100");
  // The office sees the whole sale: both, pending.
  const sale = summaryRow(admin, /^incentives$/i);
  await expect(sale).toContainText("₹6,850");
  await expect(sale).toContainText("Pending");

  // Paying one of them makes the sale "partly paid": Rahul's whole ₹2,750 is
  // recorded as an instalment, Priya's ₹4,100 is still to pay.
  await recordInstalment(admin, rahulName, 2750, /₹2,750(\.00)? recorded for Rahul Menon — fully paid/i);
  await expect(summaryRow(admin, /^incentives$/i)).toContainText("Partly paid");
  await expect(badge(incentiveBlock(admin, rahulName), "Paid")).toBeVisible();
  await expect(badge(incentiveBlock(admin, priyaName), "Pending")).toBeVisible();

  // Rahul sees his own and nothing of Priya's.
  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto(project);
  await expect(summaryRow(rahul, /^your incentive$/i)).toContainText("₹2,750");
  await expect(summaryRow(rahul, /^your incentive$/i)).toContainText(/paid/i);
  await expect(rahul.getByText(/4,100/)).toHaveCount(0);
  await expect(rahul.getByText(/6,850/)).toHaveCount(0);
  await expect(rahul.getByRole("form")).toHaveCount(0);
  // His own payment, listed on his own card.
  await expect(
    rahul.getByRole("list", { name: "Payments to you" }).getByRole("listitem"),
  ).toHaveCount(1);
  await rahul.context().close();

  // Priya sees hers and nothing of Rahul's.
  const priya = await signedInPage(browser, ACCOUNTS.priya);
  await priya.goto(project);
  await expect(summaryRow(priya, /^your incentive$/i)).toContainText("₹4,100");
  await expect(summaryRow(priya, /^your incentive$/i)).toContainText("Pending");
  await expect(priya.getByText(/2,750/)).toHaveCount(0);
  await expect(priya.getByText(/6,850/)).toHaveCount(0);
  // Rahul's instalment is his own: Priya has none, and sees no list of his.
  await expect(priya.getByText("No payments recorded yet.")).toBeVisible();
  // Both names are on the sale for everyone on it to see.
  await expect(priya.getByText(rahulName).first()).toBeVisible();
  await priya.context().close();

  // Clearing one nobody has been paid on is just emptying it.
  await saveIncentive(admin, priyaName, "");
  await expect(summaryRow(admin, /^incentives$/i)).toContainText("₹2,750");
  await expect(summaryRow(admin, /^incentives$/i)).not.toContainText("₹6,850");
  await admin.context().close();
});
