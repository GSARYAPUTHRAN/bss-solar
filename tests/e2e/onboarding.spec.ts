import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, signIn } from "./support/accounts";

/**
 * The onboarding import. Every test creates its own rows (named with a unique
 * stamp) through the page and names the seeded demo coordinators — Rahul Menon,
 * Priya Suresh, Arun Krishnan — by full name, so it depends on no other data.
 */

async function openOnboardingAsAdmin(page: Page) {
  await signIn(page, ACCOUNTS.admin);
  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: /import existing projects/i }),
  ).toBeVisible();
}

async function fillCsv(page: Page, csv: string) {
  await page.getByLabel("CSV data").fill(csv);
}

async function importCsv(page: Page, csv: string) {
  await fillCsv(page, csv);
  await page.getByRole("button", { name: /^import projects$/i }).click();
}

async function checkCsv(page: Page, csv: string) {
  await fillCsv(page, csv);
  await page.getByRole("button", { name: /^check file$/i }).click();
}

/** A CSV line in `columns` order from the named cells (the rest blank). */
function line(columns: readonly string[], cells: Record<string, string>): string {
  return columns
    .map((h) => {
      const v = cells[h] ?? "";
      return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
    })
    .join(",");
}

/** Searches the work orders for rows starting with a stamp: how a test sees what was written. */
async function workOrdersMatching(page: Page, q: string) {
  await page.goto(`/work-orders?q=${encodeURIComponent(q)}`);
  await expect(page.getByRole("heading", { name: /work orders/i }).first()).toBeVisible();
  return page.getByRole("row").filter({ hasText: q });
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
  "coordinator",
  "financing_type",
  "loan_bank_name",
  "consumer_number",
  "kseb_section",
  "notes",
  "current_stage",
  "is_completed",
  "commissioned_on",
  "feasibility_date",
  "coordinator_incentive",
  "incentive_paid_on",
  ...PAYMENT_COLUMNS,
];

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
    line(HEADER, {
      client_name: loanClient,
      plant_capacity: "3kW",
      total_cost: "195000",
      advance_amount: "20000",
      order_date: "2025-06-15",
      coordinator: "coord@bsssolar.test",
      financing_type: "loan",
      loan_bank_name: "State Bank of India",
      consumer_number: `${stamp}1`,
      kseb_section: "Vytilla",
      current_stage: "panel_installation",
      feasibility_date: "2025-08-20",
      coordinator_incentive: "5000",
      payment_1_amount: "40000",
      payment_1_date: "2025-06-30",
      payment_1_method: "UPI",
      payment_2_amount: "4540",
      payment_2_date: "2025-07-10",
      payment_2_method: "cash",
      payment_2_purpose: "kseb_fees",
      payment_3_amount: "60000",
      payment_3_date: "2025-08-28",
      payment_3_method: "loan_disbursement",
      payment_4_amount: "50000",
      payment_4_date: "2025-09-25",
      payment_4_method: "Bank transfer",
      payment_4_reference: "NEFT SBIN0001234",
    }),
    // Commissioned, self-financed, ₹50,000 still due.
    line(HEADER, {
      client_name: dueClient,
      plant_capacity: "5kW",
      total_cost: "310000",
      advance_amount: "50000",
      order_date: "2025-03-02",
      coordinator: "Priya Suresh",
      financing_type: "self",
      consumer_number: `${stamp}2`,
      is_completed: "yes",
      commissioned_on: "2025-05-05",
      feasibility_date: "2025-04-10",
      payment_1_amount: "150000",
      payment_1_date: "2025-04-15",
      payment_2_amount: "60000",
      payment_2_date: "2025-05-25",
    }),
    // Valid in the sheet, refused by the team's accounts: no such e-mail.
    line(HEADER, {
      client_name: ghostClient,
      plant_capacity: "2kW",
      total_cost: "130000",
      coordinator: `ghost-${stamp}@bsssolar.test`,
    }),
    // Refused by validation: no capacity, and a payment group with no date.
    line(HEADER, {
      client_name: "E2E No Capacity",
      total_cost: "100000",
      coordinator: "Rahul Menon",
      payment_1_amount: "1000",
    }),
  ].join("\n");

  await test.step("first upload imports the valid rows and reports the rest", async () => {
    await importCsv(page, csv);

    await expect(page.getByRole("button", { name: /^2 imported$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^0 skipped$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^2 failed$/i })).toBeVisible();

    await expect(
      page.getByText(/Imported at Panel Installation · 4 payments recorded · Rahul Menon/i),
    ).toBeVisible();
    await expect(
      page.getByText(/Commissioned · ₹50,000(\.00)? outstanding · 2 payments recorded · Priya Suresh/i),
    ).toBeVisible();
    await expect(page.getByText(/is not an account/i).first()).toBeVisible();
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

test("Check file shows who each coordinator became and writes nothing", async ({ page }) => {
  await openOnboardingAsAdmin(page);

  // The default select starts at "No default": a blank cell is never an accident.
  await expect(page.getByRole("combobox", { name: /default coordinator/i })).toContainText(
    "No default — rows with a blank coordinator fail",
  );

  const stamp = Date.now();
  const prefix = `E2E Check ${stamp}`;
  // The sheet's old coordinator_email header still loads, and the new columns work.
  const columns = [
    "client_name",
    "plan_type",
    "plant_capacity",
    "total_cost",
    "order_date",
    "coordinator_email",
    "current_stage",
    "cancellation",
    "cancellation_remarks",
    "payment_1_amount",
    "payment_1_date",
  ];
  const base = { order_date: "2025-01-10", plant_capacity: "3kW", total_cost: "195000" };
  const csv = [
    columns.join(","),
    // Shared by two coordinators, a sum for the price, a finished plant.
    line(columns, {
      ...base,
      client_name: `${prefix} Shared`,
      plant_capacity: "3kW+inverter",
      total_cost: "235000+23500",
      coordinator_email: "Rahul Menon+Priya Suresh",
      current_stage: "plant_complete",
    }),
    // A remark in brackets is not part of the name.
    line(columns, {
      ...base,
      client_name: `${prefix} Aside`,
      coordinator_email: "Priya Suresh(sheeja)",
    }),
    // One letter too many: offered, never assumed.
    line(columns, {
      ...base,
      client_name: `${prefix} Typo`,
      coordinator_email: "Rahull Menon",
    }),
    // Not a kW plant.
    line(columns, {
      ...base,
      client_name: `${prefix} Custom`,
      plan_type: "custom",
      plant_capacity: "Inverter + panel",
      total_cost: "23500",
      coordinator_email: "Arun Krishnan",
      current_stage: "completed",
    }),
    line(columns, {
      ...base,
      client_name: `${prefix} Refunded`,
      order_date: "2025-01-13",
      coordinator_email: "Rahul Menon",
      cancellation: "refunded",
      cancellation_remarks: "REFUNDED",
      payment_1_amount: "10000",
      payment_1_date: "2025-01-13",
    }),
    // Nobody named, and no default chosen.
    line(columns, { ...base, client_name: `${prefix} Nobody` }),
  ].join("\n");

  await checkCsv(page, csv);

  await test.step("the results say nothing was imported, with ready and failed counts only", async () => {
    await expect(page.getByRole("heading", { name: /nothing was imported/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^4 ready$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^2 failed$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /imported$|skipped$/i })).toHaveCount(0);
  });

  await test.step("each row says what it would become, by name", async () => {
    await expect(
      page.getByText(/Ready · Commissioned · .* · Rahul Menon & Priya Suresh/i),
    ).toBeVisible();
    await expect(
      page.getByText(/Ready · .*Custom plan "Inverter \+ panel".* · Arun Krishnan/i),
    ).toBeVisible();
    await expect(page.getByText(/Ready · .*Refunded.*1 payment to record.* · Rahul Menon/i)).toBeVisible();
  });

  await test.step("the coordinator matches panel names the suggestion and the blank cell", async () => {
    const matches = page.getByRole("region", { name: /coordinator matches/i });
    await expect(matches).toContainText("“Rahull Menon”");
    await expect(matches).toContainText(/did you mean Rahul Menon/i);
    await expect(matches).toContainText(/\(blank\).*no default chosen — these rows fail/i);
    await expect(matches).toContainText(/Priya Suresh/);
  });

  await test.step("the warnings mention the rows without a consumer number", async () => {
    const worth = page.getByRole("region", { name: /worth a look/i });
    await expect(worth).toContainText(/4 rows have no consumer_number/i);
  });

  await test.step("nothing was written", async () => {
    const rows = await workOrdersMatching(page, prefix);
    await expect(rows).toHaveCount(0);
  });
});

test("Import writes the rows with their coordinators and keeps the sheet's remarks", async ({
  page,
}) => {
  await openOnboardingAsAdmin(page);

  const stamp = Date.now();
  const shared = `E2E Shared ${stamp}`;
  const nobody = `E2E Nobody ${stamp}`;
  const columns = [
    "client_name",
    "plant_capacity",
    "total_cost",
    "order_date",
    "coordinator",
    "current_stage",
    "notes",
  ];
  const csv = [
    columns.join(","),
    // "Rahul Menon + Priya Suresh(sheeja)": two people, and a remark that is kept.
    line(columns, {
      client_name: shared,
      plant_capacity: "3kW",
      total_cost: "195000",
      order_date: "2025-01-10",
      coordinator: "Rahul Menon + Priya Suresh(sheeja)",
      current_stage: "panel_installation",
      notes: "Needs a ladder",
    }),
    // No coordinator and no default chosen: refused, never given to the admin.
    line(columns, {
      client_name: nobody,
      plant_capacity: "3kW",
      total_cost: "195000",
      order_date: "2025-01-10",
    }),
  ].join("\n");

  await importCsv(page, csv);

  await test.step("the results name the coordinators, and the blank cell is refused", async () => {
    await expect(page.getByRole("button", { name: /^1 imported$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^1 failed$/i })).toBeVisible();
    await expect(
      page.getByText(/Imported at Panel Installation · Rahul Menon & Priya Suresh$/i),
    ).toBeVisible();
    await expect(
      page.getByText(/coordinator is blank and no default coordinator was chosen/i),
    ).toBeVisible();
  });

  await test.step("the failed-rows download has the reason in import_error", async () => {
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: /download failed rows/i }).click();
    const body = await readFile(await (await downloading).path(), "utf8");
    expect(body).toContain("import_error");
    expect(body).toContain(nobody);
    expect(body).not.toContain(shared);
  });

  await test.step("the sale shows both coordinators and keeps the remark in its notes", async () => {
    const rows = await workOrdersMatching(page, shared);
    await rows.click();
    await expect(page.getByRole("heading", { name: shared })).toBeVisible();
    await expect(page.getByText("Rahul Menon").first()).toBeVisible();
    await expect(page.getByText("Priya Suresh").first()).toBeVisible();
    await expect(page.getByText(/Needs a ladder/)).toBeVisible();
    await expect(
      page.getByText(/Coordinator as written in the import sheet: Rahul Menon \+ Priya Suresh\(sheeja\)/),
    ).toBeVisible();
  });

  await test.step("the row that was refused was not written", async () => {
    const rows = await workOrdersMatching(page, nobody);
    await expect(rows).toHaveCount(0);
  });
});

