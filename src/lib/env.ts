/**
 * Validated public Supabase env. These are read **lazily** (when a client is
 * created at runtime) rather than at module import, so `next build` never fails
 * just because the build environment lacks the vars — the old behaviour, but
 * with a clear error message at the point of use instead of a cryptic library
 * error. The service-role key stays server-only and is validated in
 * supabase/admin.ts.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.local.example.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

export function supabaseAnonKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
