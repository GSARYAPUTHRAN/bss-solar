import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectFlash } from "./support/flash";

/**
 * Service engineers work only the tickets assigned to them, from a phone.
 * Seed (supabase/seed.sql): Vineeth holds BSS-2606-1002 (in progress) and
 * BSS-2606-1004 (scheduled, Rajesh Babu); Anil holds 1001 and 1003.
 *
 * The seeded tickets are only read here; the status test raises and closes a
 * ticket of its own, so the file can run again without a fresh database.
 */
const ENGINEER = { email: "vineeth@bsssolar.test", password: "Engineer@12345" };
const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };
/** Rajesh Babu's project in the seed. */
const RAJESH_PROJECT_ID = "20000000-0000-0000-0000-000000000007";
const TICKET_NO = /BSS-\d+-\d+/;

/** An IST calendar date `days` after today, as the date inputs expect it. */
function istDaysFromNow(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

async function signInAsEngineer(page: Page) {
  await signIn(page, ENGINEER.email, ENGINEER.password);
  await expect(page).toHaveURL(/\/tickets/);
}

/** The job cards on the engineer's worklist. */
function ticketCards(page: Page) {
  return page.getByRole("main").getByRole("listitem");
}

/**
 * The office raises a scheduled visit at Rajesh Babu's site for Vineeth, from
 * a desktop in its own session. Returns the new ticket's number.
 */
async function raiseTicketForEngineer(browser: Browser, complaint: string): Promise<string> {
  const office = await browser.newPage();
  await signIn(office, ADMIN.email, ADMIN.password);
  await expect(office).toHaveURL(/\/$|\/\?/);

  await office.goto(`/tickets/new?project_id=${RAJESH_PROJECT_ID}`);
  await office.getByLabel(/scheduled date/i).fill(istDaysFromNow(3));
  await office.getByLabel(/service engineer/i).click();
  await office.getByRole("option", { name: /vineeth nair/i }).click();
  await office.getByLabel(/nature of complaint/i).fill(complaint);
  await office.getByRole("button", { name: /create ticket/i }).click();
  await expectFlash(office, "Ticket created and assigned.");

  const heading = await office.getByRole("heading", { name: TICKET_NO }).first().textContent();
  const ticketNo = heading?.match(TICKET_NO)?.[0];
  if (!ticketNo) throw new Error(`No ticket number in the heading "${heading}"`);
  await office.close();
  return ticketNo;
}

test.describe("service engineer", () => {
  // Field staff use phones: exercise the mobile layout.
  test.use({ viewport: { width: 390, height: 844 } });

  test("signs in to their own worklist and never sees anyone else's tickets", async ({
    page,
  }) => {
    await signInAsEngineer(page);
    await expect(
      page.getByRole("heading", { name: /my service tickets/i }),
    ).toBeVisible();

    // Active work by default: their seeded open tickets.
    await expect(page.getByRole("link", { name: /open BSS-2606-1002/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /open BSS-2606-1004/i })).toBeVisible();
    // Engineers do not raise tickets.
    await expect(page.getByRole("link", { name: /new ticket/i })).toHaveCount(0);

    // Even across every status, only theirs — never Anil's.
    await page.getByRole("link", { name: /^all$/i }).click();
    await expect(page).toHaveURL(/show=all/);
    await expect(ticketCards(page).first()).toBeVisible();
    await expect(page.getByText(/BSS-2606-1001/i)).toHaveCount(0);
    await expect(page.getByText(/BSS-2606-1003/i)).toHaveCount(0);

    // Someone else's ticket is indistinguishable from a missing one.
    await page.goto("/tickets/30000000-0000-0000-0000-000000000001");
    await expect(page.getByText(/BSS-2606-1001/i)).toHaveCount(0);
  });

  test("is alerted to a new ticket, starts it and marks it completed", async ({
    browser,
    page,
  }) => {
    const ticketNo = await raiseTicketForEngineer(browser, `E2E visit ${Date.now()}`);
    // Ticket numbers (BSS-2610-1005) carry no regex metacharacters.
    const named = (text: string) => new RegExp(text, "i");

    // The assignment reaches the engineer's bell, and the alert opens the ticket.
    await signInAsEngineer(page);
    await page.getByRole("button", { name: /^notifications, \d+ unread$/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: named(`new service ticket ${ticketNo}`) })
      .click();
    await expect(page.getByRole("heading", { name: named(ticketNo) })).toBeVisible();

    // Site details, one tap away — without any office controls.
    await expect(page.getByText(/rajesh babu/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^call /i })).toHaveAttribute(
      "href",
      /^tel:\+?\d+$/,
    );
    await expect(
      page.getByRole("link", { name: /in google maps/i }),
    ).toHaveAttribute("href", /google\.com\/maps/);
    await expect(page.getByRole("link", { name: /^edit$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /delete ticket/i })).toHaveCount(0);

    await page.getByRole("button", { name: /start work/i }).click();
    await expect(page.getByText(named(`work started on ${ticketNo}`))).toBeVisible();
    await expect(page.getByRole("button", { name: /start work/i })).toHaveCount(0);

    // Completing is confirmed first, since only the office can reopen it.
    await page.getByRole("button", { name: /mark completed/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(named(`mark ${ticketNo} completed\\?`))).toBeVisible();
    await dialog.getByRole("button", { name: /^mark completed$/i }).click();

    await expect(page.getByText(named(`${ticketNo} marked completed`))).toBeVisible();
    await expect(page.getByText(/this ticket is closed/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /mark completed/i })).toHaveCount(0);

    // It moves from the active list to the completed one.
    const card = page.getByRole("link", { name: named(`open ${ticketNo}`) });
    await page.goto("/tickets");
    await expect(card).toHaveCount(0);
    await page.goto("/tickets?show=completed");
    await expect(card).toBeVisible();
  });

  test("is kept out of the sales pipeline and office pages", async ({ page }) => {
    await signInAsEngineer(page);

    for (const path of ["/work-orders", "/projects", "/", "/team", "/tickets/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/tickets(\?|$)/);
    }
  });
});

test("the office sees which engineer holds each ticket and can filter by them", async ({
  page,
}) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/$|\/\?/);

  await page.goto("/tickets");
  await expect(page.getByRole("columnheader", { name: /engineer/i })).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "BSS-2606-1002" }),
  ).toContainText(/vineeth nair/i);
  await expect(
    page.getByRole("row").filter({ hasText: "BSS-2606-1001" }),
  ).toContainText(/anil kumar/i);

  await page.getByRole("combobox", { name: /engineer/i }).click();
  await page.getByRole("option", { name: /vineeth nair/i }).click();
  await expect(page).toHaveURL(/engineer=/);
  await expect(page.getByRole("row").filter({ hasText: /BSS-2606-1001/i })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: /BSS-2606-1002/i })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: /BSS-2606-1004/i })).toHaveCount(1);

  // The assignee picker offers engineers only.
  await page.goto("/tickets/new");
  await page.getByLabel(/service engineer/i).click();
  await expect(page.getByRole("option", { name: /vineeth nair/i })).toBeVisible();
  await expect(page.getByRole("option", { name: /rahul menon/i })).toHaveCount(0);
});
