import "@testing-library/jest-dom/vitest";

// Satisfy the validated env module (src/lib/env.ts) in unit tests that import
// modules which read Supabase env at import time (e.g. the middleware).
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
