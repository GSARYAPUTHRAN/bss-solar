import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests against a locally built app + local Supabase.
 * Prereqs: `supabase start` and `npm run build` (CI does both). The web server
 * (`next start`) reads Supabase env from the shell / .env.local.
 */
// Dedicated port so we never reuse an unrelated dev server on :3000. Override
// with E2E_PORT when something else already holds it on a dev machine.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
