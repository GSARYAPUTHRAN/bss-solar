import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * The project tracker (board and list) and the dashboard with cancelled and
 * refunded projects, custom plans and shared coordinators.
 *
 * The specs own their data: the office imports a handful of projects through
 * Onboarding (one live, one shared, one custom plan, one cancelled, one refunded)
 * under a name prefix unique to the run, and every list is narrowed to it with
 * `?q=`, so nothing here depends on the seed rows or on global counts. The
 * dashboard assertions are deltas around that import.
 */
test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const PREFIX = `E2E Lists ${STAMP}`;
const LIVE = `${PREFIX} Live`;
const SHARED = `${PREFIX} Shared`;
const CUSTOM = `${PREFIX} Custom`;
const CANCELLED = `${PREFIX} Cancelled`;
const REFUNDED = `${PREFIX} Refunded`;

const RAHUL = ACCOUNTS.rahul;
const PRIYA = ACCOUNTS.priya;
const ARUN = ACCOUNTS.arun;
const TEAM = `${RAHUL.fullName} & ${PRIYA.fullName}`;

const COLUMNS = [
  "client_name",
  "plant_capacity",
  "total_cost",
  "order_date",
  "coordinator",
  "plan_type",
  "cancellation",
  "cancelled_on",
  "cancellation_remarks",
  "coordinator_incentive",
] as const;

function csvLine(cells: Partial<Record<(typeof COLUMNS)[number], string>>): string {
  return COLUMNS.map((c) => cells[c] ?? "").join(",");
}

const CSV = [
  COLUMNS.join(","),
  // Live, solar, Rahul's own, with an incentive still to pay.
  csvLine({
    client_name: LIVE,
    plant_capacity: "3kW",
    total_cost: "195000",
    order_date: "2026-03-10",
    coordinator: RAHUL.email,
    coordinator_incentive: "5000",
  }),
  // Shared by Rahul and Priya.
  csvLine({
    client_name: SHARED,
    plant_capacity: "4kW",
    total_cost: "260000",
    order_date: "2026-03-11",
    coordinator: `${RAHUL.email} & ${PRIYA.email}`,
  }),
  // A custom plan: what was sold, not a kW capacity.
  csvLine({
    client_name: CUSTOM,
    plant_capacity: "Inverter + panel",
    total_cost: "45000",
    order_date: "2026-03-12",
    coordinator: RAHUL.email,
    plan_type: "custom",
  }),
  csvLine({
    client_name: CANCELLED,
    plant_capacity: "3kW",
    total_cost: "195000",
    order_date: "2026-02-01",
    coordinator: RAHUL.email,
    cancellation: "cancelled",
    cancelled_on: "2026-03-01",
    cancellation_remarks: "E2E customer withdrew",
  }),
  // Refunded, and Arun's: neither Rahul nor Priya may see it.
  csvLine({
    client_name: REFUNDED,
    plant_capacity: "5kW",
    total_cost: "310000",
    order_date: "2026-02-02",
    coordinator: ARUN.email,
    cancellation: "refunded",
    cancelled_on: "2026-03-02",
    cancellation_remarks: "E2E refunded in full",
  }),
].join("\n");

interface Counts {
  active: number;
  commissioned: number;
  closed: number;
  cancelled: number;
  refunded: number;
}

/** The tile's figure: the paragraph after its label. */
async function tileValue(page: Page, label: RegExp): Promise<number> {
  const text = await page.getByText(label).locator("xpath=following-sibling::p[1]").innerText();
  return Number(text.replaceAll(",", "").trim());
}

async function dashboardCounts(page: Page): Promise<Counts> {
  await page.goto("/");
  await expect(page.getByText(/^active projects$/i)).toBeVisible();
  const closedLabel = page.getByText(/^cancelled \/ refunded$/i);
  const hint = await closedLabel.locator("xpath=following-sibling::p[2]").innerText();
  const split = /(\d+) cancelled · (\d+) refunded/.exec(hint);
  if (!split) throw new Error(`unexpected closed-projects hint: ${hint}`);
  return {
    active: await tileValue(page, /^active projects$/i),
    commissioned: await tileValue(page, /^commissioned$/i),
    closed: await tileValue(page, /^cancelled \/ refunded$/i),
    cancelled: Number(split[1]),
    refunded: Number(split[2]),
  };
}

