import { test, expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signIn, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * The office deletes (Admin and Super Admin — DELETE_ROLES / can_delete()): a
 * whole sale from its work order page or its project page, a project, a ledger
 * entry, a coordinator's incentive, and team members — with the admin kept off
 * other admins and the Super Admin seat.
 *
 * Every test deletes only what it created itself, under a name stamped with the
 * run, so it can run again on the same database and never touches the seeded
 * sales (support/seed-sales.ts) or the accounts other specs sign in with.
 */

const PASSWORD = "Office-Delete@2026";

/** A fresh, letters-and-digits token: unique per call, safe in the lists' search. */
function stamp(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `text` exactly, ignoring case — for accessible names. */
const exactly = (text: string) => new RegExp(`^${escapeRegExp(text)}$`, "i");

/**
 * Log a ₹3,00,000 sale through New Work Order and open it. With `forRahul` the
 * office logs it for Rahul (not itself), so he has an incentive on it. Returns
 * the work order's id.
 */
async function createSale(
  page: Page,
  client: string,
  { forRahul = false }: { forRahul?: boolean } = {},
): Promise<string> {
  await page.goto("/work-orders/new");
  await page.getByLabel(/client name/i).fill(client);
  await page.getByLabel(/plant capacity/i).fill("5kW");
  await page.getByLabel(/total cost/i).fill("300000");
  if (forRahul) {
    const team = page.getByRole("group", { name: "Coordinators" });
    await team.getByRole("button", { name: "Add coordinator" }).click();
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole("button", { name: new RegExp(ACCOUNTS.rahul.fullName) })
      .click();
    await team.getByRole("button", { name: `Remove ${ACCOUNTS.admin.fullName}` }).click();
  }
  await page.getByRole("button", { name: /create work order/i }).click();
  await expectFlash(page, /work order created/i);

  await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
  await page.getByRole("row").filter({ hasText: client }).click();
  await expect(page).toHaveURL(/\/work-orders\/[^/?#]+/);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

/** Approve the open work order and go to its project. Returns the project's path. */
async function approveIntoProject(page: Page): Promise<string> {
  await page.getByRole("button", { name: /approve & create project/i }).click();
  await expectFlash(page, "Work order approved — project created.");
  await page.getByRole("link", { name: /view project/i }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?#]+/);
  return new URL(page.url()).pathname;
}

/** Record a stage payment from the project's Payments section. */
async function recordPayment(page: Page, amount: string, reference: string) {
  const section = page.locator("#payments");
  await section.getByRole("button", { name: /record payment/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/amount/i).fill(amount);
  await dialog.getByLabel(/reference/i).fill(reference);
  await dialog.getByRole("button", { name: /^record payment$/i }).click();
  await expect(dialog).toBeHidden();
}

/** The value beside a label of the Payments summary ("Balance due"). */
const summaryValue = (section: Locator, label: string) =>
  section
    .locator("dt", { hasText: new RegExp(`^${escapeRegExp(label)}$`) })
    .locator("xpath=following-sibling::dd");

/** Open a delete's confirmation and return it, checking it says what goes. */
async function openConfirmation(
  page: Page,
  trigger: Locator,
  title: RegExp,
): Promise<Locator> {
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/cannot be undone/i);
  return dialog;
}

test("an admin deletes a project, a payment left on its sale, then the sale from its work order page", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, ACCOUNTS.admin);
  const client = `E2E Delete WO ${stamp()}`;
  const workOrderId = await createSale(page, client);
  const project = await approveIntoProject(page);

  await test.step("a payment is recorded on the project, then the project is deleted", async () => {
    await recordPayment(page, "50000", "UTR DEL WO 1");
    await expectFlash(page, "Payment of ₹50,000.00 recorded.");

    const dialog = await openConfirmation(
      page,
      page.getByRole("button", { name: /^delete project$/i }),
      /delete this project\?/i,
    );
    await expect(dialog).toContainText(/its work order is returned to pending/i);
    await dialog.getByRole("button", { name: /^delete project$/i }).click();
    await expectFlash(page, "Project deleted — its work order is pending again.");
    await expect(page).toHaveURL(/\/projects(\?|$)/);

    await page.goto(project);
    await expect(page.getByText(/page not found/i).first()).toBeVisible();
  });

  await test.step("with no project, the payment is deleted on the work order's own ledger", async () => {
    await page.goto(`/work-orders/${workOrderId}`);
    // Back to pending: it can be approved again.
    await expect(page.getByRole("button", { name: /approve & create project/i })).toBeVisible();
    const dialog = await openConfirmation(
      page,
      page.getByRole("button", { name: /^delete stage 1 payment$/i }),
      /delete this payment\?/i,
    );
    await expect(dialog).toContainText(/stage 1 · ₹50,000\.00 received/i);
    await expect(dialog).toContainText(/the balance due goes back up/i);
    await dialog.getByRole("button", { name: /^delete payment$/i }).click();
    await expectFlash(page, "Payment deleted.");
    await expect(page).toHaveURL(new RegExp(`/work-orders/${workOrderId}`));
    await expect(page.getByText(/no instalments recorded after the advance yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^delete stage/i })).toHaveCount(0);
  });

  await test.step("the sale is deleted from its page, and is gone from the list", async () => {
    // Nothing is left on it but the sale itself, and the confirmation says so.
    const dialog = await openConfirmation(
      page,
      page.getByRole("button", { name: /^delete$/i }),
      /delete this work order\?/i,
    );
    await expect(dialog).toContainText(
      `This permanently deletes the sale ${client} and every coordinator's incentive.`,
    );
    // Cancel leaves it alone.
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/work-orders/${workOrderId}`));

    const again = await openConfirmation(
      page,
      page.getByRole("button", { name: /^delete$/i }),
      /delete this work order\?/i,
    );
    await again.getByRole("button", { name: /^delete work order$/i }).click();
    await expectFlash(page, "Work order deleted.");
    await expect(page).toHaveURL(/\/work-orders(\?|$)/);

    await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
    await expect(page.getByRole("heading", { name: /work orders/i }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: client })).toHaveCount(0);
    await page.goto(`/work-orders/${workOrderId}`);
    await expect(page.getByText(/page not found/i).first()).toBeVisible();
  });
});

test("on a project, an admin deletes a ledger entry and a coordinator's incentive, then the whole sale", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, ACCOUNTS.admin);
  const client = `E2E Delete Sale ${stamp()}`;
  const rahul = ACCOUNTS.rahul.fullName;
  const workOrderId = await createSale(page, client, { forRahul: true });
  const project = await approveIntoProject(page);
  const section = page.locator("#payments");

  await test.step("a payment the admin recorded is deleted, and the balance goes back up", async () => {
    await recordPayment(page, "100000", "UTR DEL 1");
    await expectFlash(page, "Payment of ₹1,00,000.00 recorded.");
    await expect(summaryValue(section, "Balance due")).toHaveText("₹2,00,000.00");

    const dialog = await openConfirmation(
      page,
      section.getByRole("button", { name: /^delete stage 1 payment$/i }),
      /delete this payment\?/i,
    );
    await expect(dialog).toContainText(/stage 1 · ₹1,00,000\.00 received/i);
    await dialog.getByRole("button", { name: /^delete payment$/i }).click();
    await expectFlash(page, "Payment deleted.");
    await expect(page).toHaveURL(new RegExp(`${project}(\\?|#|$)`));
    await expect(section.getByText(/no instalments recorded yet/i)).toBeVisible();
    await expect(section.getByRole("table").getByText("UTR DEL 1")).toHaveCount(0);
    await expect(summaryValue(section, "Balance due")).toHaveText("₹3,00,000.00");
  });

  await test.step("an incentive with an instalment is deleted in one go; Rahul stays on the sale", async () => {
    const block = page.getByRole("group", { name: `Incentive for ${rahul}` });
    const deleteIncentive = block.getByRole("button", {
      name: exactly(`Delete ${rahul}'s incentive`),
    });
    // Nothing agreed yet: nothing to delete.
    await expect(deleteIncentive).toHaveCount(0);

    await block.getByLabel(/agreed amount/i).fill("6000");
    await block.getByRole("button", { name: "Save", exact: true }).click();
    await expectFlash(page, new RegExp(`incentive saved for ${rahul}`, "i"));

    await block.getByRole("button", { name: `Record payment for ${rahul}` }).click();
    const record = page.getByRole("dialog", { name: /record payment/i });
    await record.getByLabel(/^amount/i).fill("2000");
    await record.getByRole("button", { name: /^record payment$/i }).click();
    await expectFlash(page, /₹2,000(\.00)? recorded for Rahul Menon/i);
    await expect(record).toBeHidden();

    const dialog = await openConfirmation(
      page,
      deleteIncentive,
      exactly(`Delete ${rahul}'s incentive?`),
    );
    await expect(dialog).toContainText(
      /this removes the agreed amount of ₹6,000(\.00)? and its 1 payment \(₹2,000(\.00)?\)/i,
    );
    await expect(dialog).toContainText(`${rahul} stays on the sale with no incentive.`);
    await dialog.getByRole("button", { name: /^delete incentive$/i }).click();
    await expectFlash(page, `Incentive deleted for ${rahul}.`);
    await expect(dialog).toBeHidden();

    await expect(block).toBeVisible();
    await expect(block.locator('[data-slot="badge"]').filter({ hasText: /^Not set$/ })).toBeVisible();
    await expect(block.getByText(/set the agreed amount to start recording payments/i)).toBeVisible();
    await expect(block.getByLabel(/agreed amount/i)).toHaveValue("");
    await expect(deleteIncentive).toHaveCount(0);
  });

  await test.step("Delete sale removes the work order with its project, and lands on the projects", async () => {
    // "Delete project" (back to pending) and "Delete sale" (everything) sit together.
    await expect(page.getByRole("button", { name: /^delete project$/i })).toBeVisible();
    const dialog = await openConfirmation(
      page,
      page.getByRole("button", { name: /^delete sale$/i }),
      /delete this sale\?/i,
    );
    await expect(dialog).toContainText(
      `This permanently deletes the sale ${client}, its project and milestones and every coordinator's incentive.`,
    );
    await expect(dialog).toContainText(/service tickets stay but lose their link to the project/i);
    await dialog.getByRole("button", { name: /^delete sale$/i }).click();
    await expectFlash(page, "Sale deleted.");
    await expect(page).toHaveURL(/\/projects(\?|$)/);

    await page.goto(`/work-orders?q=${encodeURIComponent(client)}`);
    await expect(page.getByRole("heading", { name: /work orders/i }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: client })).toHaveCount(0);
    await page.goto(project);
    await expect(page.getByText(/page not found/i).first()).toBeVisible();
    await page.goto(`/work-orders/${workOrderId}`);
    await expect(page.getByText(/page not found/i).first()).toBeVisible();
  });
});

test.describe("team members", () => {
  /** Add a member through Team → Add member and wait for its confirmation toast. */
  async function addMember(
    page: Page,
    member: { name: string; email: string; role?: "Admin" },
  ): Promise<void> {
    await page.goto("/team/new");
    await page.getByLabel(/full name/i).fill(member.name);
    await page.getByLabel(/^email/i).fill(member.email);
    await page.getByLabel(/^password/i).fill(PASSWORD);
    if (member.role) {
      await page.getByRole("combobox", { name: /^role/i }).click();
      await page.getByRole("option", { name: exactly(member.role) }).click();
    }
    await page.getByRole("button", { name: /add member/i }).click();
    await expectFlash(page, /team member added/i);
  }

  /** The Team list narrowed to `search` (the list's own search, through the URL). */
  async function openList(page: Page, search: string): Promise<void> {
    await page.goto(`/team?q=${encodeURIComponent(search)}`);
    await expect(page.getByRole("heading", { name: /team management/i })).toBeVisible();
  }

  const rowOf = (page: Page, name: string) =>
    page.getByRole("row").filter({ hasText: new RegExp(escapeRegExp(name), "i") });

  const deleteButton = (page: Page, name: string) =>
    rowOf(page, name).getByRole("button", { name: exactly(`Delete ${name}`) });

  /** Delete `name` from the Team list, through its confirmation. */
  async function deleteMember(page: Page, name: string, roleLabel: string): Promise<void> {
    const dialog = await openConfirmation(
      page,
      deleteButton(page, name),
      exactly(`Delete ${name}?`),
    );
    await expect(dialog).toContainText(/permanently removes the staff account and its sign-in/i);
    await dialog.getByRole("button", { name: /^delete member$/i }).click();
    await expectFlash(page, `${name} (${roleLabel}) was deleted.`);
  }

  test("an admin deletes a coordinator they added, but never an admin or the Super Admin; the Super Admin may delete an admin", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const token = stamp();
    const coordinator = `Del Coord ${token}`;
    const admin = `Del Admin ${token}`;
    await signIn(page, ACCOUNTS.admin);
    await addMember(page, { name: coordinator, email: `del-coord-${token}@bsssolar.test` });
    await addMember(page, { name: admin, email: `del-admin-${token}@bsssolar.test`, role: "Admin" });

    await test.step("the admin is offered Delete on the coordinator only", async () => {
      await openList(page, token);
      await expect(rowOf(page, coordinator)).toBeVisible();
      await expect(rowOf(page, admin)).toBeVisible();
      await expect(deleteButton(page, coordinator)).toBeVisible();
      await expect(rowOf(page, admin).getByRole("button", { name: /^delete /i })).toHaveCount(0);

      // Nor on the Super Admin's seat, nor on their own row.
      await openList(page, ACCOUNTS.superadmin.fullName);
      await expect(rowOf(page, ACCOUNTS.superadmin.fullName)).toBeVisible();
      await expect(
        rowOf(page, ACCOUNTS.superadmin.fullName).getByRole("button", { name: /^delete /i }),
      ).toHaveCount(0);
      await openList(page, ACCOUNTS.admin.fullName);
      await expect(rowOf(page, ACCOUNTS.admin.fullName).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^delete /i })).toHaveCount(0);
    });

    await test.step("the admin deletes the coordinator", async () => {
      await openList(page, token);
      await deleteMember(page, coordinator, "Coordinator");
      await openList(page, token);
      await expect(rowOf(page, admin)).toBeVisible();
      await expect(rowOf(page, coordinator)).toHaveCount(0);
    });

    await test.step("the Super Admin is offered Delete on admins, and deletes the one added here", async () => {
      const superadmin = await signedInPage(browser, ACCOUNTS.superadmin);
      // The seeded admin is only looked at: other specs sign in with it.
      await openList(superadmin, ACCOUNTS.admin.fullName);
      await expect(deleteButton(superadmin, ACCOUNTS.admin.fullName)).toBeVisible();

      await openList(superadmin, token);
      await expect(deleteButton(superadmin, admin)).toBeVisible();
      await deleteMember(superadmin, admin, "Admin");
      await openList(superadmin, token);
      await expect(rowOf(superadmin, admin)).toHaveCount(0);

      // Both deletes are in the log, each under who made it.
      await superadmin.goto("/work-orders/duplicates");
      const log = superadmin.getByRole("list", { name: /recent deletes/i });
      const entry = (name: string) => log.locator(":scope > li").filter({ hasText: name });
      await expect(entry(admin)).toContainText(`Team member — ${admin} (Admin)`);
      await expect(entry(admin)).toContainText(ACCOUNTS.superadmin.fullName);
      await expect(entry(coordinator)).toContainText(`Team member — ${coordinator} (Coordinator)`);
      await expect(entry(coordinator)).toContainText(ACCOUNTS.admin.fullName);
      await superadmin.context().close();
    });
  });
});
