import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves connection details for the LOCAL Supabase stack. Prefers env vars
 * (set by CI after `supabase start`); falls back to `supabase status` output for
 * local runs. Never resolves to a hosted project.
 */
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
    const out = execSync("npx supabase status --output env", {
      encoding: "utf8",
    });
    const get = (key: string) => {
      const m = out.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
      return m ? m[1] : "";
    };
    url = url || get("API_URL");
    anonKey = anonKey || get("ANON_KEY");
    serviceKey = serviceKey || get("SERVICE_ROLE_KEY");
  }

  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Local Supabase not reachable. Run `npx supabase start` first, or set SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cache = { url, anonKey, serviceKey };
  return cache;
}

const noPersist = {
  auth: { persistSession: false, autoRefreshToken: false },
};

/** Service-role client — bypasses RLS. Use only for fixtures/cleanup. */
export function serviceClient(): SupabaseClient {
  const { url, serviceKey } = localConfig();
  return createClient(url, serviceKey, noPersist);
}

/** Anonymous (unauthenticated) client. */
export function anonClient(): SupabaseClient {
  const { url, anonKey } = localConfig();
  return createClient(url, anonKey, noPersist);
}

/** Client authenticated as a real seeded user — RLS applies as that user. */
export async function clientAs(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const { url, anonKey } = localConfig();
  const client = createClient(url, anonKey, noPersist);
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
} as const;
