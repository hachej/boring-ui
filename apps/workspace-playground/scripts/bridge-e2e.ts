/**
 * Real end-to-end validation of WorkspaceBridge RPC v1.
 *
 * Boots the ACTUAL single-tenant `createWorkspaceAgentServer` (the factory
 * refactored in this PR — it now bootstraps via `createWorkspaceBridgeRuntimeCore`)
 * on a real port and drives the bridge over real HTTP (fetch). No mocks.
 *
 * Exercises every code path this PR touched:
 *   - runtimeCore registry bootstrap + dispatch
 *   - browser auth (createLocalCliBridgeAuthPolicy — Wave 1 rewrite)
 *   - runtime token mint/verify (Wave 1 slimmed claims)
 *   - idempotency replay + failure-releases-key (Wave 1 status simplification)
 *   - human-input request→answer cycle (pendingQuestionRuntime from runtimeCore)
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'
import { mintWorkspaceBridgeRuntimeToken } from '@hachej/boring-workspace/server'

const SECRET = 'e2e-test-secret-do-not-use-in-prod'
const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- demo bridge handlers (deterministic, no LLM) ---
let echoSeq = 0
const echoDef = {
  op: 'demo.echo.v1',
  callerClassesAllowed: ['browser', 'runtime', 'server'] as const,
  requiredCapabilities: [] as const,
  idempotencyPolicy: 'required' as const,
}
const echoHandler = async ({ input }: { input: unknown }) => ({ echoed: input, seq: ++echoSeq })

let failAttempts = 0
const failDef = {
  op: 'demo.fail.v1',
  callerClassesAllowed: ['browser', 'runtime', 'server'] as const,
  requiredCapabilities: [] as const,
  idempotencyPolicy: 'required' as const,
}
const failHandler = async () => {
  failAttempts += 1
  if (failAttempts === 1) throw new Error('intentional first-attempt failure')
  return { recovered: true, attempt: failAttempts }
}

async function main() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'bridge-e2e-'))
  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: 'local',
    logger: false,
    provisionWorkspace: false,
    defaults: [],
    workspaceBridge: {
      runtimeTokenSecret: SECRET,
      handlers: [
        { definition: echoDef, handler: echoHandler },
        { definition: failDef, handler: failHandler },
      ],
    },
  } as Parameters<typeof createWorkspaceAgentServer>[0])

  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  const base = address.replace('127.0.0.1', '127.0.0.1')
  const url = `${base}/api/v1/workspace-bridge/call`
  console.log(`\n[bridge-e2e] server listening at ${base}\n`)

  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: (await res.json()) as any }
  }

  try {
    // T1 — browser-class dispatch via local-cli auth policy (no token)
    {
      const r = await post({ op: 'demo.echo.v1', input: { hi: 'browser' }, idempotencyKey: 'k-browser-1' })
      check('T1 browser dispatch (local-cli auth)', r.status === 200 && r.json.ok === true && r.json.output?.echoed?.hi === 'browser', `status=${r.status} seq=${r.json.output?.seq}`)
    }

    // T2 — unknown op → 404 OpNotFound
    {
      const r = await post({ op: 'demo.nope.v1', input: {} })
      check('T2 unknown op → 404 OpNotFound', r.status === 404 && r.json.error?.code === 'BRIDGE_OP_NOT_FOUND', `status=${r.status} code=${r.json.error?.code}`)
    }

    // T3 — runtime-class dispatch with a minted token
    {
      const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: 'default', capabilities: [], runtimeId: 'e2e-runtime' })
      const r = await post({ op: 'demo.echo.v1', input: { hi: 'runtime' }, idempotencyKey: 'k-runtime-1' }, { authorization: `Bearer ${token}` })
      check('T3 runtime token dispatch', r.status === 200 && r.json.ok === true && r.json.output?.echoed?.hi === 'runtime', `status=${r.status} seq=${r.json.output?.seq}`)
    }

    // T4 — invalid runtime token → 401
    {
      const r = await post({ op: 'demo.echo.v1', input: {} }, { authorization: 'Bearer not.a.valid.token' })
      check('T4 invalid token → 401', r.status === 401, `status=${r.status} code=${r.json.error?.code}`)
    }

    // T5 — idempotency replay: same key returns the cached response (same seq)
    {
      const r1 = await post({ op: 'demo.echo.v1', input: { n: 5 }, idempotencyKey: 'k-replay' })
      const r2 = await post({ op: 'demo.echo.v1', input: { n: 5 }, idempotencyKey: 'k-replay' })
      check('T5 idempotency replay (cached, same seq)', r1.json.ok && r2.json.ok && r1.json.output?.seq === r2.json.output?.seq, `seq1=${r1.json.output?.seq} seq2=${r2.json.output?.seq}`)
    }

    // T6 — failure releases the key: first call fails, retry with SAME key succeeds
    {
      const r1 = await post({ op: 'demo.fail.v1', input: { x: 1 }, idempotencyKey: 'k-fail' })
      const r2 = await post({ op: 'demo.fail.v1', input: { x: 1 }, idempotencyKey: 'k-fail' })
      const failedThenRecovered = r1.json.ok === false && r2.json.ok === true && r2.json.output?.recovered === true
      check('T6 failure releases key (retry re-executes, not cached failure)', failedThenRecovered, `attempt1.ok=${r1.json.ok} attempt2.ok=${r2.json.ok} recovered=${r2.json.output?.recovered}`)
    }

    // T7 — human-input request→answer cycle (the headline bridge feature)
    {
      const sessionId = 'e2e-session'
      const requestId = 'e2e-req-1'
      const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: 'default', sessionId, capabilities: ['human-input:request'], runtimeId: 'e2e-runtime' })

      // Agent (runtime) asks — this call BLOCKS until answered. The envelope
      // `requestId` drives the "request-id" idempotency policy (matches the real
      // ask-user client: `{ op, requestId: input.requestId, input }`).
      const requestPromise = post(
        { op: 'human-input.v1.request', requestId, input: { requestId, sessionId, payload: { prompt: 'Pick one' } } },
        { authorization: `Bearer ${token}`, 'x-boring-session-id': sessionId },
      )

      // Browser polls pending until the question shows up:
      let pending: any = null
      for (let i = 0; i < 50 && !pending; i++) {
        const p = await post({ op: 'human-input.v1.pending', input: { sessionId } }, { 'x-boring-session-id': sessionId })
        pending = p.json.output?.pending ?? null
        if (!pending) await new Promise((r) => setTimeout(r, 50))
      }
      const haveQuestion = !!pending?.questionId && !!pending?.nonce
      check('T7a human-input question created + visible to browser', haveQuestion, `questionId=${pending?.questionId} status=${pending?.status}`)

      // Browser answers (answer op is idempotency "required" → needs a key):
      const ans = await post(
        { op: 'human-input.v1.answer', idempotencyKey: 'k-answer-1', input: { questionId: pending?.questionId, sessionId, nonce: pending?.nonce, values: { choice: 'A' } } },
        { 'x-boring-session-id': sessionId },
      )
      check('T7b browser answer accepted', ans.status === 200 && ans.json.ok === true && ans.json.output?.status === 'answered', `status=${ans.status} result=${ans.json.output?.status}`)

      // The blocked runtime request now resolves with the answer (timeout-guarded):
      const requestResult = await Promise.race([
        requestPromise,
        new Promise<{ json: any }>((resolve) => setTimeout(() => resolve({ json: { ok: false, output: 'TIMEOUT' } }), 5000)),
      ])
      const resolved = requestResult.json.ok === true && JSON.stringify(requestResult.json.output ?? {}).includes('"A"')
      check('T7c blocked runtime request resolves with the answer', resolved, `ok=${requestResult.json.ok} output=${JSON.stringify(requestResult.json.output)}`)
    }
  } finally {
    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n==== RESULT: ${passed}/${results.length} checks passed ====`)
  if (passed !== results.length) process.exit(1)
}

main().catch((err) => {
  console.error('[bridge-e2e] fatal:', err)
  process.exit(1)
})
