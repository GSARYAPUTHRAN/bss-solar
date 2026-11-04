import { test, expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, signIn, signedInPage } from "./support/accounts";
import { expectFlash } from "./support/flash";

/**
 * Editing a team member from the Team page: the office corrects a misspelled
 * name, the Super Admin changes an admin's sign-in, and an admin is kept out of
 * what is not theirs. Every test adds the member it edits (Team → Add member)
 * under a name stamped with the run, so it asserts only on its own data and can
 * run again on the same database.
 */

const PASSWORD = "Team-Edit@2026";

/** A fresh, letters-and-digits token: unique per call, safe in the list's search. */
function stamp(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `text` exactly, ignoring case — for accessible names. */
const exactly = (text: string) => new RegExp(`^${escapeRegExp(text)}$`, "i");

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

/** Sign-in with these credentials is turned away. */
async function expectRefused(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
}

/** The Team list narrowed to `search` (the list's own search, through the URL). */
async function openList(page: Page, search: string): Promise<void> {
  await page.goto(`/team?q=${encodeURIComponent(search)}`);
  await expect(page.getByRole("heading", { name: /team management/i })).toBeVisible();
}

function rowOf(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: new RegExp(escapeRegExp(name), "i") });
}

/** Click Edit on `name`'s row and return the dialog it opens. */
async function openEdit(page: Page, name: string): Promise<Locator> {
  await rowOf(page, name)
    .getByRole("button", { name: exactly(`Edit ${name}`) })
    .click();
  const dialog = page.getByRole("dialog", { name: exactly(`Edit ${name}`) });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("an admin corrects a coordinator's misspelled name and sees it in the list", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const token = stamp();
  const misspelled = `Ravee Test ${token}`;
  const corrected = `Ravi Test ${token}`;
  await signIn(page, ACCOUNTS.admin);
  await addMember(page, { name: misspelled, email: `ravee-${token}@bsssolar.test` });

  await openList(page, token);
  await expect(rowOf(page, misspelled)).toBeVisible();
  const dialog = await openEdit(page, misspelled);
  await expect(dialog.getByLabel(/full name/i)).toHaveValue(misspelled);
  // The role is shown, never offered.
  await expect(dialog).toContainText(/role: coordinator/i);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);

  // Another member's name is refused, and the dialog keeps what was typed.
  await dialog.getByLabel(/full name/i).fill(ACCOUNTS.priya.fullName.toUpperCase());
  await dialog.getByRole("button", { name: /save changes/i }).click();
  await expect(dialog.getByRole("alert")).toContainText(/already named/i);
  await expect(dialog.getByLabel(/full name/i)).toHaveValue(ACCOUNTS.priya.fullName.toUpperCase());

  await dialog.getByLabel(/full name/i).fill(corrected);
  await dialog.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(page, /saved/i);
  await expect(dialog).toBeHidden();

  // The list shows the corrected name straight away, and it is what is stored.
  await expect(rowOf(page, corrected)).toBeVisible();
  await expect(rowOf(page, misspelled)).toHaveCount(0);
  await page.reload();
  await expect(rowOf(page, corrected)).toBeVisible();
});

test("the Super Admin changes an admin's e-mail, and the admin signs in with it", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const token = stamp();
  const name = `Meera Test ${token}`;
  const oldEmail = `meera-${token}@bsssolar.test`;
  const newEmail = `meera.new-${token}@bsssolar.test`;
  await signIn(page, ACCOUNTS.superadmin);
  await addMember(page, { name, email: oldEmail, role: "Admin" });

  await openList(page, token);
  const dialog = await openEdit(page, name);
  // Unlike an admin, the Super Admin gets the sign-in fields for another admin.
  await expect(dialog.getByLabel(/e-mail/i)).toHaveValue(oldEmail);
  await expect(dialog.getByLabel(/new password/i)).toBeVisible();

  await dialog.getByLabel(/e-mail/i).fill(newEmail.toUpperCase());
  await dialog.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(page, /saved/i);
  await expect(dialog).toBeHidden();

  // Stored lower-cased, and the dialog opens on the new address.
  await page.reload();
  const reopened = await openEdit(page, name);
  await expect(reopened.getByLabel(/e-mail/i)).toHaveValue(newEmail);
  await reopened.getByRole("button", { name: /cancel/i }).click();
  await expect(reopened).toBeHidden();

  // The new address is the working sign-in (no confirmation mail was needed)…
  const member = await signedInPage(browser, {
    email: newEmail,
    password: PASSWORD,
    fullName: name,
    landing: ACCOUNTS.admin.landing,
  });
  await member.context().close();

  // …and the old one no longer is.
  const stranger = await browser.newPage();
  await expectRefused(stranger, { email: oldEmail, password: PASSWORD });
  await stranger.context().close();
});

