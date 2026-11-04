import { test, expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signIn } from "./support/accounts";
import { expectFlash } from "./support/flash";
import { expectNothingClipped } from "./support/layout";
import { REFUNDED_OVERPAYMENT, WRITTEN_OFF_SHORTFALL } from "./support/seed-sales";

// Refunds, write-offs and KSEB fees in the payments ledger (release 2026-11).
// The first tests only read the two seeded sales (see support/seed-sales.ts);
// the long one creates its own sale, so re-runs never fight the caps.
//
// The ledger renders as a table from `md` up and as cards below it; both are in
// the DOM, so lookups are scoped to the visible one (role queries skip hidden
// elements, text queries do not).

/** The value shown under a label in the contract summary. */
function summaryValue(section: Locator, label: string): Locator {
  return section
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd");
}

/** The ledger row whose first cell (its stage) is `label`. */
function ledgerRow(section: Locator, label: string): Locator {
  return section
    .getByRole("table")
    .getByRole("row")
    .filter({ has: section.page().getByRole("cell", { name: label, exact: true }) });
}

async function openRecordDialog(page: Page, section: Locator): Promise<Locator> {
  await section.getByRole("button", { name: /record payment/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseKind(page: Page, dialog: Locator, option: string) {
  await dialog.getByRole("combobox", { name: /what is this for/i }).click();
  await page.getByRole("option", { name: option }).click();
}

test("a sale with a refund reads collected, refunded and net received", async ({ page }) => {
  await signIn(page, ACCOUNTS.admin);
  await page.goto(`/projects/${REFUNDED_OVERPAYMENT.projectId}`);

  const section = page.locator("#payments");
  // ₹3,10,000 came in against ₹3,00,000; ₹10,000 went back.
  await expect(summaryValue(section, "Collected")).toHaveText("₹3,10,000.00");
  await expect(summaryValue(section, "Refunded")).toHaveText("−₹10,000.00");
  await expect(summaryValue(section, "Net received")).toHaveText("₹3,00,000.00");
  await expect(summaryValue(section, "Balance due")).toHaveText("₹0.00");
  await expect(summaryValue(section, "KSEB fees collected")).toHaveText("₹4,720.00");
  await expect(section.getByText("Paid in full").first()).toBeVisible();

  // The ledger shows the refund as money out: its own label, a minus, red.
  const refund = ledgerRow(section, "Refund");
  await expect(refund).toContainText("−₹10,000.00");
  await expect(refund.getByText("−₹10,000.00")).toHaveClass(/text-red-700/);
  await expect(ledgerRow(section, "Stage 1")).not.toContainText("−");

  // The advance heads the ledger: how, when, and the reference.
  await expect(
    section.getByText(/^Advance ₹40,000\.00 · UPI · .+ · UPI 4410021199$/),
  ).toBeVisible();
});

test("a sale settled by a write-off says so, with the reason and the office's KSEB fee", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.admin);
  await page.goto(`/projects/${WRITTEN_OFF_SHORTFALL.projectId}`);

  const section = page.locator("#payments");
  await expect(section.getByText("Settled — ₹800.00 written off")).toBeVisible();
  await expect(summaryValue(section, "Written off")).toHaveText("₹800.00");
  await expect(summaryValue(section, "Balance due")).toHaveText("₹0.00");
  await expect(summaryValue(section, "KSEB fees paid by office")).toHaveText("₹5,720.00");

  const writeOff = ledgerRow(section, "Write-off");
  await expect(
    writeOff.getByText(
      "Written off — Customer was ₹800 short at handover; waived by the office",
    ),
  ).toBeVisible();

  // The KSEB fee the office paid wears its tag; it is not part of the contract.
  const fee = ledgerRow(section, "KSEB fee 1");
  await expect(fee.getByText("Paid by office")).toBeVisible();

  // Nothing is due, so there is nothing left to write off.
  await expect(section.getByRole("button", { name: /write off balance/i })).toHaveCount(0);
});

test("a coordinator sees refunds and write-offs on their sale, read-only", async ({ page }) => {
  await signIn(page, ACCOUNTS.priya);
  await page.goto(`/projects/${WRITTEN_OFF_SHORTFALL.projectId}`);

  const section = page.locator("#payments");
  await expect(section.getByText("Settled — ₹800.00 written off")).toBeVisible();
  await expect(
    ledgerRow(section, "Write-off").getByText(/^Written off — Customer was ₹800 short/),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: /record payment/i })).toHaveCount(0);
  await expect(section.getByRole("button", { name: /write off/i })).toHaveCount(0);
  await expect(section.getByRole("button", { name: /^edit/i })).toHaveCount(0);

  // The work order's own page reads the same figures from the same pieces.
  await page.goto(`/work-orders/${WRITTEN_OFF_SHORTFALL.workOrderId}`);
  await expect(page.getByText("Settled — ₹800.00 written off")).toBeVisible();
  await expect(page.getByText(/^Advance ₹15,000\.00 · Bank transfer · .+ · UTR 8820113345$/)).toBeVisible();

  // On a phone the ledger becomes cards, with the reason on the card, and the
  // section never scrolls sideways.
  await page.goto(`/projects/${WRITTEN_OFF_SHORTFALL.projectId}`);
  await page.setViewportSize({ width: 375, height: 812 });
  const cards = section.getByRole("list", { name: /payments/i });
  await expect(cards).toBeVisible();
  await expect(
    cards.getByText("Written off — Customer was ₹800 short at handover; waived by the office"),
  ).toBeVisible();
  await expectNothingClipped(section);
});

