import { execSync } from "node:child_process";

/**
 * Resolve the local stack's connection details ONCE per run and export them,
 * so the test files (helpers.ts reads these first) do not each shell out to
 * `supabase status` — about 30 seconds per local run. CI already exports them
 * after `supabase start`, in which case this is a no-op. Vitest runs this in the
 * main process before spawning workers, which inherit the environment.
 */
const KEYS = {
  SUPABASE_URL: "API_URL",
  SUPABASE_ANON_KEY: "ANON_KEY",
  SUPABASE_SERVICE_ROLE_KEY: "SERVICE_ROLE_KEY",
  SUPABASE_DB_URL: "DB_URL",
} as const;

export default function setup(): void {
  const missing = (Object.keys(KEYS) as (keyof typeof KEYS)[]).filter(
    (name) => !process.env[name],
  );
  if (missing.length === 0) return;

  let status: string;
  try {
    status = execSync("npx supabase status --output env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Local Supabase is not running. Start it with `npx supabase start` (or export SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL).",
    );
  }

  for (const name of missing) {
    const match = status.match(new RegExp(`^${KEYS[name]}="?([^"\\r\\n]+)"?`, "m"));
    if (match) process.env[name] = match[1];
  }
}
