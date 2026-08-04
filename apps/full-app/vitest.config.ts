import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { createBoringAppViteAliases } from '../../packages/core/src/app/vite/index.ts'

const appRoot = import.meta.dirname
const boringAliases = createBoringAppViteAliases({ appRoot })
const repoRoot = path.resolve(appRoot, '../..')

// Unit tests only (server config/guards). The Playwright e2e specs under e2e/
// are run separately via `pnpm e2e`, not vitest.
export default defineConfig({
  resolve: {
    ...boringAliases,
    alias: [
      ...boringAliases.alias,
      { find: /^@hachej\/boring-bash\/agent$/, replacement: path.resolve(repoRoot, 'packages/boring-bash/src/agent/index.ts') },
      { find: /^@hachej\/boring-bash\/server$/, replacement: path.resolve(repoRoot, 'packages/boring-bash/src/server/index.ts') },
      { find: /^@hachej\/boring-agent\/shared$/, replacement: path.resolve(repoRoot, 'packages/agent/src/shared/index.ts') },
      { find: /^@hachej\/boring-agent\/server$/, replacement: path.resolve(repoRoot, 'packages/agent/src/server/index.ts') },
      { find: /^@hachej\/boring-sandbox\/shared$/, replacement: path.resolve(repoRoot, 'packages/boring-sandbox/src/shared/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/direct$/, replacement: path.resolve(repoRoot, 'packages/boring-sandbox/src/providers/direct/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/bwrap$/, replacement: path.resolve(repoRoot, 'packages/boring-sandbox/src/providers/bwrap/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/node-workspace$/, replacement: path.resolve(repoRoot, 'packages/boring-sandbox/src/providers/node-workspace/index.ts') },
      { find: /^@hachej\/boring-sandbox\/providers\/vercel-sandbox$/, replacement: path.resolve(repoRoot, 'packages/boring-sandbox/src/providers/vercel-sandbox/index.ts') },
      { find: /^@hachej\/boring-core\/app\/server$/, replacement: path.resolve(repoRoot, 'packages/core/src/app/server/index.ts') },
      { find: /^@hachej\/boring-core\/server$/, replacement: path.resolve(repoRoot, 'packages/core/src/server/index.ts') },
      { find: /^@hachej\/boring-workspace\/app\/server$/, replacement: path.resolve(repoRoot, 'packages/workspace/src/app/server/index.ts') },
      { find: /^@hachej\/boring-workspace\/server$/, replacement: path.resolve(repoRoot, 'packages/workspace/src/server/index.ts') },
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
