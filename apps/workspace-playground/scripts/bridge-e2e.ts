/**
 * Real end-to-end validation of WorkspaceBridge RPC v1.
 *
 * Boots the ACTUAL single-tenant `createWorkspaceAgentServer` on a real port
 * and drives the bridge over real HTTP (fetch). No mocks.
 *
 * Exercises the generic bridge paths this PR owns:
 *   - runtimeCore registry bootstrap + dispatch
 *   - browser auth (createLocalCliBridgeAuthPolicy)
 *   - runtime token mint/verify + refresh-token re-mint endpoint
 *   - idempotency replay + failure-releases-key
 *   - trusted boot-time server-plugin handler contribution
 *   - plugin-owned ask-user request→answer cycle
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'
import { WorkspaceBridgeClient } from '@hachej/boring-workspace/bridge-client'
import { defineServerPlugin, mintWorkspaceBridgeRuntimeRefreshToken, mintWorkspaceBridgeRuntimeToken } from '@hachej/boring-workspace/server'
import { createAskUserServerPlugin } from '@hachej/boring-ask-user/server'
import { ASK_USER_BRIDGE_CAPABILITIES, ASK_USER_BRIDGE_OPS } from '@hachej/boring-ask-user/shared'

const SECRET = 'e2e-test-secret-do-not-use-in-prod'
const REFRESH_SECRET = 'e2e-refresh-secret-do-not-use-prod'
const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- demo bridge handlers (deterministic, no LLM) ---
let echoSeq = 0
const echoDef = {
  op: 'example.v1.echo',
  version: 1,
  owner: 'workspace-playground',
  callerClassesAllowed: ['browser', 'runtime', 'server'] as const,
  requiredCapabilities: [] as const,
  inputSchema: { type: 'object' },
  timeoutMs: 1000,
  maxInputBytes: 1024,
  maxOutputBytes: 1024,
  idempotencyPolicy: 'required' as const,
}
const echoHandler = async ({ input }: { input: unknown }) => ({ echoed: input, seq: ++echoSeq })

let failAttempts = 0
const failDef = {
  op: 'example.v1.fail',
  version: 1,
  owner: 'workspace-playground',
  callerClassesAllowed: ['browser', 'runtime', 'server'] as const,
  requiredCapabilities: [] as const,
  inputSchema: { type: 'object' },
  timeoutMs: 1000,
  maxInputBytes: 1024,
  maxOutputBytes: 1024,
  idempotencyPolicy: 'required' as const,
}
const failHandler = async () => {
  failAttempts += 1
  if (failAttempts === 1) throw new Error('intentional first-attempt failure')
  return { recovered: true, attempt: failAttempts }
}

const pluginDef = {
  op: 'plugin.v1.echo',
  version: 1,
  owner: 'workspace-playground-plugin',
  callerClassesAllowed: ['browser', 'runtime', 'server'] as const,
  requiredCapabilities: [] as const,
  inputSchema: { type: 'object' },
  timeoutMs: 1000,
  maxInputBytes: 1024,
  maxOutputBytes: 1024,
  idempotencyPolicy: 'none' as const,
}

async function main() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'bridge-e2e-'))
  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: 'local',
    logger: false,
    provisionWorkspace: false,
    defaults: [],
    plugins: [
      defineServerPlugin({
        id: 'bridge-e2e-internal-plugin',
        workspaceBridgeHandlers: [{
          definition: pluginDef,
          handler: ({ input }) => ({ pluginEchoed: input }),
        }],
      }),
      createAskUserServerPlugin({ workspaceRoot, sessionId: 's1' }),
    ],
    workspaceBridge: {
      runtimeTokenSecret: SECRET,
      runtimeRefreshTokenSecret: REFRESH_SECRET,
      handlers: [
        { definition: echoDef, handler: echoHandler },
        { definition: failDef, handler: failHandler },
      ],
    },
  } as Parameters<typeof createWorkspaceAgentServer>[0])

  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  const base = address.replace('127.0.0.1', '127.0.0.1')
  const url = `${base}/api/v1/workspace-bridge/call`
  const tokenUrl = `${base}/api/v1/workspace-bridge/token`
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
      const r = await post({ op: 'example.v1.echo', input: { hi: 'browser' }, idempotencyKey: 'k-browser-1' })
      check('T1 browser dispatch (local-cli auth)', r.status === 200 && r.json.ok === true && r.json.output?.echoed?.hi === 'browser', `status=${r.status} seq=${r.json.output?.seq}`)
    }

    // T2 — unknown op → 404 OpNotFound
    {
      const r = await post({ op: 'example.v1.nope', input: {} })
      check('T2 unknown op → 404 OpNotFound', r.status === 404 && r.json.error?.code === 'BRIDGE_OP_NOT_FOUND', `status=${r.status} code=${r.json.error?.code}`)
    }

    // T3 — runtime-class dispatch with a minted token through the public client.
    {
      const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: 'default', capabilities: [], runtimeId: 'e2e-runtime' })
      const client = new WorkspaceBridgeClient({ url, token, fetch })
      const output = await client.call<{ echoed?: { hi?: string }; seq?: number }>('example.v1.echo', { hi: 'runtime' }, { idempotencyKey: 'k-runtime-1' })
      check('T3 runtime token dispatch via client', output?.echoed?.hi === 'runtime', `seq=${output?.seq}`)
    }

    // T4 — invalid runtime token → 401
    {
      const r = await post({ op: 'example.v1.echo', input: {} }, { authorization: 'Bearer not.a.valid.token' })
      check('T4 invalid token → 401', r.status === 401, `status=${r.status} code=${r.json.error?.code}`)
    }

    // T5 — idempotency replay: same key returns the cached response (same seq), through the public client.
    {
      const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: 'default', capabilities: [], runtimeId: 'e2e-runtime' })
      const client = new WorkspaceBridgeClient({ url, token, fetch })
      const r1 = await client.call<{ seq?: number }>('example.v1.echo', { n: 5 }, { idempotencyKey: 'k-replay' })
      const r2 = await client.call<{ seq?: number }>('example.v1.echo', { n: 5 }, { idempotencyKey: 'k-replay' })
      check('T5 idempotency replay via client (cached, same seq)', r1.seq === r2.seq, `seq1=${r1.seq} seq2=${r2.seq}`)
    }

    // T6 — failure releases the key: first call fails, retry with SAME key succeeds, through the public client.
    {
      const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: 'default', capabilities: [], runtimeId: 'e2e-runtime' })
      const client = new WorkspaceBridgeClient({ url, token, fetch })
      let firstFailed = false
      try {
        await client.call('example.v1.fail', { x: 1 }, { idempotencyKey: 'k-fail' })
      } catch {
        firstFailed = true
      }
      const r2 = await client.call<{ recovered?: boolean; attempt?: number }>('example.v1.fail', { x: 1 }, { idempotencyKey: 'k-fail' })
      check('T6 failure releases key via client (retry re-executes, not cached failure)', firstFailed && r2.recovered === true, `attempt1.failed=${firstFailed} attempt2.recovered=${r2.recovered}`)
    }

    // T7 — trusted boot-time plugin contribution registers a host bridge op.
    {
      const r = await post({ op: 'plugin.v1.echo', input: { from: 'plugin' } })
      check('T7 trusted server-plugin bridge handler contribution', r.status === 200 && r.json.ok === true && r.json.output?.pluginEchoed?.from === 'plugin', `status=${r.status}`)
    }

    // T8 — refresh endpoint re-mints a runtime token that the public client can use.
    {
      const refreshToken = mintWorkspaceBridgeRuntimeRefreshToken({ secret: REFRESH_SECRET, workspaceId: 'default', capabilities: [], runtimeId: 'e2e-runtime', tokenTtlMs: 60_000 })
      const tokenRes = await fetch(tokenUrl, { method: 'POST', headers: { authorization: `Bearer ${refreshToken}`, 'content-type': 'application/json' }, body: '{}' })
      const tokenJson = await tokenRes.json() as any
      const client = new WorkspaceBridgeClient({ url, token: tokenJson.token, fetch })
      const output = await client.call<{ echoed?: { hi?: string } }>('example.v1.echo', { hi: 'refresh' }, { idempotencyKey: 'k-refresh' })
      check('T8 refresh endpoint re-mints usable runtime token', tokenRes.status === 200 && tokenJson.ok === true && output?.echoed?.hi === 'refresh', `status=${tokenRes.status}`)
    }

    // T9/T10 — ask-user owns and registers ask-user.v1.* bridge handlers.
    {
      const token = mintWorkspaceBridgeRuntimeToken({
        secret: SECRET,
        workspaceId: 'default',
        sessionId: 's1',
        capabilities: [ASK_USER_BRIDGE_CAPABILITIES.request],
        runtimeId: 'ask-user-e2e-runtime',
      })
      const askClient = new WorkspaceBridgeClient({ url, token, fetch })
      const requestPromise = askClient.call<any>(ASK_USER_BRIDGE_OPS.request, {
        sessionId: 's1',
        title: 'Bridge question',
        schema: { wireVersion: 1, fields: [{ type: 'text', name: 'answer', label: 'Answer', required: true }] },
        timeoutMs: 60_000,
      }, { requestId: 'ask-user-e2e-request', timeoutMs: 65_000 })

      let pending: any = null
      for (let i = 0; i < 40; i++) {
        const r = await post({ op: ASK_USER_BRIDGE_OPS.pending, input: { sessionId: 's1' } }, { 'x-boring-session-id': 's1' })
        pending = r.json.output?.pending ?? null
        if (pending?.questionId) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      check('T9 ask-user pending via plugin bridge', pending?.title === 'Bridge question' && typeof pending?.answerToken === 'string', `questionId=${pending?.questionId ?? 'none'}`)

      const answer = await post({
        op: ASK_USER_BRIDGE_OPS.answer,
        input: { questionId: pending?.questionId, sessionId: 's1', answerToken: pending?.answerToken, values: { answer: 'yes' } },
        idempotencyKey: 'ask-user-e2e-answer',
      }, { 'x-boring-session-id': 's1' })
      const request = await requestPromise
      check(
        'T10 ask-user answer resolves runtime client request',
        answer.status === 200 && answer.json.ok === true && request?.status === 'answered' && request?.answer?.values?.answer === 'yes',
        `answer.status=${answer.status} result=${request?.status}`,
      )
    }
  } finally {
    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n==== RESULT: ${passed}/${results.length} checks passed ====`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => {
  console.error('[bridge-e2e] fatal:', err)
  process.exit(1)
})
