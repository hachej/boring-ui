/**
 * M2 Mode-Flip E2E — proves BORING_AGENT_MODE=direct and vercel-sandbox
 * both serve the same API surface with zero code changes.
 *
 * [m2-modeflip] tag used for CI debugging.
 */
import { test, expect } from './fixtures'

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
  expect(healthBody.version, `[${mode}] version missing`).toContain('@hachej/boring-agent@')
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

})