test("a chosen default coordinator fills blank cells, and the results say so", async ({ page }) => {
  await openOnboardingAsAdmin(page);

  const client = `E2E Default ${Date.now()}`;
  const columns = ["client_name", "plant_capacity", "total_cost", "order_date", "coordinator"];
  await page.getByRole("combobox", { name: /default coordinator/i }).click();
  await page.getByRole("option", { name: /Arun Krishnan/ }).click();

  await checkCsv(
    page,
    [
      columns.join(","),
      line(columns, {
        client_name: client,
        plant_capacity: "3kW",
        total_cost: "195000",
        order_date: "2025-01-10",
      }),
    ].join("\n"),
  );

  await expect(page.getByRole("button", { name: /^1 ready$/i })).toBeVisible();
  await expect(page.getByText(/Ready · .* · Arun Krishnan \(default coordinator\)/i)).toBeVisible();
  const matches = page.getByRole("region", { name: /coordinator matches/i });
  await expect(matches).toContainText(/\(blank\).*Arun Krishnan.*\(default coordinator\)/i);
});

test("the CSV box keeps its size however long the sheet is, so Check file stays beside it", async ({
  page,
}) => {
  await openOnboardingAsAdmin(page);

  const columns = ["client_name", "plant_capacity", "total_cost", "coordinator"];
  const rows = Array.from({ length: 300 }, (_, i) =>
    line(columns, {
      client_name: `E2E Long ${i}`,
      plant_capacity: "3kW",
      total_cost: "195000",
      coordinator: "Rahul Menon",
    }),
  );
  await fillCsv(page, [columns.join(","), ...rows].join("\n"));

  const box = page.getByLabel("CSV data");
  const check = page.getByRole("button", { name: /^check file$/i });
  const boxRect = await box.boundingBox();
  const checkRect = await check.boundingBox();
  if (!boxRect || !checkRect) throw new Error("the CSV box or Check file is not on the page");

  // 300 rows are some 5,000px of text: the box scrolls instead of growing to hold them.
  expect(boxRect.height).toBeLessThan(400);
  expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // Distances, not positions: they do not depend on how far the page is scrolled.
  expect(checkRect.y - (boxRect.y + boxRect.height)).toBeLessThan(400);

  await check.click();
  await expect(page.getByRole("button", { name: /^300 ready$/i })).toBeVisible();
});

