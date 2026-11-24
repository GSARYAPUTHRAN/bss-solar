import { readFile } from "node:fs/promises";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signIn, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * The Services report (/reports/services): visits completed per service
 * engineer and in total, for a month or all time, with what is open now.
 *
 * Other specs raise and close tickets too, so no global count is asserted: the
 * one test that changes things raises its own visit and checks that it moves
 * Vineeth's figure by exactly one, lands in the list and in the CSV. The rest
 * read structure only. Rajesh Babu's project and the engineers come from
 * supabase/seed.sql.
 */

/** Rajesh Babu's project in the seed. */
const RAJESH_PROJECT_ID = "20000000-0000-0000-0000-000000000007";
const TICKET_NO = /BSS-\d+-\d+/;

/** Today in India, YYYY-MM-DD — the report's calendar. */
function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** "November 2026" for a YYYY-MM month. */
function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** The month before a YYYY-MM month. */
function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const engineerTable = (page: Page) =>
  page.getByRole("table", { name: "Service visits per engineer" });

/** The figure in `column` (0 = Completed) of a row of the per-engineer table. */
function engineerFigure(page: Page, name: string, column = 0): Locator {
  return engineerTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name, exact: true }) })
    .getByRole("cell")
    .nth(column);
}

async function countIn(cell: Locator): Promise<number> {
  return Number((await cell.textContent())?.trim());
}

/** A KPI tile's figure, by its label. */
function tileValue(page: Page, label: string): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("p.text-2xl");
}

