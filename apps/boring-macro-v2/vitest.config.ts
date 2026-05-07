import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const PACKAGES = resolve(__dirname, "../../packages")

// Vitest picks up *.test.ts under src/ for unit tests. e2e/ uses
// @playwright/test (separate runner) and must be excluded; otherwise
// vitest tries to evaluate playwright specs and crashes on the missing
// `test` import.
export default defineConfig({
  resolve: {
    alias: {
      "@boring/agent/server": resolve(PACKAGES, "agent/src/server/index.ts"),
      "@boring/workspace/globals.css": resolve(PACKAGES, "workspace/src/globals.css"),
      "@boring/workspace/plugin": resolve(PACKAGES, "workspace/src/plugin.ts"),
      "@boring/workspace/app/front": resolve(PACKAGES, "workspace/src/app/front/index.ts"),
      "@boring/workspace/app/server": resolve(PACKAGES, "workspace/src/app/server/index.ts"),
      "@boring/workspace/testing": resolve(PACKAGES, "workspace/src/testing/index.ts"),
      "@boring/workspace/ui-shadcn": resolve(PACKAGES, "workspace/src/components/ui/index.ts"),
      "@boring/workspace/shared": resolve(PACKAGES, "workspace/src/shared/index.ts"),
      "@boring/workspace": resolve(PACKAGES, "workspace/src/index.ts"),
      "@/": resolve(PACKAGES, "workspace/src") + "/",
      "@": resolve(PACKAGES, "workspace/src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "e2e", "test-results"],
  },
})
