import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const SERVER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const HOST_FS_ALLOWLIST = new Set([
  // Trusted package definitions are host application code, not app workspaces.
  'agentPackages.ts',
  // apps.json is explicit host control-plane state under ONE_CHAT_APPS_ROOT.
  'appRegistryState.ts',
])

describe('workspace boundary guard', () => {
  test('production server workspace code has no direct fs imports or watchers', async () => {
    const violations: string[] = []
    for (const entry of await readdir(SERVER_ROOT, { withFileTypes: true })) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith('.ts') ||
        HOST_FS_ALLOWLIST.has(entry.name)
      )
        continue
      const source = await readFile(path.join(SERVER_ROOT, entry.name), 'utf8')
      if (/from\s+['"]node:fs(?:\/promises)?['"]/.test(source))
        violations.push(`${entry.name}: node:fs import`)
      if (/\bfs\.watch\b|\bwatch\s*\(/.test(source))
        violations.push(`${entry.name}: filesystem watcher`)
      if (/\breadFileSync\b/.test(source))
        violations.push(`${entry.name}: readFileSync`)
    }
    expect(violations).toEqual([])
  })
})
