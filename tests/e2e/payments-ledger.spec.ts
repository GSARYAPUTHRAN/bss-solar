import { test, expect, type Page } from "@playwright/test";
import { expectFlash } from "./support/flash";

// The ledger renders as a table from `md` up and as cards below it; both are in
// the DOM, so text lookups are scoped to the visible one (role queries skip
// hidden elements, text queries do not).

const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };
const COORD = { email: "coord@bsssolar.test", password: "Coord@12345" };

/** Seeded active project owned by Rahul (coord@): Anand Kumar, one SBI instalment. */
const RAHUL_PROJECT = "/projects/20000000-0000-0000-0000-000000000001";

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Wait for the role's landing page so no navigation races the next goto.
  await expect(page).not.toHaveURL(/\/login/);
}

async function recordPayment(
  page: Page,
  payment: { amount: string; reference: string },
) {
  const section = page.locator("#payments");
  await section.getByRole("button", { name: /record payment/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/amount/i).fill(payment.amount);
  await dialog.getByLabel(/reference/i).fill(payment.reference);
  await dialog.getByRole("button", { name: /record payment/i }).click();
  return dialog;
}

test("the office records instalments in any number of stages", async ({ page }) => {
  await signIn(page, ADMIN);

  // Own the data: a fresh order (₹3,00,000, ₹50,000 advance) approved into a
  // project, so re-runs never fight the contract cap on seeded rows.
  const client = `E2E Ledger ${Date.now()}`;
  await page.goto("/work-orders/new");
  await page.getByLabel(/client name/i).fill(client);
  await page.getByLabel(/plant capacity/i).fill("5kW");
  // The live hint prices KSEB registration from the label: 5 × ₹1,000 + 18% GST.
  await expect(page.getByText(/5 kW · KSEB registration ₹5,900/)).toBeVisible();
  await page.getByLabel(/total cost/i).fill("300000");
  await page.getByLabel(/advance collected/i).fill("50000");
  await page.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(page, "Work order created.");

  await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await page.getByRole("row").filter({ hasText: client }).click();
  await page.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(page, "Work order approved — project created.");
  await page.getByRole("link", { name: /view project/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?#]+/);

  const section = page.locator("#payments");
  // The value itself: a section-wide text match could hit an equal "Total
  // received" or "Advance" figure and pass whatever the balance shows.
  const balanceDue = section
    .locator("dt", { hasText: /^Balance due$/ })
    .locator("xpath=following-sibling::dd");
  await expect(section.getByText(/no instalments recorded yet/i)).toBeVisible();
  await expect(balanceDue).toHaveText("₹2,50,000.00");

  // Three instalments after the advance; each becomes the next stage and the
  // balance falls with it.
  const stages = [
    { amount: "100000", reference: "UTR 1001", balance: "₹1,50,000.00" },
    { amount: "60000", reference: "UPI 2002", balance: "₹90,000.00" },
    { amount: "40000", reference: "CHQ 3003", balance: "₹50,000.00" },
  ];
  for (const [i, stage] of stages.entries()) {
    const dialog = await recordPayment(page, stage);
    await expect(dialog).toBeHidden();
    await expect(
      section.getByRole("cell", { name: `Stage ${i + 1}`, exact: true }),
    ).toBeVisible();
    await expect(section.getByRole("table").getByText(stage.reference)).toBeVisible();
    await expect(balanceDue).toHaveText(stage.balance);
  }
  await expect(section.getByText(/3 instalments after the advance/i)).toBeVisible();
  await expect(section.getByText(/83% collected/i)).toBeVisible();

  // An instalment above the balance is refused in plain language and the
  // dialog keeps what was typed.
  const dialog = await recordPayment(page, { amount: "60000", reference: "TOO MUCH" });
  await expect(dialog.getByRole("alert")).toContainText(
    /more than the ₹50,000\.00 balance due/i,
  );
  await expect(dialog.getByLabel(/amount/i)).toHaveValue("60000");
  await dialog.getByRole("button", { name: /cancel/i }).click();
  await expect(section.getByText("TOO MUCH")).toHaveCount(0);

  // A plain admin may correct an entry but never delete one.
  await expect(
    section.getByRole("button", { name: /edit stage 1 payment/i }),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: /^delete stage/i })).toHaveCount(0);
});

test("a coordinator sees their project's ledger read-only", async ({ page }) => {
  await signIn(page, COORD);
  await page.goto(RAHUL_PROJECT);

  const section = page.locator("#payments");
  await expect(section.getByText("Payments", { exact: true })).toBeVisible();
  await expect(
    section.getByRole("cell", { name: "Stage 1", exact: true }),
  ).toBeVisible();
  await expect(section.getByRole("table").getByText("SBI-DISB-4471")).toBeVisible();

  await expect(section.getByRole("button", { name: /record payment/i })).toHaveCount(0);
  await expect(section.getByRole("button", { name: /edit stage/i })).toHaveCount(0);
  await expect(section.getByRole("button", { name: /delete stage/i })).toHaveCount(0);

  // On a phone the ledger becomes cards and never scrolls sideways.
  await page.setViewportSize({ width: 375, height: 812 });
  const cards = section.getByRole("list", { name: /payments/i });
  await expect(cards).toBeVisible();
  await expect(cards.getByText("Stage 1", { exact: true })).toBeVisible();
  await expect(section.getByRole("table")).toBeHidden();
  const overflows = await section.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflows).toBe(false);
});
