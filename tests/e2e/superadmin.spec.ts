import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, signIn } from "./support/accounts";

const SUPER = { email: "super@bsssolar.test", password: "Super@12345" };
const ADMIN = { email: "admin@bsssolar.test", password: "Admin@12345" };

/** Seeded active project owned by Rahul (coord@): Anand Kumar. */
const RAHUL_PROJECT = "/projects/20000000-0000-0000-0000-000000000001";

/** Sign in and wait for the office landing page, so no navigation races it. */
async function signInAsOffice(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The Delete control on `name`'s Team row (its accessible name is "Delete <name>"). */
function deleteMember(page: Page, name: string) {
  return page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: new RegExp(`^delete ${escapeRegExp(name)}$`, "i") });
}

// Each test gets its own browser context, so the two roles never share a session.
test("an admin may delete sales, projects, coordinators and engineers — never an admin or the Super Admin", async ({
  page,
}) => {
  await signInAsOffice(page, ADMIN.email, ADMIN.password);

  // Every member on one page: other specs add members, so the demo accounts must
  // not depend on where they fall in the list.
  await page.goto("/team?size=100");
  await expect(page.getByRole("heading", { name: /team management/i })).toBeVisible();
  // Deletes are for Admin and Super Admin (DELETE_ROLES); an admin may delete a
  // coordinator or a service engineer.
  await expect(deleteMember(page, ACCOUNTS.rahul.fullName)).toBeVisible();
  await expect(deleteMember(page, ACCOUNTS.engineer.fullName)).toBeVisible();
  await expect(page.getByText(/only the super admin can delete an admin/i)).toBeVisible();

  // The Super Admin's role reads as a locked badge, never as a control an admin
  // could operate; an ordinary member's row still has its role picker.
  const seatRow = page.getByRole("row").filter({ hasText: "BSS SuperAdmin" });
  await expect(seatRow.getByText("Super Admin")).toBeVisible();
  await expect(seatRow.getByRole("combobox")).toHaveCount(0);
  await expect(seatRow.getByRole("button", { name: /^delete /i })).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Rahul Menon" }).getByRole("combobox").first(),
  ).toBeVisible();

  // No admin row offers Delete to an admin — their own included, and whatever
  // other admins earlier runs added.
  await page.goto("/team?role=admin&size=100");
  await expect(page.getByRole("row").filter({ hasText: ACCOUNTS.admin.fullName })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: ACCOUNTS.rahul.fullName })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^delete /i })).toHaveCount(0);
  // Nor a role picker: an admin demoted by another admin could then be deleted.
  await expect(page.getByRole("row").getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText(/only the super admin can change an admin's role/i)).toBeVisible();

  await page.goto("/work-orders?status=pending");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/work-orders\/[^/?]+/);
  // Approve/Reject and Delete — the button only opens a confirmation.
  await expect(
    page.getByRole("button", { name: /approve & create project/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^delete$/i })).toBeVisible();

  await page.goto("/projects?view=list");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  await expect(page.getByRole("button", { name: /^delete project$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^delete sale$/i })).toBeVisible();

  // The duplicate clean-up deletes too, so its way in is shown.
  await page.goto("/work-orders");
  await expect(page.getByRole("link", { name: /find duplicates/i })).toBeVisible();
});

test("a coordinator sees no delete anywhere", async ({ page }) => {
  await signIn(page, ACCOUNTS.rahul);

  await expect(page.getByRole("link", { name: /find duplicates/i })).toHaveCount(0);

  // Their own sale, on its project page and its work order page.
  await page.goto(RAHUL_PROJECT);
  await expect(page.locator("#payments")).toBeVisible();
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);

  await page.goto("/work-orders");
  await page.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/\/work-orders\/[^/?]+/);
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);

  // The Team list (and its deletes) is the office's.
  await page.goto("/team");
  await expect(page).not.toHaveURL(/\/team/);
});

test("the SuperAdmin can delete users, work orders and projects", async ({
  page,
}) => {
  await signInAsOffice(page, SUPER.email, SUPER.password);

  await page.goto("/team?size=100");
  await expect(
    page.getByRole("button", { name: /^delete /i }).first(),
  ).toBeVisible();
  // Unlike an admin, the Super Admin may delete an admin, and change their role
  // (only looked at here: office-deletes.spec.ts deletes one it added itself).
  await expect(deleteMember(page, ACCOUNTS.admin.fullName)).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: ACCOUNTS.admin.fullName }).getByRole("combobox").first(),
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
  await expect(page.getByRole("button", { name: /^delete sale$/i })).toBeVisible();
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
