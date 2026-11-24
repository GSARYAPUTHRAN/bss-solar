import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, signIn, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * The monthly management report (/reports): office only, a month picker that
 * navigates, every section on the page, and the four downloads (PDF + three
 * CSVs) built in the browser.
 *
 * Seeded figures move with the day the seed was loaded and with what other
 * specs create, so nothing here asserts a total: the spec creates its own sale
 * (with an advance) and looks for that, and otherwise checks structure.
 */

/** The current month in India, as the report means it (YYYY-MM). */
function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7);
}

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Click a download button and read what was saved. */
async function download(page: Page, button: string | RegExp) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: button }).click();
  const file = await downloading;
  const bytes = await readFile(await file.path());
  return { name: file.suggestedFilename(), bytes, text: bytes.toString("utf8") };
}

test("the monthly report shows a new sale and its advance, on screen and in every download", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const month = currentMonth();
  const client = `E2E Report ${Date.now()}`;

  await signIn(page, ACCOUNTS.admin);

  await test.step("a sale booked today with a ₹25,000 advance", async () => {
    await page.goto("/work-orders/new");
    await page.getByLabel(/client name/i).fill(client);
    await page.getByLabel(/plant capacity/i).fill("5kW");
    await page.getByLabel(/total cost/i).fill("300000");
    await page.getByLabel(/advance collected/i).fill("25000");
    await page.getByRole("button", { name: /create work order/i }).click();
    await expectFlash(page, /work order created/i);
  });

  await test.step("Reports is in the office navigation, right after the dashboard", async () => {
    await page.goto("/");
    const nav = page.locator("aside");
    // Wait for the sidebar to render before reading its order.
    await expect(nav.getByRole("link", { name: "Reports" })).toBeVisible();
    const links = await nav.getByRole("link").allTextContents();
    expect(links.slice(0, 2)).toEqual(["Dashboard", "Reports"]);
    await nav.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/reports$/);
  });

  await test.step("the current month, so far, with every section", async () => {
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Reports" });
    await expect(tabs.getByRole("link", { name: "Monthly report" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("combobox", { name: "Month" })).toHaveText(
      `${monthName(month)} (so far)`,
    );
    await expect(page.getByTestId("report-comparing")).toContainText("compared day for day");

    for (const label of ["Sales booked", "Sales value", "Net collected", "Commissioned"]) {
      await expect(page.locator(`[data-kpi]`, { hasText: label }).first()).toBeVisible();
    }
    for (const table of ["Collections", "Financial year to date", "12-month trend", "By coordinator"]) {
      await expect(page.getByRole("table", { name: table })).toBeVisible();
    }
    await expect(page.getByRole("table", { name: "12-month trend" }).getByRole("row")).toHaveCount(13);
    // The sale was booked by the admin (the default coordinator).
    await expect(page.getByRole("table", { name: "By coordinator" })).toContainText("BSS Admin");
    await expect(page.getByRole("heading", { name: "As of today" })).toBeVisible();

    await page.getByText("How these numbers are counted").click();
    await expect(page.getByText(/imported projects whose commissioning date/i)).toBeVisible();
  });

  await test.step("the sales CSV lists the sale, UTF-8 with a BOM", async () => {
    const csv = await download(page, "Sales (CSV)");
    expect(csv.name).toBe(`bss-sales-${month}.csv`);
    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.text).toContain(
      "order_date,client_name,coordinators,plan,capacity_kw,total_cost,advance,received_to_date,balance_due,status,project_state,financing",
    );
    const line = csv.text.split("\n").find((l) => l.includes(client));
    expect(line).toBeDefined();
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2},/);
    expect(line).toContain(",5kW,5,300000.00,25000.00,25000.00,275000.00,pending,none,");
  });

  await test.step("the collections CSV has its advance", async () => {
    const csv = await download(page, "Collections (CSV)");
    expect(csv.name).toBe(`bss-collections-${month}.csv`);
    expect(csv.text).toContain("date,client_name,kind,method,amount,reference");
    const line = csv.text.split("\n").find((l) => l.includes(client));
    expect(line).toContain(`,${client},advance,`);
    expect(line).toContain(",25000.00,");
  });

  await test.step("the trend CSV has twelve months, ending with this one", async () => {
    const csv = await download(page, "12-month trend (CSV)");
    expect(csv.name).toBe(`bss-trend-${month}.csv`);
    const lines = csv.text.replace(/^﻿/, "").split("\n");
    expect(lines[0]).toBe(
      "month,so_far,sales_count,sales_value,capacity_kw,net_collected,commissioned,services_completed,sales_value_mom_pct",
    );
    expect(lines).toHaveLength(13);
    expect(lines[12].startsWith(`${month},yes,`)).toBe(true);
  });

  await test.step("the PDF downloads as the month's executive report", async () => {
    const pdf = await download(page, "Download PDF");
    expect(pdf.name).toBe(`bss-report-${month}.pdf`);
    expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

test("choosing a month navigates to it, and a bad month falls back to now", async ({ page }) => {
  const month = currentMonth();
  const previous = previousMonth(month);
  await signIn(page, ACCOUNTS.admin);
  await page.goto("/reports");

  await page.getByRole("combobox", { name: "Month" }).click();
  await page.getByRole("option", { name: monthName(previous), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reports\\?month=${previous}$`));
  await expect(page.getByRole("combobox", { name: "Month" })).toHaveText(monthName(previous));
  // A past month is whole: no "so far".
  await expect(page.getByTestId("report-comparing")).not.toContainText("so far");

  await page.goto("/reports?month=2026-13");
  await expect(page.getByRole("combobox", { name: "Month" })).toHaveText(
    `${monthName(month)} (so far)`,
  );
  await page.goto("/reports?month=2999-01");
  await expect(page.getByRole("combobox", { name: "Month" })).toHaveText(
    `${monthName(month)} (so far)`,
  );
});

test("the Services tab opens the services summary inside the same Reports shell", async ({ page }) => {
  await signIn(page, ACCOUNTS.admin);
  await page.goto("/reports");
  await page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Services" }).click();
  await expect(page).toHaveURL(/\/reports\/services/);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Services" }),
  ).toHaveAttribute("aria-current", "page");
});

test("coordinators and engineers never see Reports", async ({ browser }) => {
  for (const [account, home] of [
    [ACCOUNTS.rahul, /\/work-orders/],
    [ACCOUNTS.engineer, /\/tickets/],
  ] as const) {
    const page = await signedInPage(browser, account);
    await expect(page.locator("aside").getByRole("link", { name: "Reports" })).toHaveCount(0);
    for (const path of ["/reports", "/reports?month=2026-01"]) {
      await page.goto(path);
      await expect(page).toHaveURL(home);
    }
    await page.context().close();
  }
});

test("on a phone the report never scrolls the page sideways", async ({ page }) => {
  await signIn(page, ACCOUNTS.admin);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/reports");
  await expect(page.getByRole("table", { name: "12-month trend" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Wide tables scroll inside their card instead.
  const trend = page.getByRole("table", { name: "12-month trend" });
  const scroller = trend.locator("xpath=..");
  const scrolls = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  // Tap targets.
  for (const name of ["Download PDF", "Sales (CSV)"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  }
});
