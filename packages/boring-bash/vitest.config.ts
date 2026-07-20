import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const repoRoot = resolve(__dirname, '..', '..')

export default defineConfig({
  resolve: {
    alias: {
      '@hachej/boring-agent/shared': resolve(repoRoot, 'packages/agent/src/shared/index.ts'),
      '@hachej/boring-bash/agent': resolve(repoRoot, 'packages/boring-bash/src/agent/index.ts'),
      '@hachej/boring-bash/server': resolve(repoRoot, 'packages/boring-bash/src/server/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
})
