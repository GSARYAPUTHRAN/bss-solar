/**
 * Validated public Supabase env, read once. Replaces scattered
 * `process.env.X!` non-null assertions so a missing/typo'd variable fails with
 * a clear message instead of a cryptic library-internal error. These two are
 * public (NEXT_PUBLIC_*, inlined into the client bundle at build). The
 * service-role key stays server-only and is validated in supabase/admin.ts.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.local.example.`,
    );
  }
  return value;
}

export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = required(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
