import { resolve } from "node:path"
import { configDefaults, defineConfig } from "vitest/config"

const root = __dirname
const repoRoot = resolve(root, "..", "..")

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: [/^@hachej\/boring-(agent|bash|workspace|ui-kit)(\/.*)?$/, /^@hachej\/boring-ui-plugin-cli$/],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "cli",
          exclude: [...configDefaults.exclude, "src/__tests__/pluginFrontRuntime.test.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "runtime-host",
          include: ["src/__tests__/pluginFrontRuntime.test.ts"],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          testTimeout: 600_000,
        },
      },
    ],
  },
  resolve: {
    alias: [
      { find: /^@hachej\/boring-bash\/agent$/, replacement: resolve(repoRoot, "packages/boring-bash/src/agent/index.ts") },
      { find: /^@hachej\/boring-agent\/shared$/, replacement: resolve(repoRoot, "packages/agent/src/shared/index.ts") },
      { find: /^@hachej\/boring-agent\/front$/, replacement: resolve(repoRoot, "packages/agent/src/front/index.ts") },
      { find: /^@hachej\/boring-agent\/server$/, replacement: resolve(repoRoot, "packages/agent/src/server/index.ts") },
      { find: /^@hachej\/boring-agent\/eval$/, replacement: resolve(repoRoot, "packages/agent/src/eval/index.ts") },
      { find: /^@hachej\/boring-agent$/, replacement: resolve(repoRoot, "packages/agent/src/front/index.ts") },
      { find: /^@\/(.*)$/, replacement: resolve(repoRoot, "packages/agent/src/$1") },
      { find: /^@hachej\/boring-workspace\/server$/, replacement: resolve(repoRoot, "packages/workspace/src/server/index.ts") },
      { find: /^@hachej\/boring-workspace\/plugin$/, replacement: resolve(repoRoot, "packages/workspace/src/plugin.ts") },
      { find: /^@hachej\/boring-workspace\/events$/, replacement: resolve(repoRoot, "packages/workspace/src/front/events/index.ts") },
      { find: /^@hachej\/boring-workspace\/app\/front$/, replacement: resolve(repoRoot, "packages/workspace/src/app/front/index.ts") },
      { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: resolve(repoRoot, "packages/workspace/src/app/server/index.ts") },
      { find: /^@hachej\/boring-workspace$/, replacement: resolve(repoRoot, "packages/workspace/src/index.ts") },
      { find: /^@hachej\/boring-ui-kit$/, replacement: resolve(repoRoot, "packages/ui/src/index.ts") },
      { find: /^@hachej\/boring-diagram\/front$/, replacement: resolve(repoRoot, "plugins/diagram/src/front/index.tsx") },
      { find: /^@hachej\/boring-diagram\/shared$/, replacement: resolve(repoRoot, "plugins/diagram/src/shared/index.ts") },
      { find: /^@hachej\/boring-live-transcription\/front$/, replacement: resolve(repoRoot, "plugins/live-transcription/src/front/index.tsx") },
      { find: /^@hachej\/boring-live-transcription\/server$/, replacement: resolve(repoRoot, "plugins/live-transcription/src/server/index.ts") },
      { find: /^@hachej\/boring-live-transcription\/shared$/, replacement: resolve(repoRoot, "plugins/live-transcription/src/shared/index.ts") },
      { find: /^@hachej\/boring-ui-plugin-cli$/, replacement: resolve(repoRoot, "packages/plugin-cli/src/index.ts") },
    ],
  },
})
