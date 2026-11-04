import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";
import { REFUNDED_OVERPAYMENT, WRITTEN_OFF_SHORTFALL } from "./support/seed-sales";

/**
 * A coordinator's incentive paid in instalments: the office agrees an amount and
 * records, corrects and removes dated payments against it; the badge, the lists
 * and the dashboard follow what has been paid; each coordinator reads only their
 * own incentive and payments.
 *
 * The one test that changes things works on a sale logged here (Rahul's, then
 * approved by the office), so no seeded row is touched; the others only read the
 * seeded sales (supabase/seed.sql, see support/seed-sales.ts). Money on screen
 * is exact to the paisa ("₹2,000.00"), so amounts are matched with `(\.00)?`.
 */

/** An IST calendar date `days` from today (negative: before), as a date input takes it. */
function istDate(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** One coordinator's incentive block on the office's project page. */
const incentiveBlock = (page: Page, name: string) =>
  page.getByRole("group", { name: `Incentive for ${name}` });

/** The figure under a label ("Agreed", "Paid", "Still to pay") inside `scope`. */
const figure = (scope: Locator, label: string) =>
  scope
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");

/**
 * A state badge ("Pending", "Partly paid", "Paid") inside `scope`: the label
 * alone would also match the "Paid" figure beside it.
 */
const badge = (scope: Locator, label: string) =>
  scope.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${label}$`) });

/** The coordinator's read-only card on the project page. */
const ownIncentive = (page: Page) =>
  page.locator('[data-slot="card"]').filter({ hasText: "Your incentive payments" });

/** Wider than the viewport means a phone user scrolls sideways. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

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

/** The dashboard's "Incentives pending" figure, in rupees. */
async function incentivesPending(page: Page): Promise<number> {
  await page.goto("/");
  const text = await page
    .getByText(/^incentives pending$/i)
    .locator("xpath=following-sibling::p[1]")
    .innerText();
  return Number(text.replace(/[^\d.]/g, ""));
}

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

test("the office agrees an incentive and pays it in instalments — the caps, the badge, a correction and a removal", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const client = `E2E Instalments ${Date.now()}`;
  const project = await approvedProjectOfRahul(browser, client);
  const rahulName = ACCOUNTS.rahul.fullName;

  const admin = await signedInPage(browser, ACCOUNTS.admin);
  const pendingBefore = await incentivesPending(admin);
  await admin.goto(project);
  const block = incentiveBlock(admin, rahulName);

  await test.step("nothing is agreed yet, so nothing can be paid", async () => {
    await expect(badge(block, "Not set")).toBeVisible();
    await expect(block.getByText(/set the agreed amount to start recording payments/i)).toBeVisible();
    await expect(
      block.getByRole("button", { name: `Record payment for ${rahulName}` }),
    ).toHaveCount(0);
  });

  await test.step("the office agrees ₹6,000", async () => {
    await block.getByLabel(/agreed amount/i).fill("6000");
    await block.getByRole("button", { name: "Save", exact: true }).click();
    await expectFlash(admin, new RegExp(`incentive saved for ${rahulName}`, "i"));
    await expect(badge(block, "Pending")).toBeVisible();
    await expect(figure(block, "Agreed")).toContainText(/₹6,000(\.00)?/);
    await expect(figure(block, "Paid")).toContainText(/₹0(\.00)?/);
    await expect(figure(block, "Still to pay")).toContainText(/₹6,000(\.00)?/);
    await expect(block.getByText("No payments recorded yet.")).toBeVisible();
  });

  await test.step("a first instalment makes it partly paid, and is listed with who recorded it", async () => {
    await block.getByRole("button", { name: `Record payment for ${rahulName}` }).click();
    const dialog = admin.getByRole("dialog", { name: /record payment/i });
    // Dated today unless said otherwise, and held to what is still to pay.
    await expect(dialog.getByLabel(/paid on/i)).toHaveValue(istDate(0));
    await expect(dialog.getByLabel(/^amount/i)).toHaveAttribute("max", "6000");
    await dialog.getByLabel(/^amount/i).fill("2000");
    await dialog.getByLabel(/note/i).fill("Cheque 4411");
    await dialog.getByRole("button", { name: /^record payment$/i }).click();
    await expectFlash(
      admin,
      /₹2,000(\.00)? recorded for Rahul Menon — ₹4,000(\.00)? still to pay/i,
    );
    await expect(dialog).toBeHidden();

    await expect(badge(block, "Partly paid")).toBeVisible();
    await expect(figure(block, "Paid")).toContainText(/₹2,000(\.00)?/);
    await expect(figure(block, "Still to pay")).toContainText(/₹4,000(\.00)?/);
    const list = block.getByRole("list", { name: `Payments to ${rahulName}` });
    await expect(list).toContainText(/₹2,000(\.00)?/);
    await expect(list).toContainText("Cheque 4411");
    await expect(list).toContainText(`Recorded by ${ACCOUNTS.admin.fullName}`);
  });

  await test.step("an instalment can be neither more than what is left nor dated in the future", async () => {
    await block.getByRole("button", { name: `Record payment for ${rahulName}` }).click();
    const dialog = admin.getByRole("dialog", { name: /record payment/i });
    await expect(dialog.getByLabel(/^amount/i)).toHaveAttribute("max", "4000");
    await expect(dialog.getByLabel(/paid on/i)).toHaveAttribute("max", istDate(0));

    // The form stops these in the browser; lift that to see the server say no too.
    await dialog.getByLabel(/^amount/i).evaluate((el) => el.removeAttribute("max"));
    await dialog.getByLabel(/^amount/i).fill("4000.01");
    await dialog.getByRole("button", { name: /^record payment$/i }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      /₹4,000\.01 is more than the ₹4,000(\.00)? still to pay/i,
    );

    await dialog.getByLabel(/^amount/i).fill("1000");
    await dialog.getByLabel(/paid on/i).evaluate((el) => el.removeAttribute("max"));
    await dialog.getByLabel(/paid on/i).fill(istDate(2));
    await dialog.getByRole("button", { name: /^record payment$/i }).click();
    await expect(dialog.getByRole("alert")).toContainText(/cannot be in the future/i);
    // Nothing was written, and what was typed is still there.
    await expect(dialog.getByLabel(/^amount/i)).toHaveValue("1000");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(figure(block, "Paid")).toContainText(/₹2,000(\.00)?/);
  });

  await test.step("the rest settles it: paid, nothing left to record", async () => {
    await block.getByRole("button", { name: `Record payment for ${rahulName}` }).click();
    const dialog = admin.getByRole("dialog", { name: /record payment/i });
    await dialog.getByLabel(/^amount/i).fill("4000");
    await dialog.getByLabel(/paid on/i).fill(istDate(-1));
    await dialog.getByRole("button", { name: /^record payment$/i }).click();
    await expectFlash(admin, /₹4,000(\.00)? recorded for Rahul Menon — fully paid/i);

    await expect(badge(block, "Paid")).toBeVisible();
    await expect(figure(block, "Still to pay")).toContainText(/₹0(\.00)?/);
    await expect(
      block.getByRole("button", { name: `Record payment for ${rahulName}` }),
    ).toBeDisabled();
    await expect(block.getByText(/fully paid — nothing more to record/i)).toBeVisible();
  });

  await test.step("the agreed amount cannot go below what is paid", async () => {
    const amount = block.getByLabel(/agreed amount/i);
    await expect(amount).toHaveAttribute("min", "6000");
    await amount.evaluate((el) => el.removeAttribute("min"));
    await amount.fill("5000");
    await block.getByRole("button", { name: "Save", exact: true }).click();
    await expect(block.getByRole("alert")).toContainText(
      /cannot be less than the ₹6,000(\.00)? already paid/i,
    );
    // Clearing it is refused while payments stand, too.
    await amount.fill("");
    await block.getByRole("button", { name: "Save", exact: true }).click();
    await expect(block.getByRole("alert")).toContainText(/remove those payments before clearing/i);
  });

  await test.step("an instalment can be corrected", async () => {
    const list = block.getByRole("list", { name: `Payments to ${rahulName}` });
    const first = list.getByRole("listitem").filter({ hasText: "Cheque 4411" });
    await first.getByRole("button", { name: /^edit the/i }).click();
    const dialog = admin.getByRole("dialog", { name: /edit payment/i });
    await expect(dialog.getByLabel(/^amount/i)).toHaveValue("2000");
    await dialog.getByLabel(/note/i).fill("Cheque 4411 cleared");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectFlash(admin, new RegExp(`payment corrected for ${rahulName}`, "i"));
    await expect(list).toContainText("Cheque 4411 cleared");
  });

  await test.step("a mistaken instalment can be removed, and is owed again", async () => {
    const list = block.getByRole("list", { name: `Payments to ${rahulName}` });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await list
      .getByRole("listitem")
      .filter({ hasNotText: "Cheque 4411" })
      .getByRole("button", { name: /^remove the/i })
      .click();
    const dialog = admin.getByRole("dialog", { name: /remove this payment/i });
    await expect(dialog).toContainText(/owed to them again/i);
    await dialog.getByRole("button", { name: "Remove payment" }).click();
    await expectFlash(admin, /₹4,000(\.00)? payment removed for Rahul Menon/i);

    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(badge(block, "Partly paid")).toBeVisible();
    await expect(figure(block, "Still to pay")).toContainText(/₹4,000(\.00)?/);
  });

  await test.step("the project's summary, the list and its filters read agreed and paid", async () => {
    const summary = admin.locator("dt", { hasText: /^incentives$/i }).locator("xpath=..");
    await expect(summary).toContainText(/₹6,000(\.00)?/);
    await expect(summary).toContainText(/₹2,000(\.00)? paid/);
    await expect(summary).toContainText("Partly paid");

    const listUrl = (incentive?: string) =>
      `/projects?view=list&q=${encodeURIComponent(client)}${incentive ? `&incentive=${incentive}` : ""}`;
    const row = admin.getByRole("row").filter({ hasText: client });

    await admin.goto(listUrl());
    await expect(row).toContainText(/₹6,000(\.00)?/);
    await expect(row).toContainText(/₹2,000(\.00)? paid/);
    await expect(row.getByText("Partly paid").filter({ visible: true }).first()).toBeVisible();

    // Owed money and paid money: pending and partly paid both find it; paid does not.
    await admin.goto(listUrl("pending"));
    await expect(row).toBeVisible();
    await admin.goto(listUrl("partly_paid"));
    await expect(row).toBeVisible();
    await admin.goto(listUrl("paid"));
    await expect(row).toHaveCount(0);
  });

  await test.step("the dashboard counts only what is still to pay: agreed less paid", async () => {
    // ₹6,000 agreed, ₹2,000 of it paid: ₹4,000 more is pending than before.
    expect((await incentivesPending(admin)) - pendingBefore).toBe(4000);
  });
  await admin.context().close();

  await test.step("Rahul reads his own payments, and was told about the instalments", async () => {
    const rahul = await signedInPage(browser, ACCOUNTS.rahul);
    await rahul.goto(project);
    const own = ownIncentive(rahul);
    await expect(own).toContainText(/₹6,000(\.00)?/);
    await expect(badge(own, "Partly paid")).toBeVisible();
    await expect(figure(own, "Still to pay")).toContainText(/₹4,000(\.00)?/);
    await expect(
      own.getByRole("list", { name: "Payments to you" }).getByRole("listitem"),
    ).toHaveCount(1);
    // Read-only: nothing to record, change or remove.
    await expect(rahul.getByRole("form")).toHaveCount(0);
    await expect(rahul.getByRole("button", { name: /record payment/i })).toHaveCount(0);
    await expect(rahul.getByRole("button", { name: /^(edit|remove) the/i })).toHaveCount(0);

    await expectAlert(rahul, new RegExp(`incentive instalment paid[\\s\\S]*${client}`, "i"));
    await rahul.context().close();
  });
});

test("each coordinator reads only their own incentive and payments on a shared sale", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Seeded: Harikrishnan Nair is shared by Rahul (₹4,000 agreed, nothing paid)
  // and Priya (₹2,500, paid in full by one instalment noted "Paid in full").
  const client = "Harikrishnan Nair";
  const openProject = async (page: Page) => {
    await page.goto(`/projects?view=list&q=${encodeURIComponent(client)}`);
    await page.getByRole("row").filter({ hasText: client }).click();
    await expect(page.getByRole("heading", { name: client })).toBeVisible();
  };

  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await openProject(admin);
  await expect(incentiveBlock(admin, ACCOUNTS.rahul.fullName)).toBeVisible();
  const priyaBlock = incentiveBlock(admin, ACCOUNTS.priya.fullName);
  await expect(priyaBlock.getByRole("list", { name: /^payments to/i })).toContainText("Paid in full");
  await expect(
    incentiveBlock(admin, ACCOUNTS.rahul.fullName).getByText("No payments recorded yet."),
  ).toBeVisible();
  await admin.context().close();

  await test.step("Rahul sees his ₹4,000 and none of Priya's payments", async () => {
    const rahul = await signedInPage(browser, ACCOUNTS.rahul);
    await rahul.setViewportSize({ width: 375, height: 812 });
    await openProject(rahul);
    const own = ownIncentive(rahul);
    await expect(figure(own, "Agreed")).toContainText(/₹4,000(\.00)?/);
    await expect(own.getByText("No payments recorded yet.")).toBeVisible();
    // ("Paid in full" is also a payment badge, so look for Priya's instalment itself.)
    await expect(
      rahul.getByRole("list", { name: /^payments to/i }).filter({ hasText: "Paid in full" }),
    ).toHaveCount(0);
    await expect(own.getByText(/₹2,500/)).toHaveCount(0);
    await expect(rahul.getByText(`Incentive for ${ACCOUNTS.priya.fullName}`)).toHaveCount(0);
    await expect(rahul.getByRole("form")).toHaveCount(0);
    // The page still fits a phone.
    expect(await horizontalOverflow(rahul)).toBeLessThanOrEqual(0);
    await rahul.context().close();
  });

  await test.step("Priya sees her ₹2,500, paid, and none of Rahul's", async () => {
    const priya = await signedInPage(browser, ACCOUNTS.priya);
    await priya.setViewportSize({ width: 375, height: 812 });
    await openProject(priya);
    const own = ownIncentive(priya);
    await expect(figure(own, "Agreed")).toContainText(/₹2,500(\.00)?/);
    await expect(figure(own, "Paid")).toContainText(/₹2,500(\.00)?/);
    await expect(badge(own, "Paid")).toBeVisible();
    await expect(own.getByRole("list", { name: "Payments to you" })).toContainText("Paid in full");
    await expect(own.getByText(/₹4,000/)).toHaveCount(0);
    await expect(priya.getByRole("form")).toHaveCount(0);
    expect(await horizontalOverflow(priya)).toBeLessThanOrEqual(0);
    await priya.context().close();
  });
});

test("the seeded instalments show to the office and to their own coordinator, and to nobody else", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  // Gopinathan Pillai (Rahul's): ₹6,000 agreed, two ₹2,000 instalments paid.
  const gopinathan = `/projects/${REFUNDED_OVERPAYMENT.projectId}`;
  // Sathyan Nambiar (Priya's): ₹3,500 agreed and paid in two parts.
  const sathyan = `/projects/${WRITTEN_OFF_SHORTFALL.projectId}`;

  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(gopinathan);
  const block = incentiveBlock(admin, ACCOUNTS.rahul.fullName);
  await expect(badge(block, "Partly paid")).toBeVisible();
  await expect(figure(block, "Agreed")).toContainText(/₹6,000(\.00)?/);
  await expect(figure(block, "Paid")).toContainText(/₹4,000(\.00)?/);
  await expect(figure(block, "Still to pay")).toContainText(/₹2,000(\.00)?/);
  const rows = block.getByRole("list", { name: /^payments to/i }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("First instalment");
  await expect(rows.nth(1)).toContainText("Second instalment");

  await admin.goto(sathyan);
  const priyaBlock = incentiveBlock(admin, ACCOUNTS.priya.fullName);
  await expect(badge(priyaBlock, "Paid")).toBeVisible();
  await expect(priyaBlock.getByRole("list", { name: /^payments to/i }).getByRole("listitem")).toHaveCount(2);
  await admin.context().close();

  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto(gopinathan);
  await expect(ownIncentive(rahul).getByRole("list", { name: "Payments to you" })).toContainText(
    "Second instalment",
  );
  // Another coordinator's sale is not theirs to open.
  await rahul.goto(sathyan);
  await expect(rahul.getByText(/page not found/i).first()).toBeVisible();
  await expect(rahul.getByText("On handover")).toHaveCount(0);
  await rahul.context().close();
});
