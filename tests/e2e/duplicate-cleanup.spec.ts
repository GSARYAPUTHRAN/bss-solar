import { test, expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signIn } from "./support/accounts";
import { expectFlash } from "./support/flash";
import {
  expectNoSidewaysScroll,
  expectNothingClipped,
  expectTapTarget,
} from "./support/layout";

/**
 * Find duplicates (/work-orders/duplicates): sales entered more than once are
 * grouped (same KSEB consumer number, or the same customer on the same order
 * date), the live copy with the most recorded work is marked Keep and the
 * copies plainly of the same sale are ticked, and the ticked copies are deleted
 * in one go behind a confirmation.
 * What was deleted is listed under "Recently deleted" with who deleted it.
 *
 * Each test enters its own copies under a client name stamped with the run, and
 * deletes only those: every other group on the page (earlier runs, the import
 * spec's "import them again") is unticked first, and no count on the page is
 * taken as a total.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Enter one copy of a sale through New Work Order. */
async function enterCopy(
  page: Page,
  copy: { client: string; orderDate: string; total: string; consumer?: string },
) {
  await page.goto("/work-orders/new");
  await page.getByLabel(/client name/i).fill(copy.client);
  await page.getByLabel(/plant capacity/i).fill("3kW");
  await page.getByLabel(/total cost/i).fill(copy.total);
  await page.getByLabel(/order date/i).fill(copy.orderDate);
  if (copy.consumer) await page.getByLabel(/kseb consumer number/i).fill(copy.consumer);
  await page.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(page, "Work order created.");
}

/** The group card of the copies named `client`. */
function groupOf(page: Page, client: string): Locator {
  return page.getByRole("group", { name: new RegExp(escapeRegExp(client)) });
}

/** The row of the copy whose work order is `id`, inside its group. */
function copyRow(group: Locator, id: string): Locator {
  return group.getByRole("row").filter({ has: group.page().locator(`a[href="/work-orders/${id}"]`) });
}

