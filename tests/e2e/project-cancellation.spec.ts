import { test, expect, type Browser, type Page } from "@playwright/test";
import { ACCOUNTS, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * Cancelled and refunded projects: the office records it with remarks, the
 * sale's coordinator sees a read-only banner, the milestones freeze, and
 * reinstating undoes it. Everything runs on a sale logged here (Rahul's, then
 * approved by the office), so no seeded row is touched.
 */

const REMARKS = "Refunded ₹20,000 by bank transfer on request";

// One sale for the whole file; the tests run in order and build on each other.
test.describe.configure({ mode: "serial" });

let client: string;
let projectPath: string;

/** Rahul logs a 3 kW sale; the office approves it into a project. */
async function createApprovedProject(browser: Browser, name: string): Promise<string> {
  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto("/work-orders/new");
  await rahul.getByLabel(/client name/i).fill(name);
  await rahul.getByLabel(/plant capacity/i).fill("3kW");
  await rahul.getByLabel(/total cost/i).fill("180000");
  await rahul.getByLabel(/advance collected/i).fill("20000");
  await rahul.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(rahul, "Work order created.");
  await rahul.context().close();

  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(`/work-orders?q=${encodeURIComponent(name)}`);
  await admin.getByRole("row").filter({ hasText: name }).click();
  await admin.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(admin, "Work order approved — project created.");
  await admin.getByRole("link", { name: /view project/i }).click();
  await expect(admin).toHaveURL(/\/projects\/[^/?#]+/);
  const path = new URL(admin.url()).pathname;
  await admin.context().close();
  return path;
}

/** The "Project status" card (office only). */
const statusCard = (page: Page) =>
  page.locator('[data-slot="card"]').filter({ hasText: "Project status" });

/** The summary-card row (term + value) with the given label. */
function summaryRow(page: Page, label: RegExp) {
  return page.locator("dt", { hasText: label }).locator("xpath=..");
}

/** Wider than the viewport means a phone user scrolls sideways. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  client = `E2E Refund ${Date.now()}`;
  projectPath = await createApprovedProject(browser, client);
});

test("the office refunds a project with remarks; the badge, the record and the frozen milestones show", async ({
  browser,
}) => {
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(projectPath);

  // Live: milestones can be worked on, and the way out is one click away.
  await expect(admin.getByRole("button", { name: /complete next milestone/i })).toBeVisible();

  // Rahul's incentive: ₹3,000 agreed, ₹1,000 paid — ₹2,000 is still owed.
  const incentive = admin.getByRole("group", {
    name: `Incentive for ${ACCOUNTS.rahul.fullName}`,
  });
  await incentive.getByLabel(/agreed amount/i).fill("3000");
  await incentive.getByRole("button", { name: "Save", exact: true }).click();
  await expectFlash(admin, /incentive saved for/i);
  await incentive
    .getByRole("button", { name: `Record payment for ${ACCOUNTS.rahul.fullName}` })
    .click();
  const payment = admin.getByRole("dialog", { name: /record payment/i });
  await payment.getByLabel(/^amount/i).fill("1000");
  await payment.getByRole("button", { name: /^record payment$/i }).click();
  await expectFlash(admin, /₹1,000(\.00)? recorded for .* — ₹2,000(\.00)? still to pay/i);
  await expect(payment).toBeHidden();

  await admin.getByRole("button", { name: "Mark refunded" }).click();

  const dialog = admin.getByRole("dialog", { name: /cancel or refund this project/i });
  await expect(dialog.getByRole("radio", { name: "Refunded" })).toBeChecked();
  // It says what happens before anything does: the money stays on record.
  await expect(dialog.getByText(/collected stays in the ledger/i)).toBeVisible();
  await expect(dialog.getByText(/no longer counted as outstanding/i)).toBeVisible();
  // …and what it leaves alone: only what is still to pay of the incentive is owed.
  await expect(
    dialog.getByText(/1 unpaid incentive \(₹2,000(\.00)? still to pay\) stays owed/i),
  ).toBeVisible();
  await dialog.getByLabel(/remarks/i).fill(REMARKS);
  await dialog.getByRole("button", { name: "Mark refunded" }).click();
  await expectFlash(
    admin,
    /project marked refunded\. ₹2,000(\.00)? of coordinator incentives is still to pay/i,
  );
  await expect(dialog).toBeHidden();

  // A cancellation leaves incentives alone: the rest can still be paid.
  await expect(incentive).toBeVisible();
  await incentive
    .getByRole("button", { name: `Record payment for ${ACCOUNTS.rahul.fullName}` })
    .click();
  const rest = admin.getByRole("dialog", { name: /record payment/i });
  await rest.getByLabel(/^amount/i).fill("2000");
  await rest.getByRole("button", { name: /^record payment$/i }).click();
  await expectFlash(admin, /₹2,000(\.00)? recorded for .* — fully paid/i);
  await expect(rest).toBeHidden();

  // The record: status, who entered it, the remarks.
  const status = statusCard(admin);
  await expect(status.getByText("Refunded", { exact: true })).toBeVisible();
  await expect(status.getByText("Recorded by")).toBeVisible();
  await expect(status.getByText(ACCOUNTS.admin.fullName)).toBeVisible();
  await expect(status.getByText(REMARKS)).toBeVisible();
  await expect(status.getByRole("button", { name: "Reinstate" })).toBeVisible();

  // Owed nothing any more, and the pipeline moves on without it.
  await expect(summaryRow(admin, /^payment$/i)).toContainText(/nothing due — refunded/i);

  // Frozen: no milestone can be changed until it is reinstated.
  await expect(admin.getByText("Reinstate the project to change its milestones.")).toBeVisible();
  await expect(admin.getByRole("button", { name: /complete next milestone/i })).toHaveCount(0);
  await expect(admin.getByLabel(/^status for/i)).toHaveCount(0);
  await admin.context().close();
});

test("the sale's coordinator sees a read-only banner — on a phone too", async ({ browser }) => {
  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.setViewportSize({ width: 375, height: 812 });
  await rahul.goto(projectPath);

  await expect(rahul.getByText(/this project was refunded on/i)).toBeVisible();
  await expect(rahul.getByText(REMARKS)).toBeVisible();
  await expect(rahul.getByText("Project status")).toHaveCount(0);
  await expect(
    rahul.getByRole("button", { name: /mark cancelled|mark refunded|reinstate/i }),
  ).toHaveCount(0);
  await expect(rahul.getByLabel(/^status for/i)).toHaveCount(0);
  await expect(rahul.getByRole("button", { name: /complete next milestone/i })).toHaveCount(0);
  // Not even the office's record of who entered it.
  await expect(rahul.getByText("Recorded by", { exact: true })).toHaveCount(0);
  // The incentive is not frozen with the milestones: Rahul reads what was paid
  // him (his own two instalments), with nothing to change.
  const own = rahul.locator('[data-slot="card"]').filter({ hasText: "Your incentive payments" });
  await expect(own).toContainText(/₹3,000(\.00)?/);
  await expect(own.getByRole("listitem")).toHaveCount(2);
  expect(await horizontalOverflow(rahul)).toBeLessThanOrEqual(0);
  await rahul.context().close();

  // The office's page fits a phone as well.
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.setViewportSize({ width: 375, height: 812 });
  await admin.goto(projectPath);
  await expect(statusCard(admin)).toBeVisible();
  expect(await horizontalOverflow(admin)).toBeLessThanOrEqual(0);
  await admin.context().close();
});

test("the record can be corrected, then reinstated — remarks kept as a history note", async ({
  browser,
}) => {
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(projectPath);

  // Correct it: it was a plain cancellation, not a refund.
  await statusCard(admin).getByRole("button", { name: "Edit" }).click();
  const edit = admin.getByRole("dialog", { name: /edit cancellation/i });
  await expect(edit.getByRole("radio", { name: "Refunded" })).toBeChecked();
  await expect(edit.getByLabel(/remarks/i)).toHaveValue(REMARKS);
  await edit.getByRole("radio", { name: "Cancelled" }).check();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expectFlash(admin, /project marked cancelled/i);
  await expect(statusCard(admin).getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(statusCard(admin).getByText(REMARKS)).toBeVisible();

  // Reinstate: back at its current stage, milestones live again.
  await statusCard(admin).getByRole("button", { name: "Reinstate" }).click();
  const reinstate = admin.getByRole("dialog", { name: /reinstate this project/i });
  await expect(
    reinstate.getByText("The project returns to the active pipeline at its current stage."),
  ).toBeVisible();
  await expect(reinstate.getByLabel(/remarks/i)).toHaveValue(REMARKS);
  await reinstate.getByRole("button", { name: "Reinstate project" }).click();
  await expectFlash(admin, /project reinstated/i);
  await expect(reinstate).toBeHidden();

  const status = statusCard(admin);
  await expect(status.getByRole("button", { name: "Mark cancelled" })).toBeVisible();
  await expect(status.getByText("Notes from the earlier cancellation")).toBeVisible();
  await expect(status.getByText(REMARKS)).toBeVisible();
  await expect(admin.getByRole("button", { name: /complete next milestone/i })).toBeVisible();
  await expect(admin.getByText("Reinstate the project to change its milestones.")).toHaveCount(0);
  await expect(summaryRow(admin, /^payment$/i)).not.toContainText(/nothing due/i);
  await admin.context().close();

  // …and Rahul's banner is gone.
  const rahul = await signedInPage(browser, ACCOUNTS.rahul);
  await rahul.goto(projectPath);
  await expect(rahul.getByRole("heading", { name: client })).toBeVisible();
  await expect(rahul.getByText(/this project was (refunded|cancelled)/i)).toHaveCount(0);
  await rahul.context().close();
});
