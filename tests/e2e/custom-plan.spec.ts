import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * A custom plan ("Inverter + panel", "1 panel") is not a kW solar plant: no
 * KSEB registration estimate, no feasibility, and a project with one Handover
 * step. The plan label is what it sold; typing "1 panel" as a solar capacity is
 * refused with a pointer to Custom plan.
 *
 * The sale is created here (office as coordinator) so no seeded row is used.
 */

/** The summary-card row (term + value) with the given label. */
function summaryRow(page: Page, label: RegExp) {
  return page.locator("dt", { hasText: label }).locator("xpath=..");
}

test("a custom plan is a single Handover step with no KSEB, and solar refuses '1 panel'", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  const client = `E2E Custom ${Date.now()}`;

  // As a solar plant "1 panel" would silently mean 1 kW: refused, with the way out.
  await admin.goto("/work-orders/new");
  await admin.getByLabel(/client name/i).fill(client);
  await admin.getByLabel(/plant capacity/i).fill("1 panel");
  await admin.getByLabel(/total cost/i).fill("40000");
  await admin.getByRole("button", { name: /create work order/i }).click();
  await expect(admin.getByText(/choose custom plan/i).first()).toBeVisible();
  await expect(admin).toHaveURL(/\/work-orders\/new/);

  // As a custom plan it is what was sold — and no KSEB estimate is offered.
  // (A fresh form: a refused one may not keep what was typed.)
  await admin.goto("/work-orders/new");
  await admin.getByLabel(/client name/i).fill(client);
  await admin.getByLabel(/total cost/i).fill("40000");
  await admin.getByLabel(/advance collected/i).fill("10000");
  // The radio is visually hidden inside its segmented-control label, which is
  // what a person taps.
  await admin.locator("label").filter({ hasText: /^custom plan$/i }).click();
  await expect(admin.getByRole("radio", { name: /custom plan/i })).toBeChecked();
  await admin.getByLabel(/what was sold/i).fill("Inverter + panel");
  await expect(admin.getByText(/KSEB registration ₹/)).toHaveCount(0);
  await expect(admin.getByText(/single Handover step/i)).toBeVisible();
  await admin.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(admin, /work order created/i);

  // Approve it into a project.
  await admin.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await admin.getByRole("row").filter({ hasText: client }).click();
  await admin.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(admin, "Work order approved — project created.");
  await admin.getByRole("link", { name: /view project/i }).click();
  await expect(admin).toHaveURL(/\/projects\/[^/?#]+/);
  await expect(admin.getByRole("heading", { name: client })).toBeVisible();

  // One step, named Handover; nothing about KSEB.
  await expect(admin.getByText("Custom plan", { exact: true }).first()).toBeVisible();
  await expect(summaryRow(admin, /^plan$/i)).toContainText("Inverter + panel");
  await expect(summaryRow(admin, /^current stage$/i)).toContainText("Handover");
  await expect(admin.getByLabel(/^status for/i)).toHaveCount(1);
  await expect(admin.getByLabel("Status for Handover")).toBeVisible();
  await expect(admin.getByText("KSEB / ANERT Milestones")).toHaveCount(0);
  await expect(
    admin.getByText("Custom plan — no KSEB registration or feasibility."),
  ).toBeVisible();
  await expect(admin.getByText("Feasibility validity")).toHaveCount(0);
  await expect(admin.getByLabel(/kseb feasibility date/i)).toHaveCount(0);
  await expect(admin.getByRole("button", { name: /complete next milestone/i })).toHaveCount(0);

  // Handing it over completes the project — with ₹30,000 still to collect.
  await admin.getByRole("button", { name: /mark handed over/i }).click();
  await expect(summaryRow(admin, /^status$/i)).toContainText("Handed over");
  await expect(summaryRow(admin, /^payment$/i)).toContainText(/payment pending · ₹30,000/i);
  await expect(admin.getByRole("button", { name: /mark handed over/i })).toHaveCount(0);

  // Refunded: whatever was outstanding is no longer owed.
  await admin.getByRole("button", { name: "Mark refunded" }).click();
  const dialog = admin.getByRole("dialog", { name: /cancel or refund this project/i });
  await dialog.getByLabel(/remarks/i).fill("Customer returned the equipment; refunded in full");
  await dialog.getByRole("button", { name: "Mark refunded" }).click();
  await expectFlash(admin, /project marked refunded/i);
  await expect(summaryRow(admin, /^payment$/i)).toContainText(/nothing due — refunded/i);
  await expect(summaryRow(admin, /^payment$/i)).not.toContainText(/payment pending/i);
  await admin.context().close();
});
