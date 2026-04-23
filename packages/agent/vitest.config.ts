import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.test-d.ts"],
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
    },
    environment: "node",
  },
});
