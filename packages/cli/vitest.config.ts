import { resolve } from "node:path"
import { configDefaults, defineConfig } from "vitest/config"
import { sandboxSourceAlias } from "../../scripts/vite-sandbox-alias.ts"

const root = import.meta.dirname
const repoRoot = resolve(root, "..", "..")

export default defineConfig({
  cacheDir: resolve(process.env.TMPDIR ?? "/tmp", "boring-ui-v2-cli-vitest-cache"),
  test: {
    server: {
      deps: {
        inline: [/^@hachej\/boring-(agent|ask-user|automation|bash|tasks|workspace|ui-kit)(\/.*)?$/, /^@hachej\/boring-ui-plugin-cli$/],
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
      { find: /^@hachej\/boring-bash\/server$/, replacement: resolve(repoRoot, "packages/boring-bash/src/server/index.ts") },
      { find: /^@hachej\/boring-agent\/shared$/, replacement: resolve(repoRoot, "packages/agent/src/shared/index.ts") },
      { find: /^@hachej\/boring-agent\/front$/, replacement: resolve(repoRoot, "packages/agent/src/front/index.ts") },
      { find: /^@hachej\/boring-agent\/server$/, replacement: resolve(repoRoot, "packages/agent/src/server/index.ts") },
      { find: /^@hachej\/boring-agent\/server\/agent-host\/testing\/compositionRouteProof$/, replacement: resolve(repoRoot, "packages/agent/src/server/agent-host/testing/compositionRouteProof.ts") },
      { find: /^@hachej\/boring-agent\/eval$/, replacement: resolve(repoRoot, "packages/agent/src/eval/index.ts") },
      { find: /^@hachej\/boring-agent$/, replacement: resolve(repoRoot, "packages/agent/src/front/index.ts") },
      sandboxSourceAlias,
      { find: /^@\/(.*)$/, replacement: resolve(repoRoot, "packages/agent/src/$1") },
      { find: /^@hachej\/boring-workspace\/server$/, replacement: resolve(repoRoot, "packages/workspace/src/server/index.ts") },
      { find: /^@hachej\/boring-workspace\/plugin$/, replacement: resolve(repoRoot, "packages/workspace/src/plugin.ts") },
      { find: /^@hachej\/boring-workspace\/events$/, replacement: resolve(repoRoot, "packages/workspace/src/front/events/index.ts") },
      { find: /^@hachej\/boring-workspace\/app\/front$/, replacement: resolve(repoRoot, "packages/workspace/src/app/front/index.ts") },
      { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: resolve(repoRoot, "packages/workspace/src/app/server/index.ts") },
      { find: /^@hachej\/boring-workspace$/, replacement: resolve(repoRoot, "packages/workspace/src/index.ts") },
      { find: /^@hachej\/boring-ui-kit$/, replacement: resolve(repoRoot, "packages/ui/src/index.ts") },
      { find: /^@hachej\/boring-automation\/server$/, replacement: resolve(repoRoot, "plugins/boring-automation/src/server/index.ts") },
      { find: /^@hachej\/boring-automation\/front$/, replacement: resolve(repoRoot, "plugins/boring-automation/src/front/index.tsx") },
      { find: /^@hachej\/boring-ask-user\/front$/, replacement: resolve(repoRoot, "plugins/ask-user/src/front/index.tsx") },
      { find: /^@hachej\/boring-tasks\/front$/, replacement: resolve(repoRoot, "plugins/tasks/src/front/index.tsx") },
      { find: /^@hachej\/boring-diagram\/front$/, replacement: resolve(repoRoot, "plugins/diagram/src/front/index.tsx") },
      { find: /^@hachej\/boring-diagram\/shared$/, replacement: resolve(repoRoot, "plugins/diagram/src/shared/index.ts") },
      { find: /^@hachej\/boring-transcription\/front$/, replacement: resolve(repoRoot, "plugins/live-transcription/src/front/index.tsx") },
      { find: /^@hachej\/boring-transcription\/server$/, replacement: resolve(repoRoot, "plugins/live-transcription/src/server/index.ts") },
      { find: /^@hachej\/boring-ui-plugin-cli$/, replacement: resolve(repoRoot, "packages/plugin-cli/src/index.ts") },
    ],
  },
})
