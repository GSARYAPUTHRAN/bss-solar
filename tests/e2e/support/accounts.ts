import { expect, type Browser, type Page } from "@playwright/test";

/**
 * The seeded staff accounts (supabase/seed.sql), and one way to sign in as any
 * of them. Every new spec signs in through `signIn` / `signedInPage`; the older
 * specs keep their own helpers until the slice that owns them moves them here.
 *
 * `landing` is where the app sends the role after sign-in (`homeForRole`): the
 * office to the dashboard, a coordinator to work orders, an engineer to their
 * tickets. Waiting for it means the session is established before the test goes
 * anywhere else.
 */
export interface Account {
  email: string;
  password: string;
  /** As shown in the app (the profile's name). */
  fullName: string;
  landing: RegExp;
}

const OFFICE_LANDING = /\/$|\/\?/;
const COORDINATOR_LANDING = /\/work-orders/;
const ENGINEER_LANDING = /\/tickets/;

export const ACCOUNTS = {
  /** Office staff. */
  admin: {
    email: "admin@bsssolar.test",
    password: "Admin@12345",
    fullName: "BSS Admin",
    landing: OFFICE_LANDING,
  },
  /** The one SuperAdmin: admin plus every delete. */
  superadmin: {
    email: "super@bsssolar.test",
    password: "Super@12345",
    fullName: "BSS SuperAdmin",
    landing: OFFICE_LANDING,
  },
  /** Coordinators (coord@… is Rahul). */
  rahul: {
    email: "coord@bsssolar.test",
    password: "Coord@12345",
    fullName: "Rahul Menon",
    landing: COORDINATOR_LANDING,
  },
  priya: {
    email: "priya@bsssolar.test",
    password: "Coord@12345",
    fullName: "Priya Suresh",
    landing: COORDINATOR_LANDING,
  },
  arun: {
    email: "arun@bsssolar.test",
    password: "Coord@12345",
    fullName: "Arun Krishnan",
    landing: COORDINATOR_LANDING,
  },
  /** Shares no sale with Rahul or Priya in the seed: a "not on this sale" coordinator. */
  sneha: {
    email: "sneha@bsssolar.test",
    password: "Coord@12345",
    fullName: "Sneha Das",
    landing: COORDINATOR_LANDING,
  },
  /** Service engineers: Anil holds tickets 1001 and 1003, Vineeth 1002 and 1004. */
  engineer: {
    email: "engineer@bsssolar.test",
    password: "Engineer@12345",
    fullName: "Anil Kumar",
    landing: ENGINEER_LANDING,
  },
  vineeth: {
    email: "vineeth@bsssolar.test",
    password: "Engineer@12345",
    fullName: "Vineeth Nair",
    landing: ENGINEER_LANDING,
  },
} as const satisfies Record<string, Account>;

export type AccountKey = keyof typeof ACCOUNTS;

/** Sign in through the login form and wait for the role's landing page. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(account.landing);
}

/**
 * A page in its own browser context, signed in as `account` — so two roles in
 * one test never share a session.
 */
export async function signedInPage(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account);
  return page;
}