/** The list narrowed to this run's projects, plus any filters. */
function listUrl(filters: Record<string, string> = {}): string {
  const params = new URLSearchParams({ view: "list", q: PREFIX, ...filters });
  return `/projects?${params.toString()}`;
}

function row(page: Page, client: string) {
  return page.getByRole("row").filter({ hasText: client });
}

/**
 * The status badge itself (the client's name also contains "Cancelled"). A row
 * carries one copy for the phone summary and one in the stage column; only one
 * of them is shown at any width.
 */
function badge(page: Page, client: string, text: string) {
  return row(page, client).getByText(text, { exact: true }).filter({ visible: true });
}

async function chooseFilter(page: Page, filter: string, option: string) {
  await page.getByRole("combobox", { name: filter, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** The board card of the shared sale (other shared sales may be on the board too). */
function sharedCard(page: Page) {
  return page.getByRole("link").filter({ hasText: SHARED });
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

let before: Counts;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  before = await dashboardCounts(admin);

  await admin.goto("/onboarding");
  await admin.getByLabel("CSV data").fill(CSV);
  await admin.getByRole("button", { name: /import projects/i }).click();
  await expect(admin.getByRole("button", { name: /^5 imported$/i })).toBeVisible();
  await admin.context().close();
});

test("the dashboard counts the new projects as active or out of the pipeline", async ({
  browser,
}) => {
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  const after = await dashboardCounts(admin);

  // Live, shared and custom are in the pipeline; cancelled and refunded are not.
  expect(after.active).toBe(before.active + 3);
  expect(after.commissioned).toBe(before.commissioned);
  expect(after.closed).toBe(before.closed + 2);
  expect(after.cancelled).toBe(before.cancelled + 1);
  expect(after.refunded).toBe(before.refunded + 1);

  await admin.getByText(/^active projects$/i).scrollIntoViewIfNeeded();
  await expect(admin.getByText(/excludes cancelled and refunded/i).first()).toBeVisible();

  // The tile opens the closed list.
  await admin.getByRole("link", { name: /cancelled \/ refunded/i }).click();
  await expect(admin).toHaveURL(/\/projects\?view=list&status=closed/);
  await expect(admin.getByRole("combobox", { name: "Status", exact: true })).toContainText(
    /cancelled or refunded/i,
  );
  await expect(row(admin, REFUNDED)).toBeVisible();
  await expect(row(admin, CANCELLED)).toBeVisible();
  await expect(row(admin, LIVE)).toHaveCount(0);
  await admin.context().close();
});

test("the project list filters by status, plan and any coordinator on a sale", async ({
  browser,
}) => {
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto(listUrl());
  for (const client of [LIVE, SHARED, CUSTOM, CANCELLED, REFUNDED]) {
    await expect(row(admin, client)).toBeVisible();
  }

  await test.step("every coordinator of a shared sale is named", async () => {
    await expect(row(admin, SHARED)).toContainText(TEAM);
    await expect(row(admin, LIVE)).toContainText(RAHUL.fullName);
    await expect(row(admin, LIVE)).not.toContainText(PRIYA.fullName);
  });

  await test.step("cancelled and refunded projects say so, and nothing is due", async () => {
    await expect(badge(admin, CANCELLED, "Cancelled")).toBeVisible();
    await expect(badge(admin, REFUNDED, "Refunded")).toBeVisible();
    await expect(row(admin, REFUNDED)).toContainText(/nothing due — refunded/i);
  });

  await test.step("the incentive column shows the total and its state", async () => {
    await expect(row(admin, LIVE)).toContainText("₹5,000");
    await expect(row(admin, LIVE)).toContainText(/pending/i);
    await expect(row(admin, CUSTOM)).not.toContainText("₹5,000");
  });

  await test.step("Active leaves the closed projects out", async () => {
    await chooseFilter(admin, "Status", "Active");
    await expect(admin).toHaveURL(/status=active/);
    await expect(row(admin, LIVE)).toBeVisible();
    await expect(row(admin, CUSTOM)).toBeVisible();
    await expect(row(admin, CANCELLED)).toHaveCount(0);
    await expect(row(admin, REFUNDED)).toHaveCount(0);
  });

  await test.step("Refunded shows only the refunded project", async () => {
    await chooseFilter(admin, "Status", "Refunded");
    await expect(admin).toHaveURL(/status=refunded/);
    await expect(row(admin, REFUNDED)).toBeVisible();
    await expect(row(admin, CANCELLED)).toHaveCount(0);
    await expect(row(admin, LIVE)).toHaveCount(0);
  });

  await test.step("Cancelled or refunded shows both", async () => {
    await chooseFilter(admin, "Status", "Cancelled or refunded");
    await expect(admin).toHaveURL(/status=closed/);
    await expect(row(admin, REFUNDED)).toBeVisible();
    await expect(row(admin, CANCELLED)).toBeVisible();
    await expect(row(admin, SHARED)).toHaveCount(0);
  });

  await test.step("the Plan filter finds the custom plan", async () => {
    await admin.goto(listUrl());
    await chooseFilter(admin, "Plan", "Custom plan");
    await expect(admin).toHaveURL(/plan=custom/);
    await expect(row(admin, CUSTOM)).toBeVisible();
    await expect(row(admin, CUSTOM)).toContainText("Inverter + panel");
    await expect(row(admin, CUSTOM)).toContainText(/custom plan/i);
    await expect(row(admin, LIVE)).toHaveCount(0);
  });

  await test.step("a coordinator filter matches a partner, not only the first coordinator", async () => {
    await admin.goto(listUrl());
    await chooseFilter(admin, "Coordinator", PRIYA.fullName);
    await expect(admin).toHaveURL(/coordinator=/);
    await expect(row(admin, SHARED)).toBeVisible();
    await expect(row(admin, LIVE)).toHaveCount(0);
    await expect(row(admin, REFUNDED)).toHaveCount(0);
  });

  await test.step("the Incentive column sorts by the sale's total", async () => {
    await admin.goto(listUrl());
    await admin.getByRole("button", { name: /^sort by incentive$/i }).click();
    await expect(admin).toHaveURL(/sort=incentive_total/);
    // Projects without an incentive sort last whichever way it goes.
    await expect(admin.getByRole("row").nth(1)).toContainText(LIVE);
    await admin.getByRole("button", { name: /^sort by incentive$/i }).click();
    await expect(admin).toHaveURL(/dir=desc/);
    await expect(admin.getByRole("row").nth(1)).toContainText(LIVE);
  });
  await admin.context().close();
});

test("the board has a lane for custom plans and keeps closed projects off the default view", async ({
  browser,
}) => {
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  await admin.goto("/projects");

  const card = (client: string) => admin.getByText(client, { exact: true });

  await test.step("active projects sit in their stage, custom plans in their own lane", async () => {
    await expect(
      admin.getByRole("region", { name: "Site Feasibility Survey" }).getByText(LIVE),
    ).toBeVisible();
    const custom = admin.getByRole("region", { name: "Custom plans" });
    await expect(custom.getByText(CUSTOM)).toBeVisible();
    await expect(custom.getByText(/custom plan/i).first()).toBeVisible();
    // Stored at the handover stage, but not shown in a KSEB column.
    await expect(
      admin.getByRole("region", { name: "Plant Commissioning" }).getByText(CUSTOM),
    ).toHaveCount(0);
    // The custom lane comes before stage 1.
    const customBox = await custom.boundingBox();
    const firstStageBox = await admin
      .getByRole("region", { name: "Site Feasibility Survey" })
      .boundingBox();
    expect(customBox).not.toBeNull();
    expect(firstStageBox).not.toBeNull();
    expect(customBox!.x).toBeLessThan(firstStageBox!.x);
  });

  await test.step("a shared sale shows everyone on it", async () => {
    await expect(sharedCard(admin)).toContainText(TEAM);
  });

  await test.step("cancelled and refunded projects only appear when asked for", async () => {
    await expect(card(CANCELLED)).toHaveCount(0);
    await expect(card(REFUNDED)).toHaveCount(0);

    await chooseFilter(admin, "Project status", "Refunded");
    await expect(card(REFUNDED)).toBeVisible();
    await expect(card(CANCELLED)).toHaveCount(0);
    await expect(card(LIVE)).toHaveCount(0);

    await chooseFilter(admin, "Project status", "Cancelled or refunded");
    await expect(card(REFUNDED)).toBeVisible();
    await expect(card(CANCELLED)).toBeVisible();
  });
  await admin.context().close();
});

test("a coordinator on a phone sees who they share a sale with, their own incentive and no sideways scroll", async ({
  browser,
}) => {
  const rahul = await signedInPage(browser, RAHUL);
  await rahul.setViewportSize({ width: 375, height: 812 });
  await rahul.goto(listUrl());

  await expect(row(rahul, SHARED)).toBeVisible();
  await expect(row(rahul, SHARED)).toContainText(`with ${PRIYA.fullName}`);
  // A sale of their own says nothing about partners.
  await expect(row(rahul, LIVE)).not.toContainText(/\bwith\b/);
  // Their own incentive, worded as theirs.
  await expect(row(rahul, LIVE)).toContainText(/your incentive\s*₹5,000(\.00)?\s*pending/i);
  await expect(badge(rahul, CANCELLED, "Cancelled")).toBeVisible();
  // Another coordinator's refunded sale is not theirs to see.
  await expect(row(rahul, REFUNDED)).toHaveCount(0);
  // The office-only coordinator filter is not offered.
  await expect(rahul.getByRole("combobox", { name: "Coordinator", exact: true })).toHaveCount(0);
  expect(await hasHorizontalOverflow(rahul)).toBe(false);

  await rahul.goto("/projects");
  await expect(sharedCard(rahul)).toContainText(`with ${PRIYA.fullName}`);
  await expect(rahul.getByRole("region", { name: "Custom plans" }).getByText(CUSTOM)).toBeVisible();
  expect(await hasHorizontalOverflow(rahul)).toBe(false);
  await rahul.context().close();
});

test("a partner sees the shared sale with their co-coordinator, and none of Rahul's own", async ({
  browser,
}) => {
  const priya = await signedInPage(browser, PRIYA);
  await priya.goto(listUrl());

  await expect(row(priya, SHARED)).toBeVisible();
  await expect(row(priya, SHARED)).toContainText(RAHUL.fullName);
  await expect(row(priya, LIVE)).toHaveCount(0);
  await expect(row(priya, CUSTOM)).toHaveCount(0);
  await priya.context().close();
});

test("marking a live project refunded takes it out of the active count", async ({ browser }) => {
  const admin = await signedInPage(browser, ACCOUNTS.admin);
  const start = await dashboardCounts(admin);

  await admin.goto(listUrl());
  await row(admin, LIVE).click();
  await expect(admin).toHaveURL(/\/projects\/[^/?#]+/);
  await expect(admin.getByRole("heading", { name: LIVE })).toBeVisible();

  // Project status section (office): the dialog opens with Refunded chosen.
  await admin.getByRole("button", { name: /^mark refunded$/i }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/remarks/i).fill("E2E refunded to the customer");
  await dialog.getByRole("button", { name: /^mark refunded$/i }).click();
  await expectFlash(admin, /project marked refunded/i);

  const end = await dashboardCounts(admin);
  expect(end.active).toBe(start.active - 1);
  expect(end.closed).toBe(start.closed + 1);
  expect(end.refunded).toBe(start.refunded + 1);
  expect(end.cancelled).toBe(start.cancelled);

  // And it now shows as refunded in the list.
  await admin.goto(listUrl({ status: "refunded" }));
  await expect(row(admin, LIVE)).toBeVisible();
  await expect(row(admin, REFUNDED)).toBeVisible();
  await admin.context().close();
});
