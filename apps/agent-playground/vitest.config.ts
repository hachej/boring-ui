import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { sandboxSourceAlias } from '../../scripts/vite-sandbox-alias.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')

export default defineConfig({
  cacheDir: resolve(process.env.TMPDIR ?? '/tmp', 'boring-ui-v2-agent-playground-vitest-cache'),
  resolve: {
    alias: [
      { find: /^@hachej\/boring-agent\/server$/, replacement: resolve(repositoryRoot, 'packages/agent/src/server/index.ts') },
      { find: /^@hachej\/boring-agent\/server\/agent-host\/testing\/compositionRouteProof$/, replacement: resolve(repositoryRoot, 'packages/agent/src/server/agent-host/testing/compositionRouteProof.ts') },
      { find: /^@hachej\/boring-agent\/shared$/, replacement: resolve(repositoryRoot, 'packages/agent/src/shared/index.ts') },
      { find: /^@hachej\/boring-bash\/server$/, replacement: resolve(repositoryRoot, 'packages/boring-bash/src/server/index.ts') },
      { find: /^@hachej\/boring-bash\/agent$/, replacement: resolve(repositoryRoot, 'packages/boring-bash/src/agent/index.ts') },
      sandboxSourceAlias,
    ],
  },
  test: { environment: 'node' },
})
