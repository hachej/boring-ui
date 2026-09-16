import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { sandboxSourceAlias } from '../../scripts/vite-sandbox-alias.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')

export default defineConfig({
  cacheDir: resolve(process.env.TMPDIR ?? '/tmp', 'boring-ui-v2-one-chat-playground-vitest-cache'),
  resolve: {
    alias: [
      { find: /^@hachej\/boring-agent\/server$/, replacement: resolve(repositoryRoot, 'packages/agent/src/server/index.ts') },
      { find: /^@hachej\/boring-agent\/shared$/, replacement: resolve(repositoryRoot, 'packages/agent/src/shared/index.ts') },
      // The ask-user plugin's server core needs exactly one schema from the
      // workspace package. Point it at that source module so these tests run
      // without building (or depending on) the whole workspace.
      { find: /^@hachej\/boring-workspace\/shared$/, replacement: resolve(repositoryRoot, 'packages/workspace/src/shared/artifacts/humanArtifact.ts') },
      { find: /^@hachej\/boring-bash\/server$/, replacement: resolve(repositoryRoot, 'packages/boring-bash/src/server/index.ts') },
      { find: /^@hachej\/boring-bash\/agent$/, replacement: resolve(repositoryRoot, 'packages/boring-bash/src/agent/index.ts') },
      sandboxSourceAlias,
    ],
  },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'eval/**/*.test.ts'] },
})
