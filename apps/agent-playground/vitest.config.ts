import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

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
      { find: /^@hachej\/boring-sandbox\/shared$/, replacement: resolve(repositoryRoot, 'packages/boring-sandbox/src/shared/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/direct$/, replacement: resolve(repositoryRoot, 'packages/boring-sandbox/src/providers/direct/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/bwrap$/, replacement: resolve(repositoryRoot, 'packages/boring-sandbox/src/providers/bwrap/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/node-workspace$/, replacement: resolve(repositoryRoot, 'packages/boring-sandbox/src/providers/node-workspace/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/vercel-sandbox$/, replacement: resolve(repositoryRoot, 'packages/boring-sandbox/src/providers/vercel-sandbox/index.ts') },
    ],
  },
  test: { environment: 'node' },
})
