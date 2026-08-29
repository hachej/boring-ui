import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { sandboxSourceAlias } from '../../scripts/vite-sandbox-alias.ts'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@hachej\/boring-agent\/server$/, replacement: resolve(repositoryRoot, 'packages/agent/src/server/index.ts') },
      { find: /^@hachej\/boring-agent\/server\/agent-host\/testing\/compositionRouteProof$/, replacement: resolve(repositoryRoot, 'packages/agent/src/server/agent-host/testing/compositionRouteProof.ts') },
      { find: /^@hachej\/boring-agent\/shared$/, replacement: resolve(repositoryRoot, 'packages/agent/src/shared/index.ts') },
      { find: /^@hachej\/boring-bash\/server$/, replacement: resolve(repositoryRoot, 'packages/boring-bash/src/server/index.ts') },
      { find: /^@hachej\/boring-bash\/agent$/, replacement: resolve(repositoryRoot, 'packages/boring-bash/src/agent/index.ts') },
      sandboxSourceAlias,
      { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: resolve(repositoryRoot, 'packages/workspace/src/app/server/index.ts') },
      { find: /^@hachej\/boring-workspace\/app\/front$/, replacement: resolve(repositoryRoot, 'packages/workspace/src/app/front/index.ts') },
      { find: /^@hachej\/boring-workspace\/server$/, replacement: resolve(repositoryRoot, 'packages/workspace/src/server/index.ts') },
      { find: /^@hachej\/boring-workspace$/, replacement: resolve(repositoryRoot, 'packages/workspace/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'e2e/**/*.test.ts'],
    environment: 'node',
    setupFiles: [
      './src/server/__tests__/_setup.ts',
      './src/front/__tests__/_setup.ts',
      './src/front/__tests__/_setup-matchers.ts',
    ],
    reporters: ['default'],
  },
})
