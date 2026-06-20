/**
 * Real end-to-end validation of WorkspaceBridge RPC v1.
 *
 * Boots the ACTUAL single-tenant `createWorkspaceAgentServer` on a real port
 * and drives the bridge over real HTTP (fetch). No mocks.
 *
 * Exercises the generic bridge paths this PR owns:
 *   - runtimeCore registry bootstrap + dispatch
 *   - browser auth (createLocalCliBridgeAuthPolicy)
 *   - runtime token mint/verify
 *   - idempotency replay + failure-releases-key
 *   - trusted boot-time server-plugin handler contribution
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceAgentServer } from '@hachej/boring-workspace/app/server'
import { defineServerPlugin, mintWorkspaceBridgeRuntimeToken } from '@hachej/boring-workspace/server'

const SECRET = 'e2e-test-secret-do-not-use-in-prod'
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
    plugins: [defineServerPlugin({
      id: 'bridge-e2e-internal-plugin',
      workspaceBridgeHandlers: [{
        definition: pluginDef,
        handler: ({ input }) => ({ pluginEchoed: input }),
      }],
    })],
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
      const r = await post({ op: 'example.v1.echo', input: { hi: 'browser' }, idempotencyKey: 'k-browser-1' })
      check('T1 browser dispatch (local-cli auth)', r.status === 200 && r.json.ok === true && r.json.output?.echoed?.hi === 'browser', `status=${r.status} seq=${r.json.output?.seq}`)
    }

    // T2 — unknown op → 404 OpNotFound
    {
      const r = await post({ op: 'example.v1.nope', input: {} })
      check('T2 unknown op → 404 OpNotFound', r.status === 404 && r.json.error?.code === 'BRIDGE_OP_NOT_FOUND', `status=${r.status} code=${r.json.error?.code}`)
    }

    // T3 — runtime-class dispatch with a minted token
    {
      const token = mintWorkspaceBridgeRuntimeToken({ secret: SECRET, workspaceId: 'default', capabilities: [], runtimeId: 'e2e-runtime' })
      const r = await post({ op: 'example.v1.echo', input: { hi: 'runtime' }, idempotencyKey: 'k-runtime-1' }, { authorization: `Bearer ${token}` })
      check('T3 runtime token dispatch', r.status === 200 && r.json.ok === true && r.json.output?.echoed?.hi === 'runtime', `status=${r.status} seq=${r.json.output?.seq}`)
    }

    // T4 — invalid runtime token → 401
    {
      const r = await post({ op: 'example.v1.echo', input: {} }, { authorization: 'Bearer not.a.valid.token' })
      check('T4 invalid token → 401', r.status === 401, `status=${r.status} code=${r.json.error?.code}`)
    }

    // T5 — idempotency replay: same key returns the cached response (same seq)
    {
      const r1 = await post({ op: 'example.v1.echo', input: { n: 5 }, idempotencyKey: 'k-replay' })
      const r2 = await post({ op: 'example.v1.echo', input: { n: 5 }, idempotencyKey: 'k-replay' })
      check('T5 idempotency replay (cached, same seq)', r1.json.ok && r2.json.ok && r1.json.output?.seq === r2.json.output?.seq, `seq1=${r1.json.output?.seq} seq2=${r2.json.output?.seq}`)
    }

    // T6 — failure releases the key: first call fails, retry with SAME key succeeds
    {
      const r1 = await post({ op: 'example.v1.fail', input: { x: 1 }, idempotencyKey: 'k-fail' })
      const r2 = await post({ op: 'example.v1.fail', input: { x: 1 }, idempotencyKey: 'k-fail' })
      const failedThenRecovered = r1.json.ok === false && r2.json.ok === true && r2.json.output?.recovered === true
      check('T6 failure releases key (retry re-executes, not cached failure)', failedThenRecovered, `attempt1.ok=${r1.json.ok} attempt2.ok=${r2.json.ok} recovered=${r2.json.output?.recovered}`)
    }

    // T7 — trusted boot-time plugin contribution registers a host bridge op.
    {
      const r = await post({ op: 'plugin.v1.echo', input: { from: 'plugin' } })
      check('T7 trusted server-plugin bridge handler contribution', r.status === 200 && r.json.ok === true && r.json.output?.pluginEchoed?.from === 'plugin', `status=${r.status}`)
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
