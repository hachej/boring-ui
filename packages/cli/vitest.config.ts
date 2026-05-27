import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

const root = __dirname
const repoRoot = resolve(root, "..", "..")

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@hachej\/boring-agent\/shared$/, replacement: resolve(repoRoot, "packages/agent/src/shared/index.ts") },
      { find: /^@hachej\/boring-agent\/front$/, replacement: resolve(repoRoot, "packages/agent/src/front/index.ts") },
      { find: /^@hachej\/boring-agent\/server$/, replacement: resolve(repoRoot, "packages/agent/src/server/index.ts") },
      { find: /^@hachej\/boring-agent$/, replacement: resolve(repoRoot, "packages/agent/src/front/index.ts") },
      { find: /^@\/(.*)$/, replacement: resolve(repoRoot, "packages/agent/src/$1") },
      { find: /^@hachej\/boring-workspace\/server$/, replacement: resolve(repoRoot, "packages/workspace/src/server/index.ts") },
      { find: /^@hachej\/boring-workspace\/plugin$/, replacement: resolve(repoRoot, "packages/workspace/src/plugin.ts") },
      { find: /^@hachej\/boring-workspace\/events$/, replacement: resolve(repoRoot, "packages/workspace/src/front/events/index.ts") },
      { find: /^@hachej\/boring-workspace\/app\/front$/, replacement: resolve(repoRoot, "packages/workspace/src/app/front/index.ts") },
      { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: resolve(repoRoot, "packages/workspace/src/app/server/index.ts") },
      { find: /^@hachej\/boring-workspace$/, replacement: resolve(repoRoot, "packages/workspace/src/index.ts") },
    ],
  },
})
