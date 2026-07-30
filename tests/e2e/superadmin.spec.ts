import { test, expect, type Page } from "@playwright/test";

const SUPER = { email: "super@bsssolar.test", password: "Super@12345" };
const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };

/** Sign in and wait for the office landing page, so no navigation races it. */
async function signInAsOffice(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

// Each test gets its own browser context, so the two roles never share a session.
test("a plain admin gets no delete affordances", async ({ page }) => {
  await signInAsOffice(page, ADMIN.email, ADMIN.password);

  await page.goto("/team");
  await expect(page.getByRole("heading", { name: /team management/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^delete /i })).toHaveCount(0);

  // The Super Admin's role reads as a locked badge, never as a control an admin
  // could operate; an ordinary member's row still has its role picker.
  const seatRow = page.getByRole("row").filter({ hasText: "BSS SuperAdmin" });
  await expect(seatRow.getByText("Super Admin")).toBeVisible();
  await expect(seatRow.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Rahul Menon" }).getByRole("combobox").first(),
  ).toBeVisible();

  await page.goto("/work-orders?status=pending");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/work-orders\/[^/?]+/);
  // Approve/Reject remain available; Delete does not.
  await expect(
    page.getByRole("button", { name: /approve & create project/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^delete$/i })).toHaveCount(0);

  await page.goto("/projects?view=list");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  await expect(page.getByRole("button", { name: /delete project/i })).toHaveCount(0);
});

test("the SuperAdmin can delete users, work orders and projects", async ({
  page,
}) => {
  await signInAsOffice(page, SUPER.email, SUPER.password);

  await page.goto("/team");
  await expect(
    page.getByRole("button", { name: /^delete /i }).first(),
  ).toBeVisible();

  // Even the holder cannot edit or delete their own seat.
  const seatRow = page.getByRole("row").filter({ hasText: "BSS SuperAdmin" });
  await expect(seatRow.getByRole("combobox")).toHaveCount(0);
  await expect(seatRow.getByRole("button", { name: /^delete /i })).toHaveCount(0);

  await page.goto("/work-orders?status=pending");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/work-orders\/[^/?]+/);
  await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();

  await page.goto("/projects?view=list");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  await expect(page.getByRole("button", { name: /delete project/i })).toBeVisible();
});

test("the dashboard surfaces commissioned projects with an outstanding balance", async ({
  page,
}) => {
  await signInAsOffice(page, ADMIN.email, ADMIN.password);

  const card = page.getByRole("link", { name: /commissioned · unpaid/i });
  await expect(card).toBeVisible();
  await card.click();

  // Lands on the project list pre-filtered to the flagged projects.
  await expect(page).toHaveURL(/status=payment_pending/);
  await expect(page.getByText(/payment pending/i).first()).toBeVisible();
});
