import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectFlash } from "./support/flash";

const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };
const COORD = { email: "coord@bsssolar.test", password: "Coord@12345" };
// supabase/seed.sql gives the admin one unread alert with this title. Other
// specs create work orders as Rahul too, so on a re-run there can be several —
// any of them proves the point, hence `.first()` below.
const SEEDED_TITLE = "New work order from Rahul Menon";

/** A signed-in page in its own browser context, so roles never share a session. */
async function signIn(
  browser: Browser,
  user: { email: string; password: string },
): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

const unreadBell = (page: Page) =>
  page.getByRole("button", { name: /^notifications, \d+ unread$/i });
const quietBell = (page: Page) => page.getByRole("button", { name: /^notifications$/i });

test("a coordinator's new work order reaches the office bell, and mark all read clears it", async ({
  browser,
}) => {
  // The coordinator submits; every office account is notified.
  const coordinator = await signIn(browser, COORD);
  const client = `E2E Bell ${Date.now()}`;
  await coordinator.goto("/work-orders/new");
  await coordinator.getByLabel(/client name/i).fill(client);
  await coordinator.getByLabel(/plant capacity/i).fill("3kW");
  await coordinator.getByLabel(/total cost/i).fill("180000");
  await coordinator.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(coordinator, "Work order created.");

  const page = await signIn(browser, ADMIN);
  await expect(unreadBell(page)).toBeVisible();
  await unreadBell(page).click();

  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: /^notifications$/i })).toBeVisible();
  await expect(panel.getByText(client)).toBeVisible();
  // Push needs VAPID keys + a real browser grant; the panel must still explain itself.
  await expect(panel.getByText(/push/i).first()).toBeVisible();

  await panel.getByRole("button", { name: /mark all read/i }).click();
  await expect(quietBell(page)).toBeVisible();
  await expect(unreadBell(page)).toHaveCount(0);

  // The count is the server's, not just local state.
  await page.reload();
  await expect(quietBell(page)).toBeVisible();
});

test("/notifications lists the inbox and opens an alert's page", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);

  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();
  // Push settings for this device (state depends on the browser and VAPID env).
  await expect(page.getByText(/push notifications/i).first()).toBeVisible();

  const item = page
    .getByRole("list", { name: /^notifications$/i })
    .getByRole("button", { name: new RegExp(SEEDED_TITLE, "i") })
    .first();
  await expect(item).toBeVisible();

  // The unread filter is a link-driven view.
  await page.getByRole("link", { name: /^unread$/i }).click();
  await expect(page).toHaveURL(/[?&]unread=1/);
  await page.getByRole("link", { name: /^all$/i }).click();
  await expect(page).not.toHaveURL(/unread=1/);

  await item.click();
  await expect(page).toHaveURL(/\/work-orders\/[^/?]+/);
});
