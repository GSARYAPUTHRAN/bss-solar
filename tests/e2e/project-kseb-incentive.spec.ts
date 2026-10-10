import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectFlash, flashToast } from "./support/flash";

const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };
const COORD = { email: "coord@bsssolar.test", password: "Coord@12345" };

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

/** A signed-in page in its own browser context, so the two roles never share a session. */
async function signIn(
  browser: Browser,
  user: { email: string; password: string },
  landing: RegExp,
): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(landing);
  return page;
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

async function saveSettings(
  page: Page,
  values: { feasibilityDate: string; incentive: string },
) {
  await page.getByLabel(/kseb feasibility date/i).fill(values.feasibilityDate);
  await page.getByLabel(/coordinator incentive/i).fill(values.incentive);
  await page.getByLabel(/incentive paid on/i).fill("");
  // A toast left over from an earlier save must not satisfy this one.
  await expect(flashToast(page, SAVED)).toHaveCount(0);
  await page.getByRole("button", { name: /save settings/i }).click();
  await expectFlash(page, SAVED);
}

test("the office sets feasibility and incentive; the coordinator sees them read-only", async ({
  browser,
}) => {
  const admin = await signIn(browser, ADMIN, /\/$|\/\?/);
  await openProject(admin);

  // 20 days into the first 30-day validity period: 10 days left, no renewals.
  await saveSettings(admin, { feasibilityDate: istDaysAgo(20), incentive: "2750" });
  await expect(admin.getByText(/^feasibility valid$/i).first()).toBeVisible();
  await expect(admin.getByText("10 days", { exact: true })).toBeVisible();
  const officeIncentive = summaryRow(admin, /^coordinator incentive$/i);
  await expect(officeIncentive).toContainText("₹2,750");
  await expect(officeIncentive).toContainText("Pending");

  const coord = await signIn(browser, COORD, /\/work-orders/);
  await openProject(coord);

  // Their own incentive, the financing and the customer's KSEB fees…
  await expect(summaryRow(coord, /^your incentive$/i)).toContainText("₹2,750");
  await expect(coord.getByText(/loan · federal bank/i).first()).toBeVisible();
  await expect(coord.getByText(/registration · 5 kW/i)).toBeVisible();
  // ₹1,000 feasibility + 5 kW × ₹1,000 + 18% GST (₹900).
  await expect(coord.getByText("₹6,900")).toBeVisible();
  await expect(coord.getByText("10 days", { exact: true })).toBeVisible();

  // …but nothing to change them with.
  await expect(coord.getByRole("heading", { name: /project settings/i })).toHaveCount(0);
  await expect(coord.getByRole("button", { name: /save settings/i })).toHaveCount(0);
  await expect(coord.getByLabel(/coordinator incentive/i)).toHaveCount(0);
  await expect(
    coord.getByRole("button", { name: /complete next milestone/i }),
  ).toHaveCount(0);
  await coord.close();

  // Put the seeded state back so the rest of the suite sees what seed.sql set
  // up: 40 days in (one renewal), and an empty incentive removes it.
  await saveSettings(admin, { feasibilityDate: istDaysAgo(40), incentive: "" });
  await expect(admin.getByText(/^extended ×1$/i).first()).toBeVisible();
  await expect(summaryRow(admin, /^coordinator incentive$/i)).not.toContainText("₹");
  await admin.close();
});
