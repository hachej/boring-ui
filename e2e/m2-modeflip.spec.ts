/**
 * M2 Mode-Flip E2E — proves BORING_AGENT_MODE=direct and vercel-sandbox
 * both serve the same API surface with zero code changes.
 *
 * [m2-modeflip] tag used for CI debugging.
 */
import { test, expect } from './fixtures'
import {
  spawnBackend,
  formatLogs,
  type SpawnedBackend,
} from './helpers/backend'
import { createE2eWorkspace, type E2eWorkspace } from './helpers/workspace'

const VERCEL_OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID ?? 'team_77SfdGMGep3AgqZC3sw8RbJi'
const HAS_VERCEL_CREDS = Boolean(VERCEL_OIDC_TOKEN)

function log(msg: string, meta: Record<string, unknown> = {}): void {
  const ts = new Date().toISOString()
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
  process.stderr.write(`[m2-modeflip] [${ts}] ${msg}${metaStr}\n`)
}

async function assertFileRoundTrip(
  apiUrl: string,
  mode: string,
): Promise<void> {
  const testFile = `m2-modeflip-${Date.now()}.txt`
  const testContent = `written by mode-flip test in ${mode} mode at ${new Date().toISOString()}`

  log('writing test file', { mode, file: testFile })
  const writeRes = await fetch(`${apiUrl}/api/v1/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: testFile, content: testContent }),
  })
  expect(writeRes.ok, `[${mode}] write file failed: ${writeRes.status}`).toBe(true)

  log('reading test file back', { mode, file: testFile })
  const readRes = await fetch(`${apiUrl}/api/v1/files?path=${encodeURIComponent(testFile)}`)
  expect(readRes.ok, `[${mode}] read file failed: ${readRes.status}`).toBe(true)
  const readBody = (await readRes.json()) as { content?: string }
  expect(readBody.content, `[${mode}] file content mismatch`).toBe(testContent)

  log('deleting test file', { mode, file: testFile })
  const delRes = await fetch(`${apiUrl}/api/v1/files?path=${encodeURIComponent(testFile)}`, {
    method: 'DELETE',
  })
  expect(delRes.ok, `[${mode}] delete file failed: ${delRes.status}`).toBe(true)

  log('verifying file deleted', { mode, file: testFile })
  const checkRes = await fetch(`${apiUrl}/api/v1/files?path=${encodeURIComponent(testFile)}`)
  expect(checkRes.status, `[${mode}] file should be gone`).toBe(404)
}

async function assertTreeListing(
  apiUrl: string,
  mode: string,
): Promise<void> {
  log('listing tree root', { mode })
  const treeRes = await fetch(`${apiUrl}/api/v1/tree?path=.`)
  expect(treeRes.ok, `[${mode}] tree listing failed: ${treeRes.status}`).toBe(true)
  const treeBody = (await treeRes.json()) as { entries?: Array<{ name: string; kind: string }> }
  expect(Array.isArray(treeBody.entries), `[${mode}] tree entries not array`).toBe(true)
  log('tree listing returned entries', { mode, count: treeBody.entries!.length })
}

async function assertHealthEndpoint(
  apiUrl: string,
  mode: string,
): Promise<void> {
  log('checking /health', { mode })
  const healthRes = await fetch(`${apiUrl}/health`)
  expect(healthRes.ok, `[${mode}] health check failed`).toBe(true)
  const healthBody = (await healthRes.json()) as { version?: string; status?: string }
  expect(healthBody.version, `[${mode}] version missing`).toContain('@boring/agent@')
  expect(healthBody.status, `[${mode}] status missing`).toBe('ok')
  log('health OK', { mode, version: healthBody.version })
}

async function assertReadyEndpoint(
  apiUrl: string,
  mode: string,
): Promise<void> {
  log('checking /ready', { mode })
  const maxWait = 30_000
  const start = Date.now()
  let readyStatus = ''

  while (Date.now() - start < maxWait) {
    const readyRes = await fetch(`${apiUrl}/ready`)
    const readyBody = (await readyRes.json()) as { status?: string }
    readyStatus = readyBody.status ?? ''
    if (readyStatus === 'ready') {
      log('ready OK', { mode, waitMs: Date.now() - start })
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  throw new Error(`[${mode}] /ready never reached 'ready' state (last: ${readyStatus})`)
}

test.describe('M2: mode flip — zero code changes', () => {
  test('direct mode: health, ready, tree, file CRUD all work', async ({
    workspace,
    backend,
  }) => {
    log('=== direct mode test start ===', { workspace: workspace.root })

    await assertHealthEndpoint(backend.apiUrl, 'direct')
    await assertReadyEndpoint(backend.apiUrl, 'direct')
    await assertTreeListing(backend.apiUrl, 'direct')
    await assertFileRoundTrip(backend.apiUrl, 'direct')

    log('=== direct mode test PASS ===')
  })

  const vercelDescribe = HAS_VERCEL_CREDS ? test.describe : test.describe.skip
  vercelDescribe('vercel-sandbox mode (requires VERCEL_OIDC_TOKEN)', () => {
    let vercelBackend: SpawnedBackend
    let vercelWorkspace: E2eWorkspace

    test.beforeAll(async () => {
      log('=== vercel-sandbox mode setup ===', {
        hasOidcToken: Boolean(VERCEL_OIDC_TOKEN),
        teamId: VERCEL_TEAM_ID,
      })

      vercelWorkspace = await createE2eWorkspace()
      const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

      const startTime = Date.now()
      vercelBackend = await spawnBackend({
        workspaceRoot: vercelWorkspace.root,
        repoRoot,
        mode: 'vercel-sandbox',
        env: {
          VERCEL_OIDC_TOKEN: VERCEL_OIDC_TOKEN!,
          VERCEL_TEAM_ID,
        },
        timeoutMs: 60_000,
      })
      const coldStartMs = Date.now() - startTime
      log('vercel-sandbox backend booted', {
        port: vercelBackend.port,
        coldStartMs,
      })
    })

    test.afterAll(async () => {
      if (vercelBackend) {
        await vercelBackend.stop()
        log('vercel-sandbox backend stopped')
      }
      if (vercelWorkspace) {
        await vercelWorkspace.cleanup()
      }
    })

    test('health check works in vercel-sandbox mode', async () => {
      await assertHealthEndpoint(vercelBackend.apiUrl, 'vercel-sandbox')
    })

    test('ready check resolves in vercel-sandbox mode', async () => {
      await assertReadyEndpoint(vercelBackend.apiUrl, 'vercel-sandbox')
    })

    test('tree listing works in vercel-sandbox mode', async () => {
      await assertTreeListing(vercelBackend.apiUrl, 'vercel-sandbox')
    })

    test('file CRUD works in vercel-sandbox mode', async () => {
      await assertFileRoundTrip(vercelBackend.apiUrl, 'vercel-sandbox')
    })

    test('same API shape as direct mode — no code changes needed', async () => {
      log('verifying API shape equivalence')

      const healthRes = await fetch(`${vercelBackend.apiUrl}/health`)
      const healthBody = (await healthRes.json()) as Record<string, unknown>
      expect(healthBody).toHaveProperty('status')
      expect(healthBody).toHaveProperty('version')
      expect(healthBody).toHaveProperty('uptime')

      const treeRes = await fetch(`${vercelBackend.apiUrl}/api/v1/tree?path=.`)
      const treeBody = (await treeRes.json()) as Record<string, unknown>
      expect(treeBody).toHaveProperty('entries')

      const writeRes = await fetch(`${vercelBackend.apiUrl}/api/v1/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'api-shape-test.txt', content: 'test' }),
      })
      const writeBody = (await writeRes.json()) as Record<string, unknown>
      expect(writeBody).toHaveProperty('ok')

      const readRes = await fetch(`${vercelBackend.apiUrl}/api/v1/files?path=api-shape-test.txt`)
      const readBody = (await readRes.json()) as Record<string, unknown>
      expect(readBody).toHaveProperty('content')

      log('=== vercel-sandbox mode test PASS — API shape matches direct ===')
    })
  })
})
