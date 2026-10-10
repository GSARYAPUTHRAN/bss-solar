import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };

async function openOnboardingAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);

  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: /import existing projects/i }),
  ).toBeVisible();
}

async function importCsv(page: Page, csv: string) {
  await page.getByLabel("CSV data").fill(csv);
  await page.getByRole("button", { name: /import projects/i }).click();
}

const PAYMENT_COLUMNS = [1, 2, 3, 4].flatMap((n) =>
  ["amount", "date", "method", "purpose", "reference"].map((f) => `payment_${n}_${f}`),
);

const HEADER = [
  "client_name",
  "plant_capacity",
  "total_cost",
  "advance_amount",
  "order_date",
  "coordinator_email",
  "financing_type",
  "loan_bank_name",
  "consumer_number",
  "kseb_section",
  "current_stage",
  "is_completed",
  "commissioned_on",
  "feasibility_date",
  "coordinator_incentive",
  "incentive_paid_on",
  ...PAYMENT_COLUMNS,
];

/** A CSV line in HEADER order from the named cells (the rest blank). */
function line(cells: Record<string, string>): string {
  return HEADER.map((h) => {
    const v = cells[h] ?? "";
    return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  }).join(",");
}

test("admin bulk imports projects with staged payments, KSEB and incentive columns", async ({
  page,
}) => {
  await openOnboardingAsAdmin(page);

  const stamp = Date.now();
  const loanClient = `E2E Loan ${stamp}`;
  const dueClient = `E2E Commissioned ${stamp}`;
  const ghostClient = `E2E Ghost Coordinator ${stamp}`;
  const csv = [
    HEADER.join(","),
    // In progress on a bank loan, paid in four stages (one of them KSEB fees).
    line({
      client_name: loanClient,
      plant_capacity: "3kW",
      total_cost: "195000",
      advance_amount: "20000",
      order_date: "2026-06-15",
      coordinator_email: "coord@bsssolar.test",
      financing_type: "loan",
      loan_bank_name: "State Bank of India",
      consumer_number: `${stamp}1`,
      kseb_section: "Vytilla",
      current_stage: "panel_installation",
      feasibility_date: "2026-08-20",
      coordinator_incentive: "5000",
      payment_1_amount: "40000",
      payment_1_date: "2026-06-30",
      payment_1_method: "UPI",
      payment_2_amount: "4540",
      payment_2_date: "2026-07-10",
      payment_2_method: "cash",
      payment_2_purpose: "kseb_fees",
      payment_3_amount: "60000",
      payment_3_date: "2026-08-28",
      payment_3_method: "loan_disbursement",
      payment_4_amount: "50000",
      payment_4_date: "2026-09-25",
      payment_4_method: "Bank transfer",
      payment_4_reference: "NEFT SBIN0001234",
    }),
    // Commissioned, self-financed, ₹50,000 still due.
    line({
      client_name: dueClient,
      plant_capacity: "5kW",
      total_cost: "310000",
      advance_amount: "50000",
      order_date: "2026-03-02",
      financing_type: "self",
      consumer_number: `${stamp}2`,
      is_completed: "yes",
      commissioned_on: "2026-05-05",
      feasibility_date: "2026-04-10",
      payment_1_amount: "150000",
      payment_1_date: "2026-04-15",
      payment_2_amount: "60000",
      payment_2_date: "2026-05-25",
    }),
    // Valid in the sheet, refused by the database: no such coordinator.
    line({
      client_name: ghostClient,
      plant_capacity: "2kW",
      total_cost: "130000",
      coordinator_email: `ghost-${stamp}@bsssolar.test`,
    }),
    // Refused by validation: no capacity, and a payment group with no date.
    line({
      client_name: "E2E No Capacity",
      total_cost: "100000",
      payment_1_amount: "1000",
    }),
  ].join("\n");

  await test.step("first upload imports the valid rows and reports the rest", async () => {
    await importCsv(page, csv);

    await expect(page.getByRole("button", { name: /^2 imported$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^0 skipped$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^2 failed$/i })).toBeVisible();

    await expect(
      page.getByText(/Imported at Panel Installation · 4 payments recorded/i),
    ).toBeVisible();
    await expect(page.getByText(/Commissioned · ₹50,000(\.00)? outstanding/i)).toBeVisible();
    await expect(
      page.getByText(/is not a coordinator or office account/i),
    ).toBeVisible();
    await expect(page.getByText(/plant_capacity is required/i)).toBeVisible();
    await expect(page.getByText(/payment_1_date is required/i)).toBeVisible();
  });

  await test.step("the failed rows download carries the reason per row", async () => {
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: /download failed rows/i }).click();
    const body = await readFile(await (await downloading).path(), "utf8");
    expect(body).toContain("import_error");
    expect(body).toContain(ghostClient);
    expect(body).toContain("E2E No Capacity");
    expect(body).not.toContain(loanClient);
  });

  await test.step("re-uploading the same file skips what is already in", async () => {
    await importCsv(page, csv);
    await expect(page.getByRole("button", { name: /^0 imported$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^2 skipped$/i })).toBeVisible();
    await expect(page.getByText(/already exists/i).first()).toBeVisible();
  });

  await test.step("the imported projects are listed", async () => {
    await page.goto(`/projects?view=list&q=${encodeURIComponent(loanClient)}`);
    await expect(page.getByText(loanClient).first()).toBeVisible();
  });
});

test("the importer refuses a header with renamed or unknown columns", async ({ page }) => {
  await openOnboardingAsAdmin(page);

  await importCsv(
    page,
    [
      "client_name,plant_capacity,total_cost,first_payment_amount,first_payment_date,client nme",
      "E2E Legacy,3kW,195000,80000,2026-02-10,x",
    ].join("\n"),
  );

  await expect(
    page.getByText(/rename "first_payment_amount" to "payment_1_amount"/i),
  ).toBeVisible();
  await expect(page.getByText(/did you mean "client_name"\?/i)).toBeVisible();
  // Nothing was attempted, so no results are shown.
  await expect(page.getByRole("button", { name: /imported$/i })).toHaveCount(0);
});
