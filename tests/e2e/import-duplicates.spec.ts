import { test, expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signIn } from "./support/accounts";

/**
 * The duplicate-upload warning of the onboarding import: a row is "already in
 * the system" when a work order has the same order date and the same customer,
 * names compared loosely (R.Vijayakumar = Vijayakumar R, Santhi kumari =
 * Santhikumari). Check file warns; Import projects writes NOTHING until the
 * office chooses to skip those rows or import them again.
 *
 * Every sale here is named with a stamp unique to the run and found again with
 * the work orders search, so nothing depends on the seed or on other specs.
 */

const COLUMNS = ["client_name", "plant_capacity", "total_cost", "order_date", "coordinator"];

function sheet(rows: { client: string; date: string }[]): string {
  return [
    COLUMNS.join(","),
    ...rows.map(({ client, date }) => [client, "3kW", "195000", date, "Rahul Menon"].join(",")),
  ].join("\n");
}

async function openOnboarding(page: Page) {
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: /import existing projects/i })).toBeVisible();
}

async function submit(page: Page, csv: string, button: RegExp) {
  await page.getByLabel("CSV data").fill(csv);
  await page.getByRole("button", { name: button }).click();
}

/** The work orders whose client name contains `q`. */
async function workOrdersMatching(page: Page, q: string): Promise<Locator> {
  await page.goto(`/work-orders?q=${encodeURIComponent(q)}`);
  await expect(page.getByRole("heading", { name: /work orders/i }).first()).toBeVisible();
  return page.getByRole("row").filter({ hasText: q });
}

test("a sheet uploaded again is caught: warned on Check file, asked on Import, nothing written until told", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, ACCOUNTS.admin);

  const stamp = `E2E Dup ${Date.now()}`;
  const first = sheet([
    { client: `${stamp} R.Vijayakumar`, date: "2025-03-04" },
    { client: `${stamp} Santhi kumari`, date: "2025-03-05" },
  ]);
  // The same two sales written another way, and one new sale.
  const second = sheet([
    { client: `Vijayakumar R ${stamp}`, date: "2025-03-04" },
    { client: `${stamp} Santhikumari`, date: "2025-03-05" },
    { client: `${stamp} Meenakshi Varma`, date: "2025-03-05" },
  ]);

  await test.step("a first upload goes in without a warning", async () => {
    await openOnboarding(page);
    await submit(page, first, /^import projects$/i);
    await expect(page.getByRole("button", { name: /^2 imported$/i })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  await test.step("Check file warns about the rows already in, by name, and counts them", async () => {
    await submit(page, second, /^check file$/i);
    const dialog = page.getByRole("dialog", { name: /some of these sales are already in the system/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      /2 of 3 rows match sales already in the system \(same customer and order date\)\. They were added on \d{1,2} [A-Z][a-z]{2} \d{4}\./,
    );
    await expect(dialog).toContainText(`Vijayakumar R ${stamp} and ${stamp} Santhikumari`);
    await expect(dialog).toContainText(/if you import, these rows are skipped unless you choose/i);
    await dialog.getByRole("button", { name: /^ok$/i }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole("button", { name: /^1 ready$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^2 already in the system$/i })).toBeVisible();
    await expect(
      page.getByText(new RegExp(`^Already in the system — ${stamp} R\\.Vijayakumar, added on`, "i")),
    ).toBeVisible();
  });

  await test.step("Import projects stops and asks; Cancel writes nothing", async () => {
    await page.getByRole("button", { name: /^import projects$/i }).click();
    const dialog = page.getByRole("dialog", { name: /some of these sales are already in the system/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/nothing has been imported yet/i);
    await expect(dialog.getByRole("button", { name: /^import all 3 anyway$/i })).toBeDisabled();
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(
      page.getByRole("heading", { name: /nothing was imported — some sales are already in the system/i }),
    ).toBeVisible();

    await expect(await workOrdersMatching(page, stamp)).toHaveCount(2);
  });

  await test.step("skipping them imports only the new sale", async () => {
    await openOnboarding(page);
    await submit(page, second, /^import projects$/i);
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: /^skip the 2 already in the system and import the other 1$/i })
      .click();

    await expect(page.getByRole("button", { name: /^1 imported$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^2 skipped$/i })).toBeVisible();
    await expect(page.getByText(/^Already in the system — /)).toHaveCount(2);

    const rows = await workOrdersMatching(page, stamp);
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Meenakshi Varma" })).toHaveCount(1);
  });

  await test.step("the whole sheet again: already uploaded, nothing new; Escape writes nothing", async () => {
    await openOnboarding(page);
    await submit(page, first, /^import projects$/i);
    const dialog = page.getByRole("dialog", { name: /this sheet was already uploaded/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/nothing new to import/i);
    await expect(dialog.getByRole("button", { name: /^skip/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^close$/i })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await expect(await workOrdersMatching(page, stamp)).toHaveCount(3);
  });

  await test.step("importing them anyway, once ticked, writes them again and says so", async () => {
    await openOnboarding(page);
    await submit(page, first, /^import projects$/i);
    const dialog = page.getByRole("dialog", { name: /this sheet was already uploaded/i });
    const all = dialog.getByRole("button", { name: /^import all 2 anyway$/i });
    await expect(all).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /i understand this creates duplicate sales/i }).click();
    await all.click();

    await expect(page.getByRole("button", { name: /^2 imported$/i })).toBeVisible();
    await expect(page.getByText(/^Imported again as chosen — this sale was already in the system/)).toHaveCount(2);

    await expect(await workOrdersMatching(page, stamp)).toHaveCount(5);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the warning fits the screen, its buttons are big enough to tap, and focus stays in it", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.admin);
    const stamp = `E2E Dup Phone ${Date.now()}`;
    const csv = sheet([
      { client: `${stamp} Anand`, date: "2025-03-06" },
      { client: `${stamp} Latha`, date: "2025-03-06" },
    ]);
    await openOnboarding(page);
    await submit(page, csv, /^import projects$/i);
    await expect(page.getByRole("button", { name: /^2 imported$/i })).toBeVisible();

    // One row of the sheet changed: the other is already in.
    await submit(page, csv.replace(`${stamp} Latha`, `${stamp} Latha Nair`), /^import projects$/i);
    const dialog = page.getByRole("dialog", { name: /some of these sales are already in the system/i });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    if (!box) throw new Error("the dialog is not on the screen");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);

    for (const button of await dialog.getByRole("button").all()) {
      const b = await button.boundingBox();
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(40);
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(360);
    }

    // Focus starts on the safe choice and does not leave the dialog.
    await expect(
      dialog.getByRole("button", { name: /^skip the 1 already in the system and import the other 1$/i }),
    ).toBeFocused();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });
});
