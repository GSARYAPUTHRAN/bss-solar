import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import type { Database } from "@/lib/supabase/database.types";

/** A Supabase client typed against the generated schema, like the app's. */
export type Db = SupabaseClient<Database>;

/**
 * Resolves connection details for the LOCAL Supabase stack. Prefers env vars
 * (set by CI after `supabase start`); falls back to `supabase status` output for
 * local runs. Ports are never hard-coded — they differ between machines.
 *
 * These suites delete rows, flip roles and (for the reset script) wipe business
 * data, so every resolved URL must point at this machine: a stray hosted URL in
 * the shell fails fast instead of being written to.
 */
let statusCache: string | null = null;

function stackStatus(key: string): string {
  statusCache ??= execSync("npx supabase status --output env", {
    encoding: "utf8",
  });
  const m = statusCache.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
  return m ? m[1] : "";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function assertLocal(url: string, what: string): string {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run integration tests against a non-local ${what} (${host}). Point SUPABASE_URL / SUPABASE_DB_URL at the local stack.`,
    );
  }
  return url;
}

let cache: { url: string; anonKey: string; serviceKey: string } | null = null;

export function localConfig() {
  if (cache) return cache;

  let url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !anonKey || !serviceKey) {
    url = url || stackStatus("API_URL");
    anonKey = anonKey || stackStatus("ANON_KEY");
    serviceKey = serviceKey || stackStatus("SERVICE_ROLE_KEY");
  }

  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Local Supabase not reachable. Run `npx supabase start` first, or set SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cache = { url: assertLocal(url, "API"), anonKey, serviceKey };
  return cache;
}

/** Postgres connection string of the local stack (SUPABASE_DB_URL in CI). */
export function localDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL || stackStatus("DB_URL");
  if (!url) {
    throw new Error(
      "Local database not reachable. Run `npx supabase start` first, or set SUPABASE_DB_URL.",
    );
  }
  return assertLocal(url, "database");
}

/**
 * Runs `fn` with a direct Postgres connection as the database owner — for
 * checks PostgREST cannot express (catalog lookups, evaluating a SQL function
 * over a whole grid in one statement, running a SQL script). RLS does not apply
 * here; use `signedInAs` for anything that is about permissions.
 *
 * Select dates `::text`: node-postgres turns `date` into a local-time JS Date,
 * which would shift calendar days by the machine's offset.
 */
export async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localDbUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const noPersist = {
  auth: { persistSession: false, autoRefreshToken: false },
};

/** Service-role client — bypasses RLS. Use only for fixtures/cleanup. */
export function serviceClient(): Db {
  const { url, serviceKey } = localConfig();
  return createClient<Database>(url, serviceKey, noPersist);
}

/** Anonymous (unauthenticated) client. */
export function anonClient(): Db {
  const { url, anonKey } = localConfig();
  return createClient<Database>(url, anonKey, noPersist);
}

/** Client authenticated as a real user — RLS applies as that user. */
export async function clientAs(email: string, password: string): Promise<Db> {
  const { url, anonKey } = localConfig();
  const client = createClient<Database>(url, anonKey, noPersist);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

export const USERS = {
  admin: {
    email: "admin@bsssolar.test",
    password: "Admin@12345",
    id: "00000000-0000-0000-0000-000000000001",
  },
  superadmin: {
    email: "super@bsssolar.test",
    password: "Super@12345",
    id: "00000000-0000-0000-0000-000000000006",
  },
  rahul: {
    email: "coord@bsssolar.test",
    password: "Coord@12345",
    id: "00000000-0000-0000-0000-000000000002",
  },
  priya: {
    email: "priya@bsssolar.test",
    password: "Coord@12345",
    id: "00000000-0000-0000-0000-000000000003",
  },
  arun: {
    email: "arun@bsssolar.test",
    password: "Coord@12345",
    id: "00000000-0000-0000-0000-000000000004",
  },
  sneha: {
    email: "sneha@bsssolar.test",
    password: "Coord@12345",
    id: "00000000-0000-0000-0000-000000000005",
  },
  /** Service engineer — seeded tickets BSS-2606-1001 and BSS-2606-1003. */
  anil: {
    email: "engineer@bsssolar.test",
    password: "Engineer@12345",
    id: "00000000-0000-0000-0000-000000000007",
  },
  /** Service engineer — seeded tickets BSS-2606-1002 and BSS-2606-1004. */
  vineeth: {
    email: "vineeth@bsssolar.test",
    password: "Engineer@12345",
    id: "00000000-0000-0000-0000-000000000008",
  },
} as const;

export type SeedUser = (typeof USERS)[keyof typeof USERS];

const sessions = new Map<string, Promise<Db>>();

/**
 * A client signed in as a seeded user, shared by every test in the file. A role
 * lives in `profiles`, not in the JWT, so a reused session always reflects the
 * user's current role. A failed sign-in is not cached.
 */
export function signedInAs(user: SeedUser): Promise<Db> {
  let session = sessions.get(user.email);
  if (!session) {
    session = clientAs(user.email, user.password);
    session.catch(() => sessions.delete(user.email));
    sessions.set(user.email, session);
  }
  return session;
}

/** The database's IST calendar date — the "today" every view computes with. */
export async function istToday(db: Db = serviceClient()): Promise<string> {
  const { data, error } = await db.rpc("ist_today");
  if (error || !data) throw new Error(`ist_today() failed: ${error?.message}`);
  return data;
}