test("the payment dialog asks what the entry is for in plain choices, and has no write-off in it", async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.admin);
  await page.goto(`/projects/${REFUNDED_OVERPAYMENT.projectId}`);

  const section = page.locator("#payments");
  const dialog = await openRecordDialog(page, section);
  await dialog.getByRole("combobox", { name: /what is this for/i }).click();
  await expect(page.getByRole("option")).toHaveText([
    "Contract payment",
    "KSEB fee collected from the customer",
    "KSEB fee paid by the office",
    "Refund",
  ]);
  await page.getByRole("option", { name: "Refund" }).click();
  await expect(dialog.getByText(/money returned to the customer/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^record refund$/i })).toBeVisible();
  await dialog.getByRole("button", { name: /cancel/i }).click();
  await expect(dialog).toBeHidden();
});

test("the office writes off a shortfall, refunds money and records the fee it paid", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, ACCOUNTS.admin);

  // Own the data: ₹3,00,000 sold, ₹50,000 advance by UPI, approved into a project.
  const client = `E2E Adjust ${Date.now()}`;
  await page.goto("/work-orders/new");
  await page.getByLabel(/client name/i).fill(client);
  await page.getByLabel(/plant capacity/i).fill("5kW");
  await page.getByLabel(/total cost/i).fill("300000");
  await page.getByLabel(/advance collected/i).fill("50000");
  await page.getByRole("combobox", { name: /advance method/i }).click();
  await page.getByRole("option", { name: "UPI" }).click();
  await page.getByLabel(/advance received on/i).fill("2025-02-04");
  await page.getByLabel(/advance reference/i).fill("UPI 5500112233");
  await page.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(page, "Work order created.");

  await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await page.getByRole("row").filter({ hasText: client }).click();
  await page.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(page, "Work order approved — project created.");
  await page.getByRole("link", { name: /view project/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?#]+/);

  const section = page.locator("#payments");
  await expect(
    section.getByText("Advance ₹50,000.00 · UPI · 04 Feb 2025 · UPI 5500112233"),
  ).toBeVisible();

  // The customer pays ₹2,49,200 — ₹800 short of the contract.
  let dialog = await openRecordDialog(page, section);
  await dialog.getByLabel(/amount/i).fill("249200");
  await dialog.getByLabel(/reference/i).fill("UTR SHORT 1");
  await dialog.getByRole("button", { name: /^record payment$/i }).click();
  await expectFlash(page, "Payment of ₹2,49,200.00 recorded.");
  await expect(summaryValue(section, "Balance due")).toHaveText("₹800.00");

  // Writing the ₹800 off: the dialog shows the balance, holds the amount to it,
  // needs a reason, and says it is for good.
  await section.getByRole("button", { name: /write off balance/i }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Balance due")).toBeVisible();
  await expect(dialog.getByLabel(/amount to write off/i)).toHaveValue("800");
  await expect(dialog.getByRole("note")).toContainText(/closes ₹800\.00 of the balance for good/i);
  await expect(dialog.getByRole("note")).toContainText(/only the superadmin can undo it/i);

  await dialog.getByLabel(/amount to write off/i).fill("900");
  await expect(dialog.getByText(/cannot be more than the ₹800\.00 balance due/i)).toBeVisible();
  await dialog.getByLabel(/amount to write off/i).fill("800");

  // No reason: the browser stops it, and nothing is written.
  await dialog.getByRole("button", { name: /^write off/i }).click();
  await expect(dialog).toBeVisible();
  await expect(summaryValue(section, "Balance due")).toHaveText("₹800.00");

  await dialog.getByLabel(/reason/i).fill("Customer was short at handover; waived by the office");
  await dialog.getByRole("button", { name: /^write off/i }).click();
  await expectFlash(page, /₹800\.00 written off — the balance is settled/i);
  await expect(dialog).toBeHidden();

  await expect(section.getByText("Settled — ₹800.00 written off")).toBeVisible();
  await expect(summaryValue(section, "Balance due")).toHaveText("₹0.00");
  await expect(
    ledgerRow(section, "Write-off").getByText(
      "Written off — Customer was short at handover; waived by the office",
    ),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: /write off balance/i })).toHaveCount(0);

  // ₹10,000 goes back to the customer: the net received falls, ₹10,000 is due
  // again, and the project carries on as a live one.
  dialog = await openRecordDialog(page, section);
  await chooseKind(page, dialog, "Refund");
  await dialog.getByLabel(/amount/i).fill("10000");
  await dialog.getByLabel(/reference/i).fill("UTR REFUND 1");
  await dialog.getByRole("button", { name: /^record refund$/i }).click();
  await expectFlash(page, "Refund of ₹10,000.00 recorded.");
  await expect(dialog).toBeHidden();

  await expect(summaryValue(section, "Refunded")).toHaveText("−₹10,000.00");
  await expect(summaryValue(section, "Net received")).toHaveText("₹2,89,200.00");
  await expect(summaryValue(section, "Balance due")).toHaveText("₹10,000.00");
  await expect(ledgerRow(section, "Refund")).toContainText("−₹10,000.00");
  await expect(section.getByText(/nothing due —/i)).toHaveCount(0);
  await expect(section.getByRole("button", { name: /edit refund/i }).first()).toBeVisible();

  // A refund can never exceed what was collected (₹2,89,200 after this one).
  dialog = await openRecordDialog(page, section);
  await chooseKind(page, dialog, "Refund");
  await dialog.getByLabel(/amount/i).fill("289200.01");
  await dialog.getByRole("button", { name: /^record refund$/i }).click();
  await expect(dialog.getByRole("alert")).toContainText(/more than the ₹2,89,200\.00 collected/i);
  await expect(dialog.getByLabel(/amount/i)).toHaveValue("289200.01");
  await dialog.getByRole("button", { name: /cancel/i }).click();
  await expect(dialog).toBeHidden();

  // A KSEB fee the office paid is kept apart from the contract.
  dialog = await openRecordDialog(page, section);
  await chooseKind(page, dialog, "KSEB fee paid by the office");
  await dialog.getByLabel(/amount/i).fill("5720");
  await dialog.getByRole("button", { name: /^record payment$/i }).click();
  await expectFlash(page, /KSEB fee of ₹5,720\.00 recorded as paid by the office/i);
  await expect(dialog).toBeHidden();

  await expect(summaryValue(section, "KSEB fees paid by office")).toHaveText("₹5,720.00");
  await expect(summaryValue(section, "Balance due")).toHaveText("₹10,000.00");
  await expect(ledgerRow(section, "KSEB fee 1").getByText("Paid by office")).toBeVisible();

  // The work order's page shows the very same pieces.
  await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await page.getByRole("row").filter({ hasText: client }).click();
  await expect(page.getByText("Advance ₹50,000.00 · UPI · 04 Feb 2025 · UPI 5500112233")).toBeVisible();
  await expect(summaryValue(page.locator("body"), "Net received")).toHaveText("₹2,89,200.00");
  await expect(summaryValue(page.locator("body"), "KSEB fees paid by office")).toHaveText(
    "₹5,720.00",
  );
});
