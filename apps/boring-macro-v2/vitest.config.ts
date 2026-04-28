import { defineConfig } from "vitest/config"

// Vitest picks up *.test.ts under src/ for unit tests. e2e/ uses
// @playwright/test (separate runner) and must be excluded; otherwise
// vitest tries to evaluate playwright specs and crashes on the missing
// `test` import.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "e2e", "test-results"],
  },
})
