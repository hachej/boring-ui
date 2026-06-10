import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const repoRoot = resolve(agentRoot, '..', '..')

describe('agent playground dev server', () => {
  test('serves agent front code from source instead of stale dist', () => {
    const serverSource = readFileSync(
      resolve(repoRoot, 'apps/agent-playground/src/server/index.ts'),
      'utf8',
    )

    const stylesAlias = serverSource.indexOf("'@hachej/boring-agent/front/styles.css'")
    const frontAlias = serverSource.indexOf("'@hachej/boring-agent/front':")
    const sharedAlias = serverSource.indexOf("'@hachej/boring-agent/shared'")
    const rootAlias = serverSource.indexOf("'@': agentSourceRoot")

    expect(stylesAlias).toBeGreaterThanOrEqual(0)
    expect(frontAlias).toBeGreaterThan(stylesAlias)
    expect(sharedAlias).toBeGreaterThan(frontAlias)
    expect(rootAlias).toBeGreaterThan(sharedAlias)
    expect(serverSource).toContain("path.resolve(agentSourceRoot, 'front/index.ts')")
    expect(serverSource).toContain("path.resolve(agentSourceRoot, 'front/styles/globals.css')")
    expect(serverSource).toContain("path.resolve(agentSourceRoot, 'shared/index.ts')")
    expect(serverSource).toContain("process.env.FRONTEND_STRICT_PORT === '1'")
    expect(serverSource).toContain('strictPort: frontendStrictPort')
  })
})