test("an admin sets a new e-mail and password on a coordinator, who signs in with them", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const token = stamp();
  const name = `Sudhi Test ${token}`;
  const oldEmail = `sudhi-${token}@bsssolar.test`;
  const realEmail = `sudhi.real-${token}@bsssolar.test`;
  const newPassword = "A-Real-Password@1";
  await signIn(page, ACCOUNTS.admin);
  await addMember(page, { name, email: oldEmail });

  await openList(page, token);
  const dialog = await openEdit(page, name);
  await dialog.getByLabel(/e-mail/i).fill(realEmail);
  await dialog.getByLabel(/new password/i).fill(newPassword);
  await dialog.getByRole("button", { name: /save changes/i }).click();
  await expectFlash(page, /saved/i);
  await expect(dialog).toBeHidden();

  // The password is never shown back: reopening starts blank.
  const reopened = await openEdit(page, name);
  await expect(reopened.getByLabel(/new password/i)).toHaveValue("");
  await reopened.getByRole("button", { name: /cancel/i }).click();

  // They sign in as a coordinator with the new e-mail and password…
  const member = await signedInPage(browser, {
    email: realEmail,
    password: newPassword,
    fullName: name,
    landing: ACCOUNTS.rahul.landing,
  });
  await member.context().close();

  // …and the password they were given when added no longer works.
  const stranger = await browser.newPage();
  await expectRefused(stranger, { email: realEmail, password: PASSWORD });
  await stranger.context().close();
});

test("an admin sees no sign-in fields for another admin, and no Edit for the Super Admin", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const token = stamp();
  const name = `Admin Test ${token}`;
  await signIn(page, ACCOUNTS.admin);
  await addMember(page, { name, email: `admin-${token}@bsssolar.test`, role: "Admin" });

  // Another admin: the name and phone, not the login.
  await openList(page, token);
  const dialog = await openEdit(page, name);
  await expect(dialog.getByLabel(/full name/i)).toBeVisible();
  await expect(dialog.getByLabel(/phone/i)).toBeVisible();
  await expect(dialog.getByLabel(/e-mail/i)).toHaveCount(0);
  await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
  await expect(dialog).toContainText(
    "Only the Super Admin can change another admin's e-mail or password.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Their own row: the sign-in is theirs to change.
  await openList(page, ACCOUNTS.admin.fullName);
  const own = await openEdit(page, ACCOUNTS.admin.fullName);
  await expect(own.getByLabel(/e-mail/i)).toHaveValue(ACCOUNTS.admin.email);
  await expect(own.getByLabel(/new password/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(own).toBeHidden();

  // The Super Admin's row has no Edit control at all.
  await openList(page, ACCOUNTS.superadmin.fullName);
  await expect(rowOf(page, ACCOUNTS.superadmin.fullName)).toBeVisible();
  await expect(
    rowOf(page, ACCOUNTS.superadmin.fullName).getByRole("button", { name: /^edit /i }),
  ).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("the Edit dialog fits a 360px screen and its controls are 40px tall", async ({ page }) => {
    test.setTimeout(90_000);
    const token = stamp();
    const name = `Phone Test ${token}`;
    await signIn(page, ACCOUNTS.admin);
    await addMember(page, { name, email: `phone-${token}@bsssolar.test` });

    await openList(page, token);
    // The control sits beside the name, so it is on screen without scrolling the table.
    const edit = rowOf(page, name).getByRole("button", { name: exactly(`Edit ${name}`) });
    await expect(edit).toBeInViewport({ ratio: 1 });
    const trigger = await edit.boundingBox();
    expect(trigger?.width).toBeGreaterThanOrEqual(40);
    expect(trigger?.height).toBeGreaterThanOrEqual(40);

    await edit.click();
    const dialog = page.getByRole("dialog", { name: exactly(`Edit ${name}`) });
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // Layout height, not the on-screen box: the dialog zooms in when it opens, and a box measured
    // mid-animation is scaled (40px reads as ~38px).
    const layoutHeight = (locator: Locator) => locator.evaluate((el) => (el as HTMLElement).offsetHeight);
    for (const label of [/full name/i, /phone/i, /e-mail/i, /new password/i]) {
      expect(await layoutHeight(dialog.getByLabel(label)), String(label)).toBeGreaterThanOrEqual(40);
    }
    for (const button of [/save changes/i, /cancel/i]) {
      expect(
        await layoutHeight(dialog.getByRole("button", { name: button })),
        String(button),
      ).toBeGreaterThanOrEqual(40);
    }
  });
});