/** The ids of the work orders a group lists, in the order shown. */
async function idsIn(group: Locator): Promise<string[]> {
  const hrefs = await group
    .locator('a[href^="/work-orders/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.map((href) => href.split("/").at(-1) ?? "");
}

/**
 * Untick every copy outside this run's group, so "Delete selected" takes only
 * what this test entered. `token` is in this run's client names (and so in its
 * checkboxes' labels: "Delete <client> — added <when>").
 */
async function untickOtherGroups(page: Page, token: string) {
  const others = page.locator(
    `[role="checkbox"][aria-checked="true"]:not([aria-label*="${token}"])`,
  );
  for (let left = await others.count(); left > 0; left = await others.count()) {
    await others.first().click();
    await expect(others).toHaveCount(left - 1);
  }
}

async function openCleanup(page: Page) {
  await page.goto("/work-orders");
  await page.getByRole("link", { name: /find duplicates/i }).click();
  await expect(page).toHaveURL(/\/work-orders\/duplicates/);
  await expect(page.getByRole("heading", { name: /^find duplicates$/i })).toBeVisible();
}

test("the office finds a sale entered three times, keeps the one with work on it and deletes the others", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, ACCOUNTS.admin);
  const token = `${Date.now()}`;
  const client = `E2E Dup Clean ${token}`;
  const consumer = `11${token.slice(-11)}`;
  const orderDate = "2025-01-15";

  let keeperId = "";
  await test.step("the same sale is entered three times; the first one is approved", async () => {
    await enterCopy(page, { client, orderDate, total: "195000", consumer });
    await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
    await page.getByRole("row").filter({ hasText: client }).click();
    await expect(page).toHaveURL(/\/work-orders\/[^/?#]+/);
    keeperId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("button", { name: /approve & create project/i }).click();
    await expectFlash(page, "Work order approved — project created.");

    // Again with the same consumer number, and again with another total and none.
    await enterCopy(page, { client, orderDate, total: "195000", consumer });
    await enterCopy(page, { client, orderDate, total: "200000" });
  });

  const group = groupOf(page, client);
  let copies: string[] = [];
  await test.step("they are one group, with why, the approved copy kept and the others ticked", async () => {
    await openCleanup(page);
    await expect(page.getByTestId("duplicate-summary")).toHaveText(
      /^\d+ groups? · \d+ extra cop(y|ies) selected$/,
    );
    await expect(group).toBeVisible();
    await expect(group).toContainText("15 Jan 2025");
    await expect(group).toContainText("Same consumer number");
    await expect(group).toContainText("Same customer & date");
    await expect(group).toContainText("3 copies");

    copies = await idsIn(group);
    expect(copies).toHaveLength(3);
    // The copy with a project is suggested, and listed first.
    expect(copies[0]).toBe(keeperId);
    const keeper = copyRow(group, keeperId);
    await expect(keeper.getByText("Keep", { exact: true })).toBeVisible();
    await expect(keeper.getByRole("checkbox")).not.toBeChecked();

    for (const id of copies.slice(1)) {
      const row = copyRow(group, id);
      await expect(row.getByRole("checkbox")).toBeChecked();
      await expect(row.getByRole("checkbox")).toHaveAccessibleName(
        new RegExp(`^Delete ${escapeRegExp(client)} — added `),
      );
      await expect(row.getByText("Keep", { exact: true })).toHaveCount(0);
      await expect(row).toContainText("Pending");
    }
    // A total that differs from the kept copy's says so (amber, with words for a
    // screen reader); the same total does not.
    const totalCell = (id: string, total: string) =>
      copyRow(group, id).getByRole("cell").filter({ hasText: total });
    await expect(totalCell(copies[2], "₹2,00,000")).toContainText(
      "(differs from the kept copy)",
    );
    await expect(totalCell(copies[1], "₹1,95,000")).not.toContainText("differs");
    await expect(totalCell(keeperId, "₹1,95,000")).not.toContainText("differs");
  });

  await test.step("only this group's two extra copies are selected", async () => {
    await untickOtherGroups(page, token);
    await expect(page.getByRole("button", { name: /^delete selected \(2\)$/i })).toBeEnabled();

    // Unticking one marks it kept; ticking it again puts the suggestion back.
    await copyRow(group, copies[1]).getByRole("checkbox").click();
    await expect(page.getByRole("button", { name: /^delete selected \(1\)$/i })).toBeVisible();
    await expect(copyRow(group, copies[1]).getByText("Kept", { exact: true })).toBeVisible();
    await copyRow(group, copies[1]).getByRole("checkbox").click();
    await expect(page.getByRole("button", { name: /^delete selected \(2\)$/i })).toBeVisible();
    await expect(copyRow(group, copies[1]).getByText("Kept", { exact: true })).toHaveCount(0);

    // A copy opens in a new tab, so looking at one never loses these ticks.
    await expect(copyRow(group, keeperId).getByRole("link")).toHaveAttribute("target", "_blank");
  });

  await test.step("the confirmation says what goes and needs a tick", async () => {
    await page.getByRole("button", { name: /^delete selected \(2\)$/i }).click();
    const dialog = page.getByRole("dialog", { name: /delete 2 sales\?/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("2 sales, with 0 projects and 0 ledger entries.");
    await expect(dialog).toContainText(/this cannot be undone/i);
    // The kept copy is not ticked, so no sale goes entirely.
    await expect(dialog).not.toContainText(/nothing of that sale will be left/i);
    await expect(dialog.getByRole("button", { name: /^cancel$/i })).toBeFocused();

    const confirm = dialog.getByRole("button", { name: /^delete 2 sales$/i });
    await expect(confirm).toBeDisabled();
    await dialog
      .getByRole("checkbox", { name: /i understand these sales are deleted permanently/i })
      .click();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expectFlash(page, "2 duplicate sales deleted.");
    await expect(dialog).toBeHidden();
    await expect(group).toHaveCount(0);
  });

  await test.step("Recently deleted lists both copies, under the admin's name", async () => {
    const log = page.getByRole("list", { name: /recent deletes/i });
    // One entry for the one delete: both sales went in the same transaction.
    const entry = log.locator(":scope > li").filter({ hasText: client }).first();
    await expect(entry).toContainText(ACCOUNTS.admin.fullName);
    await expect(entry).toContainText(`Sale — ${client}, 15 Jan 2025, ₹1,95,000`);
    await expect(entry).toContainText(`Sale — ${client}, 15 Jan 2025, ₹2,00,000`);
    await expect(entry.getByRole("listitem").filter({ hasText: client })).toHaveCount(2);

    // The kept copy is still there, with its project.
    await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
    await expect(page.getByRole("row").filter({ hasText: client })).toHaveCount(1);
    await page.goto(`/work-orders/${keeperId}`);
    await expect(page.getByRole("link", { name: /view project/i })).toBeVisible();
  });
});

test("a coordinator and an engineer are kept out of the clean-up", async ({ page, browser }) => {
  await signIn(page, ACCOUNTS.rahul);
  await expect(page.getByRole("link", { name: /find duplicates/i })).toHaveCount(0);
  await page.goto("/work-orders/duplicates");
  await expect(page).not.toHaveURL(/\/duplicates/);
  await expect(page.getByRole("heading", { name: /^find duplicates$/i })).toHaveCount(0);

  const engineer = await browser.newPage();
  await signIn(engineer, ACCOUNTS.engineer);
  await engineer.goto("/work-orders/duplicates");
  await expect(engineer).not.toHaveURL(/\/duplicates/);
  await expect(engineer.getByRole("heading", { name: /^find duplicates$/i })).toHaveCount(0);
  await engineer.context().close();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the page never scrolls sideways, its controls are big enough to tap, and a copy is deleted", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, ACCOUNTS.admin);
    const token = `${Date.now()}`;
    const client = `E2E Dup Phone ${token}`;
    await enterCopy(page, { client, orderDate: "2025-01-16", total: "180000" });
    await enterCopy(page, { client, orderDate: "2025-01-16", total: "180000" });

    await page.goto("/work-orders");
    const findDuplicates = page.getByRole("link", { name: /find duplicates/i });
    await expectTapTarget(findDuplicates);
    await findDuplicates.click();
    await expect(page).toHaveURL(/\/work-orders\/duplicates/);

    const group = groupOf(page, client);
    await expect(group).toBeVisible();
    await expect(group).toContainText("Same customer & date");
    await expectNoSidewaysScroll(page);

    // The card fits the screen; its table scrolls inside it instead.
    const card = await group.boundingBox();
    expect(card?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((card?.x ?? 0) + (card?.width ?? 999)).toBeLessThanOrEqual(360);

    for (const checkbox of await group.getByRole("checkbox").all()) {
      await expectTapTarget(checkbox);
    }
    for (const link of await group.locator('a[href^="/work-orders/"]').all()) {
      const height = await link.evaluate((el) => (el as HTMLElement).offsetHeight);
      expect(height).toBeGreaterThanOrEqual(40);
    }

    await untickOtherGroups(page, token);
    const deleteSelected = page.getByRole("button", { name: /^delete selected \(1\)$/i });
    await expectTapTarget(deleteSelected);
    await expectTapTarget(page.getByRole("button", { name: /^reset selection$/i }));
    await expectTapTarget(page.getByRole("button", { name: /^clear selection$/i }));
    await expectNoSidewaysScroll(page);

    // Recently deleted wraps its lines instead of running off the card.
    await expectNothingClipped(
      page.locator('[data-slot="card"]').filter({ hasText: "Recently deleted" }),
    );

    await deleteSelected.click();
    const dialog = page.getByRole("dialog", { name: /delete 1 sale\?/i });
    await expect(dialog).toBeVisible();
    // The dialog zooms in from 95% as it opens; measure once that has finished.
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    const box = await dialog.boundingBox();
    if (!box) throw new Error("the dialog is not on the screen");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    await expectNoSidewaysScroll(page);
    for (const button of await dialog.getByRole("button").all()) {
      // Layout height, not the on-screen box, so no transform can shave it.
      const height = await button.evaluate((el) => (el as HTMLElement).offsetHeight);
      expect(height).toBeGreaterThanOrEqual(40);
    }
    const understood = dialog.getByRole("checkbox", {
      name: /i understand this sale is deleted permanently/i,
    });
    await expectTapTarget(understood);

    await understood.click();
    await dialog.getByRole("button", { name: /^delete 1 sale$/i }).click();
    await expectFlash(page, "1 duplicate sale deleted.");
    await expect(group).toHaveCount(0);
    await expectNoSidewaysScroll(page);
  });
});
