import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests that run against a LOCAL Supabase stack (`supabase start`).
 * They exercise real RLS policies and DB triggers — the security guarantees that
 * unit tests cannot cover. Never point these at a hosted/production project.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ["./tests/integration/setup.ts"],
  },
});
