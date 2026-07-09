import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Unit test config. Fast, no external services. Node environment by default;
 * component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
 * Integration (Supabase) and E2E (Playwright) tests live under `tests/` and are
 * excluded here — run them with `test:integration` / `test:e2e`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "tests/**"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/components/ui/**",
      ],
    },
  },
});
