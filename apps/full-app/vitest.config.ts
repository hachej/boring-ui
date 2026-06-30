import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { createBoringAppViteAliases } from '@hachej/boring-core/app/vite'

const boringAliases = createBoringAppViteAliases({ appRoot: __dirname })
const repoRoot = path.resolve(__dirname, '../..')

// Unit tests only (server config/guards). The Playwright e2e specs under e2e/
// are run separately via `pnpm e2e`, not vitest.
export default defineConfig({
  resolve: {
    ...boringAliases,
    alias: [
      ...boringAliases.alias,
      { find: /^@hachej\/boring-mcp\/server$/, replacement: path.resolve(repoRoot, 'plugins/boring-mcp/src/server/index.ts') },
      { find: /^@hachej\/boring-mcp\/front$/, replacement: path.resolve(repoRoot, 'plugins/boring-mcp/src/front/index.tsx') },
      { find: /^@hachej\/boring-mcp\/shared$/, replacement: path.resolve(repoRoot, 'plugins/boring-mcp/src/shared/index.ts') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