test("Check file numbers rows by sheet line and warns about a consumer number repeated in the file", async ({
  page,
}) => {
  await openOnboardingAsAdmin(page);

  const columns = [
    "client_name",
    "plant_capacity",
    "total_cost",
    "order_date",
    "coordinator",
    "consumer_number",
  ];
  const base = { order_date: "2025-01-10", coordinator: "Rahul Menon", total_cost: "195000" };
  await checkCsv(
    page,
    [
      columns.join(","),
      line(columns, { ...base, client_name: "E2E Repeat A", plant_capacity: "3kW", consumer_number: "NA" }),
      // A blank line: not a row, but it is line 3.
      "",
      line(columns, { ...base, client_name: "E2E Repeat B", plant_capacity: "3kW", consumer_number: "NA" }),
      line(columns, { ...base, client_name: "E2E Repeat C", consumer_number: "1" }),
    ].join("\n"),
  );

  await expect(page.getByRole("button", { name: /^2 ready$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^1 failed$/i })).toBeVisible();

  await test.step("Import would skip every row after the first, and Check says so", async () => {
    const worth = page.getByRole("region", { name: /worth a look/i });
    await expect(worth).toContainText(
      /Rows 2 and 4 share consumer number NA — only the first \(row 2\) will be imported; the other is skipped/,
    );
  });

  await test.step("the failed row is under its line in the sheet, not its place among the rows", async () => {
    // The blank line is line 3, so C (the third row) is on line 5.
    const failed = page.getByRole("listitem").filter({ hasText: "E2E Repeat C" });
    await expect(failed).toContainText("Row 5");
    await expect(failed).toContainText(/plant_capacity is required/);
  });

  await test.step("turning skipping off drops the warning: every row will import", async () => {
    await page.getByRole("checkbox", { name: /skip rows whose consumer number already exists/i }).click();
    await page.getByRole("button", { name: /^check file$/i }).click();
    await expect(page.getByRole("button", { name: /^1 failed$/i })).toBeVisible();
    // Nothing else in this file is worth a look, so the box is gone altogether.
    await expect(page.getByText(/share consumer number/i)).toHaveCount(0);
    await expect(page.getByRole("region", { name: /worth a look/i })).toHaveCount(0);
  });
});