async function pickPeriod(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Period" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/** Wider than the viewport means a phone user scrolls the page sideways. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("services report — office", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
  });

  test("a visit Vineeth completes counts for him this month — on screen and in the CSV", async ({
    browser,
    page,
  }) => {
    const today = istToday();
    const month = today.slice(0, 7);

    await page.goto("/reports/services");
    await expect(
      page.getByRole("heading", { name: `Services · ${monthName(month)} (so far)` }),
    ).toBeVisible();
    const before = await countIn(engineerFigure(page, "Vineeth Nair"));

    // The office raises a visit for Vineeth, due today.
    await page.goto(`/tickets/new?project_id=${RAJESH_PROJECT_ID}`);
    await page.getByLabel(/scheduled date/i).fill(today);
    await page.getByLabel(/service engineer/i).click();
    await page.getByRole("option", { name: /vineeth nair/i }).click();
    await page.getByLabel(/nature of complaint/i).fill(`E2E services report ${Date.now()}`);
    await page.getByRole("button", { name: /create ticket/i }).click();
    await expectFlash(page, "Ticket created and assigned.");
    const ticketId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    const heading = await page.getByRole("heading", { name: TICKET_NO }).first().textContent();
    const ticketNo = heading?.match(TICKET_NO)?.[0];
    if (!ticketNo) throw new Error(`No ticket number in the heading "${heading}"`);

    // Vineeth marks it completed from his phone (the database stamps today's IST date).
    const engineer = await signedInPage(browser, ACCOUNTS.vineeth);
    await engineer.goto(`/tickets/${ticketId}`);
    await engineer.getByRole("button", { name: /mark completed/i }).click();
    await engineer.getByRole("dialog").getByRole("button", { name: /^mark completed$/i }).click();
    await expect(engineer.getByText(new RegExp(`${ticketNo} marked completed`, "i"))).toBeVisible();
    await engineer.context().close();

    await test.step("it adds exactly one to his completed visits this month", async () => {
      await page.goto("/reports/services");
      await expect(engineerFigure(page, "Vineeth Nair")).toHaveText(String(before + 1));
      // The Total row is the headline figure.
      await expect(engineerFigure(page, "Total")).toHaveText(
        (await tileValue(page, "Completed").textContent()) ?? "",
      );
    });

    await test.step("it is in the completed list, linking to the ticket", async () => {
      const link = page.getByRole("link", { name: ticketNo, exact: true });
      await expect(link).toHaveAttribute("href", `/tickets/${ticketId}`);
      await expect(page.getByRole("row").filter({ has: link })).toContainText("Vineeth Nair");
      await expect(page.getByRole("row").filter({ has: link })).toContainText("Rajesh Babu");
    });

    await test.step("the CSV download carries it, as UTF-8 with a BOM", async () => {
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "Services (CSV)" }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(`bss-services-${month}.csv`);
      const body = await readFile(await download.path(), "utf8");
      expect(body.charCodeAt(0)).toBe(0xfeff);
      expect(body.slice(1).split("\n")[0]).toBe(
        "ticket_no,service_date,customer,engineer,type,total",
      );
      expect(body).toContain(`${ticketNo},${today},Rajesh Babu,Vineeth Nair,Routine 6-month,`);
    });
  });

  test("lists every service engineer with a total, and the reports tabs", async ({ page }) => {
    await page.goto("/reports/services");
    await expect(
      page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Services" }),
    ).toHaveAttribute("aria-current", "page");

    for (const name of ["Anil Kumar", "Vineeth Nair", "Total"]) {
      await expect(
        engineerTable(page).getByRole("rowheader", { name, exact: true }),
      ).toBeVisible();
    }
    // Coordinators are not engineers.
    await expect(engineerTable(page).getByRole("rowheader", { name: "Rahul Menon" })).toHaveCount(0);
    for (const label of ["Completed", "Routine 6-month", "Ad-hoc", "Service charges billed"]) {
      await expect(tileValue(page, label)).toBeVisible();
    }
    for (const label of ["Open + scheduled", "In progress", "Overdue"]) {
      await expect(tileValue(page, label)).toBeVisible();
    }
    await expect(page.getByText("Completed per month", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Visits completed per month", exact: true }).getByRole("rowheader"),
    ).toHaveCount(12);
  });

  test("switches between a past month and all time, in the URL", async ({ page }) => {
    const month = istToday().slice(0, 7);
    const last = previousMonth(month);
    await page.goto("/reports/services");

    await pickPeriod(page, "All time");
    await expect(page).toHaveURL(/\/reports\/services\?month=all$/);
    await expect(page.getByRole("heading", { name: "Services · All time" })).toBeVisible();
    // No trend for all time; the seeded visits are all in it.
    await expect(page.getByText("Completed per month", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "BSS-2606-1001", exact: true })).toBeVisible();

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Services (CSV)" }).click();
    expect((await downloading).suggestedFilename()).toBe("bss-services-all.csv");

    await pickPeriod(page, monthName(last));
    await expect(page).toHaveURL(new RegExp(`\\?month=${last}$`));
    await expect(page.getByRole("heading", { name: `Services · ${monthName(last)}` })).toBeVisible();
    const trend = page.getByRole("table", { name: "Visits completed per month", exact: true });
    await expect(trend.getByRole("rowheader").last()).toHaveText(monthName(last));
  });

  test("reads a bad or future month as the current one", async ({ page }) => {
    const current = `Services · ${monthName(istToday().slice(0, 7))} (so far)`;
    for (const month of ["2026-13", "9999-01", "nonsense"]) {
      await page.goto(`/reports/services?month=${month}`);
      await expect(page.getByRole("heading", { name: current })).toBeVisible();
    }
  });
});

test.describe("services report — on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("fits the screen: wide tables scroll inside their cards, controls are easy to tap", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.goto("/reports/services");
    await expect(engineerTable(page)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    for (const control of [
      page.getByRole("combobox", { name: "Period" }),
      page.getByRole("button", { name: "Services (CSV)" }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
    }

    await pickPeriod(page, "All time");
    await expect(page.getByRole("heading", { name: "Services · All time" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("services report — not for the field", () => {
  test("coordinators and engineers are sent to their own pages", async ({ browser }) => {
    const coordinator = await signedInPage(browser, ACCOUNTS.rahul);
    await coordinator.goto("/reports/services");
    await expect(coordinator).toHaveURL(/\/work-orders/);
    await expect(coordinator.getByRole("table", { name: "Service visits per engineer" })).toHaveCount(0);
    await coordinator.context().close();

    const engineer = await signedInPage(browser, ACCOUNTS.engineer);
    await engineer.goto("/reports/services?month=all");
    await expect(engineer).toHaveURL(/\/tickets/);
    await expect(engineer.getByRole("table", { name: "Service visits per engineer" })).toHaveCount(0);
    await engineer.context().close();
  });
});