test("a file Excel saved as plain CSV (Windows-1252) is read with its dashes, and says so", async ({
  page,
}) => {
  await openOnboardingAsAdmin(page);

  // 0x96 is an en dash in Windows-1252, and not valid UTF-8 on its own.
  const buffer = Buffer.concat([
    Buffer.from("client_name,plant_capacity,total_cost,order_date,coordinator\nE2E Ravi "),
    Buffer.from([0x96]),
    Buffer.from(" K,3kW,195000,2025-01-10,Rahul Menon\n"),
  ]);
  await page.locator('input[type="file"]').setInputFiles({ name: "excel.csv", mimeType: "text/csv", buffer });

  await expect(page.getByLabel("CSV data")).toHaveValue(/E2E Ravi – K,3kW/);
  await expect(
    page.getByText(/This file was not UTF-8, so it was read as Windows-1252/),
  ).toBeVisible();

  await page.getByRole("button", { name: /^check file$/i }).click();
  await expect(page.getByRole("button", { name: /^1 ready$/i })).toBeVisible();
  await expect(page.getByRole("region", { name: /worth a look/i })).not.toContainText(
    /replacement character/i,
  );
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

test("a column given under both its old and new name is refused", async ({ page }) => {
  await openOnboardingAsAdmin(page);

  await checkCsv(
    page,
    [
      "client_name,plant_capacity,total_cost,coordinator,coordinator_email",
      "E2E Twice,3kW,195000,Rahul Menon,Priya Suresh",
    ].join("\n"),
  );

  await expect(
    page.getByText(/"coordinator_email" and "coordinator" are the same column — keep one/i),
  ).toBeVisible();
});
