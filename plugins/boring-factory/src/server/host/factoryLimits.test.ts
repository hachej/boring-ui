import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFactoryDelegatePlugin } from './delegatePlugin'
import type { FactoryEpicEntry, FactoryEpicRegistry } from './epicRegistry'
import type { FactorySessionBindings } from './sessionBindings'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

async function makeStateRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'factory-limits-'))
  temporaryRoots.push(root)
  return root
}

function dependencies(extraBindings: Record<string, string> = {}) {
  const entry: FactoryEpicEntry = {
    epicKey: 'limits-epic', featureName: 'Limits Epic', worktree: process.cwd(), branch: 'factory-limits',
    repositoryRoot: process.cwd(), createdAt: '2026-09-05T00:00:00.000Z', status: 'active',
  }
  const registry: FactoryEpicRegistry = {
    load: async () => [entry], list: async () => [entry], get: async (key) => key === entry.epicKey ? entry : undefined,
    register: async () => entry, setOrchestratorSession: async () => entry, markClosed: async () => ({ ...entry, status: 'closed' }),
  }
  const bindings: Record<string, string> = { orch: entry.epicKey, worker: entry.epicKey, ...extraBindings }
  const sessionBindings: FactorySessionBindings = {
    load: async () => ({ ...bindings }), get: async (id) => bindings[id],
    bind: vi.fn(async (id, key) => { bindings[id] = key }),
    unbind: vi.fn(async (id) => { delete bindings[id] }),
    inherit: async (parent, child) => { bindings[child] = bindings[parent]!; return bindings[child]! },
    reconcile: async () => ({ droppedSessionIds: [], restoredOrchestratorSessionIds: [] }),
  }
  return { registry, sessionBindings }
}

interface Bead {
  readonly id: string
  readonly status: string
  readonly assignee?: string | null
}

function fakeBr(
  beads: readonly Bead[] = [{ id: 'br-1', status: 'open' }],
  comments: Readonly<Record<string, readonly Record<string, unknown>[]>> = {},
) {
  const calls: Array<readonly string[]> = []
  const runBr = vi.fn(async (args: readonly string[]) => {
    calls.push(args)
    if (args[0] === 'list') return JSON.stringify({ issues: beads.map((bead) => ({ ...bead, labels: ['epic:limits-epic'] })) })
    if (args[0] === 'comments' && args[1] === 'list') return JSON.stringify(comments[args[2]!] ?? [])
    if (args[0] === 'update') return JSON.stringify([{ id: args[1] }])
    if (args[0] === 'comments' && args[1] === 'add') return JSON.stringify({ id: 1 })
    throw new Error(`unexpected br command: ${args.join(' ')}`)
  })
  return { runBr, calls }
}

interface WorkerSummary {
  readonly sessionId: string
  readonly status: string
  readonly updatedAt: number
}

interface FakeAppOptions {
  readonly workerSessionSnapshots?: readonly (readonly WorkerSummary[])[]
  readonly workerSessionStatusCode?: number
  readonly repeatWorkerCursor?: boolean
  readonly workerSessionPageCount?: number
  readonly crashAfterSessionCreation?: boolean
  readonly sessionCreationStatusCode?: number
  readonly summaryStatusCode?: number
  readonly summaryStatus?: string
  readonly summaryTurnCount?: number
  readonly finalStateStatus?: string
  readonly finalStateStatusCode?: number
}

function fakeApp(
  workerSessions: readonly WorkerSummary[] = [],
  childSessionIds: readonly string[] = ['child-1'],
  options: FakeAppOptions = {},
) {
  const calls: Array<{ method: string; url: string; payload?: unknown; headers?: Record<string, string> }> = []
  let created = 0
  let sessionListCalls = 0
  return {
    calls,
    app: {
      async inject(request: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) {
        calls.push(request)
        if (request.method === 'GET' && request.url.includes('/boring-worker/sessions') && !request.url.endsWith('/state')) {
          const snapshot = options.workerSessionSnapshots?.[Math.min(sessionListCalls, options.workerSessionSnapshots.length - 1)] ?? workerSessions
          sessionListCalls += 1
          return {
            statusCode: options.workerSessionStatusCode ?? 200,
            body: '',
            json: <T>() => ({
              sessions: snapshot.map((session) => ({ ref: { sessionId: session.sessionId }, ...session })),
              ...(options.repeatWorkerCursor
                ? { nextCursor: 'same-cursor' }
                : sessionListCalls < (options.workerSessionPageCount ?? 1)
                  ? { nextCursor: `page-${sessionListCalls + 1}` }
                  : {}),
            }) as T,
          }
        }
        if (request.method === 'POST' && request.url.endsWith('/sessions/summaries')) {
          const sessionIds = (request.payload as { sessionIds: string[] }).sessionIds
          return {
            statusCode: options.summaryStatusCode ?? 200,
            body: options.summaryStatusCode && options.summaryStatusCode !== 200 ? 'summary unavailable' : '',
            json: <T>() => ({ summaries: sessionIds.map((sessionId) => ({
              ref: { sessionId },
              status: options.summaryStatus ?? 'idle',
              turnCount: options.summaryTurnCount ?? 1,
            })) }) as T,
          }
        }
        if (request.method === 'POST' && request.url.endsWith('/sessions')) {
          const sessionId = childSessionIds[created++] ?? `child-${created}`
          return {
            statusCode: options.sessionCreationStatusCode ?? 201,
            body: options.sessionCreationStatusCode && options.sessionCreationStatusCode !== 201 ? 'session unavailable' : '',
            json: <T>() => {
              if (options.crashAfterSessionCreation) throw new Error('simulated host crash before ledger attach')
              return { sessionId } as T
            },
          }
        }
        if (request.method === 'POST' && request.url.endsWith('/prompt')) {
          return { statusCode: 202, body: '', json: <T>() => ({}) as T }
        }
        if (request.method === 'GET' && request.url.endsWith('/state')) {
          return {
            statusCode: options.finalStateStatusCode ?? 200,
            body: '',
            json: <T>() => ({
              summary: { turnCount: 1 },
              state: { status: options.finalStateStatus ?? 'idle', messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'done' }] }] },
            }) as T,
          }
        }
        throw new Error(`unexpected request ${request.method} ${request.url}`)
      },
    },
  }
}

const gitStatus = async () => ({ branch: 'factory-limits', head: 'a'.repeat(40), remoteHead: null, dirtyPaths: [] })
const context = (sessionId: string, toolCallId = 'call') => ({ abortSignal: new AbortController().signal, toolCallId, sessionId })

function toolNamed(handle: ReturnType<typeof createFactoryDelegatePlugin>, seat: string, name: string) {
  return (handle.plugin.agentToolFactory?.({ agentTypeId: seat }) ?? []).find((tool) => tool.name === name)!
}

describe('Factory host limits', () => {
  it('identifies the delegate polling runtime with its current content version', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings })

    const expected = `sha256:${createHash('sha256').update('factory-delegate.v5.2026-09-07').digest('hex')}`
    expect(handle.plugin.contentDigest).toBe(expected)
  })

  it('polls the summary projection and reads full state only once for the final answer', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const { app, calls } = fakeApp()
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, timeoutMs: 1_000 })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Implement the exact target Bead br-1 now.' }, context('orch'),
    )

    expect(result).toMatchObject({ isError: false, details: { status: 'completed', answer: 'done' } })
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/sessions/summaries'))).toHaveLength(1)
    expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith('/state'))).toHaveLength(1)
  })

  it.each([
    { seat: 'boring-orchestrator', toolName: 'dispatch_worker', targetAgentTypeId: 'boring-worker', parentSessionId: 'orch' },
    { seat: 'boring-worker', toolName: 'fresh_review', targetAgentTypeId: 'boring-reviewer', parentSessionId: 'worker' },
  ])('marks every delegated $toolName Agent Host request unattended so personal OAuth remains ineligible', async ({ seat, toolName, targetAgentTypeId, parentSessionId }) => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const { app, calls } = fakeApp([], [`${targetAgentTypeId}-child`], { summaryStatusCode: 503 })
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, timeoutMs: 1_000 })
    handle.bind(app as never)

    const result = await toolNamed(handle, seat, toolName).execute(
      { beadId: 'br-1', brief: `Exercise ${toolName} for Bead br-1 at abcdef1.` }, context(parentSessionId),
    )

    expect(result).toMatchObject({ isError: false, details: { status: 'completed', answer: 'done' } })
    const delegatedCalls = calls.filter((call) => call.url.startsWith(`/api/v1/agents/${targetAgentTypeId}/sessions`))
    expect(delegatedCalls.filter((call) => call.method === 'POST' && call.url === `/api/v1/agents/${targetAgentTypeId}/sessions`)).toHaveLength(1)
    expect(delegatedCalls.filter((call) => call.method === 'POST' && call.url.endsWith('/prompt'))).toHaveLength(1)
    expect(delegatedCalls.filter((call) => call.method === 'POST' && call.url.endsWith('/sessions/summaries'))).toHaveLength(1)
    // The unavailable summary forces one fallback state read plus the authoritative final read.
    expect(delegatedCalls.filter((call) => call.method === 'GET' && call.url.endsWith('/state'))).toHaveLength(2)
    expect(delegatedCalls.every((call) => call.headers?.['x-boring-workspace-id'] === 'factory-hub')).toBe(true)
    expect(delegatedCalls.every((call) => call.headers?.['x-boring-invocation-mode'] === 'unattended')).toBe(true)
  })

  it('requires authoritative final state before reporting summary completion', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const { app } = fakeApp([], ['child-1'], { finalStateStatus: 'running' })
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, timeoutMs: 1_000 })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Implement the exact target Bead br-1 now.' }, context('orch'),
    )

    expect(result).toMatchObject({ isError: false, details: { status: 'timeout' } })
  })

  it('classifies missing, busy, idle-under-grace, and idle-over-grace claims', async () => {
    const stateRoot = await makeStateRoot()
    const now = 2_000_000
    const { registry, sessionBindings } = dependencies({ busy: 'limits-epic', under: 'limits-epic', over: 'limits-epic' })
    const { runBr } = fakeBr([
      { id: 'br-missing', status: 'in_progress', assignee: 'gone' },
      { id: 'br-busy', status: 'in_progress', assignee: 'busy' },
      { id: 'br-under', status: 'in_progress', assignee: 'under' },
      { id: 'br-over', status: 'in_progress', assignee: 'over' },
    ])
    const { app, calls: agentCalls } = fakeApp([
      { sessionId: 'busy', status: 'running', updatedAt: now - 20 * 60_000 },
      { sessionId: 'under', status: 'idle', updatedAt: now - 9 * 60_000 },
      { sessionId: 'over', status: 'idle', updatedAt: now - 11 * 60_000 },
    ])
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, readGitStatus: gitStatus, now: () => now })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'factory_status').execute({}, context('orch'))
    expect(result.isError).toBe(false)
    const beads = (result.details as { beads: Array<Record<string, unknown>> }).beads
    expect(beads).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'br-missing', sessionLiveness: 'missing', stale: true, recoveryCommand: 'recover_stale_claims' }),
      expect.objectContaining({ id: 'br-busy', sessionLiveness: 'busy', stale: false }),
      expect.objectContaining({ id: 'br-under', sessionLiveness: 'idle', idleForMs: 9 * 60_000, stale: false }),
      expect.objectContaining({ id: 'br-over', sessionLiveness: 'idle', idleForMs: 11 * 60_000, stale: true, recoveryCommand: 'recover_stale_claims' }),
    ]))
    expect(result.details).toMatchObject({ staleClaims: { count: 2, beadIds: ['br-missing', 'br-over'], recoveryCommand: 'recover_stale_claims' } })
    expect(agentCalls.every((call) => call.headers?.['x-boring-invocation-mode'] === 'unattended')).toBe(true)
  })

  it('resolves an assignee session independently of a missing epic binding', async () => {
    const stateRoot = await makeStateRoot()
    const now = 2_000_000
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr([{ id: 'br-1', status: 'in_progress', assignee: 'unbound-worker' }])
    const { app } = fakeApp([{ sessionId: 'unbound-worker', status: 'running', updatedAt: now - 20 * 60_000 }])
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, readGitStatus: gitStatus, now: () => now })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'factory_status').execute({}, context('orch'))
    expect(result.details).toMatchObject({
      beads: [expect.objectContaining({ id: 'br-1', sessionLiveness: 'busy', stale: false })],
      counters: { busyWorkers: 1 },
    })
  })

  it('paginates Worker session history beyond five pages', async () => {
    const stateRoot = await makeStateRoot()
    const now = 2_000_000
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr([{ id: 'br-1', status: 'in_progress', assignee: 'late-worker' }])
    const emptyPages = Array.from({ length: 5 }, () => [] as readonly WorkerSummary[])
    const finalPage = [{ sessionId: 'late-worker', status: 'running', updatedAt: now }]
    const { app } = fakeApp([], ['unused'], {
      workerSessionSnapshots: [...emptyPages, finalPage],
      workerSessionPageCount: 6,
    })
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, readGitStatus: gitStatus, now: () => now })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'factory_status').execute({}, context('orch'))
    expect(result).toMatchObject({ isError: false, details: {
      beads: [expect.objectContaining({ id: 'br-1', sessionLiveness: 'busy', stale: false })],
      counters: { busyWorkers: 1 },
    } })
  })

  it('recognizes only a canonical handoff for the same Bead', async () => {
    const stateRoot = await makeStateRoot()
    const now = 2_000_000
    const { registry, sessionBindings } = dependencies({ valid: 'limits-epic', prose: 'limits-epic' })
    const { runBr } = fakeBr([
      { id: 'br-valid', status: 'in_progress', assignee: 'valid' },
      { id: 'br-prose', status: 'in_progress', assignee: 'prose' },
    ], {
      'br-valid': [{ body: '[Limits Epic] handoff · br-valid · abcdef1' }],
      'br-prose': [{ body: 'Worker exited without a handoff; recovery is required.' }],
    })
    const { app } = fakeApp([
      { sessionId: 'valid', status: 'idle', updatedAt: now - 11 * 60_000 },
      { sessionId: 'prose', status: 'idle', updatedAt: now - 11 * 60_000 },
    ])
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, readGitStatus: gitStatus, now: () => now })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'factory_status').execute({}, context('orch'))
    expect(result.details).toMatchObject({ beads: [
      expect.objectContaining({ id: 'br-valid', hasHandoff: true, stale: false }),
      expect.objectContaining({ id: 'br-prose', hasHandoff: false, stale: true }),
    ] })
  })

  it('recover_stale_claims releases only stale claims and never busy or under-grace claims', async () => {
    const stateRoot = await makeStateRoot()
    const now = 2_000_000
    const { registry, sessionBindings } = dependencies({ busy: 'limits-epic', under: 'limits-epic', over: 'limits-epic' })
    const { runBr, calls } = fakeBr([
      { id: 'br-missing', status: 'in_progress', assignee: 'gone' },
      { id: 'br-busy', status: 'in_progress', assignee: 'busy' },
      { id: 'br-under', status: 'in_progress', assignee: 'under' },
      { id: 'br-over', status: 'in_progress', assignee: 'over' },
    ])
    const { app, calls: agentCalls } = fakeApp([
      { sessionId: 'busy', status: 'running', updatedAt: now - 20 * 60_000 },
      { sessionId: 'under', status: 'idle', updatedAt: now - 9 * 60_000 },
      { sessionId: 'over', status: 'idle', updatedAt: now - 11 * 60_000 },
    ])
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, now: () => now })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'recover_stale_claims').execute({}, context('orch'))
    expect(result.details).toMatchObject({ recovered: [
      { beadId: 'br-missing', deadSessionId: 'gone' },
      { beadId: 'br-over', deadSessionId: 'over' },
    ] })
    const updates = calls.filter((args) => args[0] === 'update')
    expect(updates.map((args) => args[1])).toEqual(['br-missing', 'br-over'])
    expect(updates.every((args) => args.includes('--assignee') && args.includes('') && args.includes('open'))).toBe(true)
    expect(agentCalls.every((call) => call.headers?.['x-boring-invocation-mode'] === 'unattended')).toBe(true)
  })

  it('revalidates a stale claim and skips it when its Worker becomes busy', async () => {
    const stateRoot = await makeStateRoot()
    const now = 2_000_000
    const { registry, sessionBindings } = dependencies({ changing: 'limits-epic' })
    const { runBr, calls } = fakeBr([{ id: 'br-changing', status: 'in_progress', assignee: 'changing' }])
    const idle = [{ sessionId: 'changing', status: 'idle', updatedAt: now - 11 * 60_000 }]
    const busy = [{ sessionId: 'changing', status: 'streaming', updatedAt: now }]
    const { app } = fakeApp([], ['unused'], { workerSessionSnapshots: [idle, busy] })
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, now: () => now })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'recover_stale_claims').execute({}, context('orch'))
    expect(result.details).toMatchObject({ recovered: [], skipped: [
      { beadId: 'br-changing', reason: expect.stringContaining('busy') },
    ] })
    expect(calls.some((args) => args[0] === 'update')).toBe(false)
  })

  it('holds session admission from stale classification through claim release', async () => {
    const stateRoot = await makeStateRoot()
    const now = 2_000_000
    const { registry, sessionBindings } = dependencies({ changing: 'limits-epic' })
    const baseBr = fakeBr([
      { id: 'br-changing', status: 'in_progress', assignee: 'changing' },
      { id: 'br-next', status: 'open' },
    ])
    const events: string[] = []
    let changingCommentReads = 0
    let dispatchPromise: Promise<unknown> | undefined
    let dispatchTool: ReturnType<typeof toolNamed> | undefined
    const runBr = vi.fn(async (args: readonly string[], cwd: string) => {
      if (args[0] === 'comments' && args[1] === 'list' && args[2] === 'br-changing') {
        changingCommentReads += 1
        if (changingCommentReads === 2) {
          events.push('final-classification')
          dispatchPromise = dispatchTool!.execute(
            { beadId: 'br-next', brief: 'Dispatch br-next while stale recovery is releasing.' },
            context('orch', 'concurrent-dispatch'),
          )
          await Promise.resolve()
        }
      }
      if (args[0] === 'update' && args[1] === 'br-changing') events.push('release')
      return await baseBr.runBr(args)
    })
    const fake = fakeApp([{ sessionId: 'changing', status: 'idle', updatedAt: now - 11 * 60_000 }])
    const originalInject = fake.app.inject.bind(fake.app)
    fake.app.inject = async (request) => {
      if (request.method === 'POST' && request.url.endsWith('/sessions')) events.push('worker-busy')
      return await originalInject(request)
    }
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, now: () => now })
    handle.bind(fake.app as never)
    dispatchTool = toolNamed(handle, 'boring-orchestrator', 'dispatch_worker')

    const recovered = await toolNamed(handle, 'boring-orchestrator', 'recover_stale_claims').execute({}, context('orch', 'recover'))
    await dispatchPromise

    expect(recovered.details).toMatchObject({ recovered: [expect.objectContaining({ beadId: 'br-changing' })] })
    expect(events).toEqual(expect.arrayContaining(['final-classification', 'release', 'worker-busy']))
    expect(events.indexOf('release')).toBeLessThan(events.indexOf('worker-busy'))
  })

  it('fails closed when comment facts or the complete session inventory cannot be read', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const baseBr = fakeBr([{ id: 'br-1', status: 'in_progress', assignee: 'gone' }])
    const failingComments = vi.fn(async (args: readonly string[], cwd: string) => {
      if (args[0] === 'comments' && args[1] === 'list') throw new Error('comment store unavailable')
      return await baseBr.runBr(args)
    })
    const healthyApp = fakeApp()
    const commentHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr: failingComments,
      readGitStatus: gitStatus,
    })
    commentHost.bind(healthyApp.app as never)
    const recovery = await toolNamed(commentHost, 'boring-orchestrator', 'recover_stale_claims').execute({}, context('orch'))
    expect(recovery).toMatchObject({ isError: true, details: { code: 'STALE_CLAIM_RECOVERY_FAILED' } })
    expect(baseBr.calls.some((args) => args[0] === 'update')).toBe(false)

    const failedInventory = fakeApp([], ['unused'], { workerSessionStatusCode: 503 })
    const dispatchHost = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr: baseBr.runBr })
    dispatchHost.bind(failedInventory.app as never)
    const dispatch = await toolNamed(dispatchHost, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Implement the exact target Bead br-1 now.' }, context('orch'),
    )
    expect(dispatch).toMatchObject({ isError: true, details: { code: 'DELEGATE_FAILED' } })
    expect(failedInventory.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)

    const truncatedInventory = fakeApp([], ['unused'], { repeatWorkerCursor: true })
    const statusHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr: baseBr.runBr,
      readGitStatus: gitStatus,
    })
    statusHost.bind(truncatedInventory.app as never)
    const status = await toolNamed(statusHost, 'boring-orchestrator', 'factory_status').execute({}, context('orch'))
    expect(status).toMatchObject({ isError: true, details: { code: 'FACTORY_STATUS_FAILED' } })
  })

  it('refuses the concurrent-Worker cap before creating a session and blocks/comments the Bead', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies({ w1: 'limits-epic', w2: 'limits-epic' })
    const { runBr, calls: brCalls } = fakeBr()
    const { app, calls } = fakeApp([
      { sessionId: 'w1', status: 'running', updatedAt: 1 },
      { sessionId: 'w2', status: 'running', updatedAt: 1 },
    ])
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Implement the exact target Bead br-1 now.' }, context('orch'),
    )
    expect(result).toMatchObject({ isError: true, details: { code: 'WORKER_CONCURRENCY_CAP_REACHED', beadId: 'br-1', blocked: true } })
    expect((result.details as { message: string }).message).toContain('ask_user')
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
    expect(brCalls.map((args) => args.slice(0, 3))).toEqual(expect.arrayContaining([
      ['update', 'br-1', '--status'], ['comments', 'add', 'br-1'],
    ]))

    const restarted = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr })
    restarted.bind(app as never)
    await toolNamed(restarted, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Retry the exact target Bead br-1 again.' }, context('orch', 'retry'),
    )
    expect(brCalls.filter((args) => args[0] === 'update')).toHaveLength(1)
    expect(brCalls.filter((args) => args[0] === 'comments' && args[1] === 'add')).toHaveLength(1)
  })

  it('refuses the per-Bead dispatch cap before creating a session and blocks/comments the Bead', async () => {
    const stateRoot = await makeStateRoot()
    await writeFile(resolve(stateRoot, 'dispatches.json'), JSON.stringify({
      version: 1,
      dispatches: [1, 2].map((index) => ({ id: `d${index}`, epicKey: 'limits-epic', beadId: 'br-1', childSessionId: `old-${index}`, timestamp: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', outcome: 'completed' })),
      reviews: [],
    }))
    const { registry, sessionBindings } = dependencies()
    const { runBr, calls: brCalls } = fakeBr()
    const { app, calls } = fakeApp()
    const handle = createFactoryDelegatePlugin({ stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr })
    handle.bind(app as never)

    const result = await toolNamed(handle, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Implement the exact target Bead br-1 now.' }, context('orch'),
    )
    expect(result).toMatchObject({ isError: true, details: { code: 'BEAD_DISPATCH_CAP_REACHED', current: 2, maximum: 2, blocked: true } })
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
    expect(brCalls.some((args) => args[0] === 'comments' && String(args[4]).includes('2/2'))).toBe(true)
  })

  it('runs the last allowed review and refuses sequential N+1 before creating a session', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const { app, calls } = fakeApp([], ['review-1', 'review-2', 'review-3'])
    const handle = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '2' }, timeoutMs: 1_000,
    })
    handle.bind(app as never)
    const tool = toolNamed(handle, 'boring-worker', 'fresh_review')

    const first = await tool.execute({ beadId: 'br-1', brief: 'Review Bead br-1 at abcdef1 and report findings.' }, context('worker', 'r1'))
    const second = await tool.execute({ beadId: 'br-1', brief: 'Review Bead br-1 at abcdef2 and report findings.' }, context('worker', 'r2'))
    const refused = await tool.execute({ beadId: 'br-1', brief: 'Review Bead br-1 at abcdef3 and report findings.' }, context('worker', 'r3'))

    expect(first.details).toMatchObject({ reviewRound: 1, capReached: false })
    expect(second.details).toMatchObject({ reviewRound: 2, capReached: true })
    expect((second.details as { capInstructions: string }).capInstructions).toContain('Orchestrator must escalate')
    expect(refused).toMatchObject({
      isError: true,
      details: { code: 'REVIEW_ROUND_CAP_REACHED', reviewTarget: 'bead:br-1', current: 2, maximum: 2, blocked: true },
    })
    expect((refused.details as { message: string }).message).toContain('Do not infer approval')
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toHaveLength(2)
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/prompt'))).toHaveLength(2)
  })

  it('serializes concurrent review admissions at the final slot', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const { app, calls } = fakeApp([], ['review-only'])
    const handle = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    handle.bind(app as never)
    const tool = toolNamed(handle, 'boring-worker', 'fresh_review')

    const results = await Promise.all([
      tool.execute({ beadId: 'br-1', brief: 'Review Bead br-1 at abcdef1 in final slot A.' }, context('worker', 'r1')),
      tool.execute({ beadId: 'br-1', brief: 'Review Bead br-1 at abcdef2 in final slot B.' }, context('worker', 'r2')),
    ])

    expect(results.filter((result) => result.isError)).toHaveLength(1)
    expect(results.filter((result) => !result.isError)[0]?.details).toMatchObject({ reviewRound: 1, capReached: true })
    expect(results.filter((result) => result.isError)[0]?.details).toMatchObject({ code: 'REVIEW_ROUND_CAP_REACHED', current: 1, maximum: 1 })
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toHaveLength(1)
  })

  it('enforces the persisted review cap after host restart', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const firstApp = fakeApp([], ['review-1'])
    const firstHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    firstHost.bind(firstApp.app as never)
    await toolNamed(firstHost, 'boring-worker', 'fresh_review').execute(
      { beadId: 'br-1', brief: 'Review Bead br-1 at abcdef1 before restart.' }, context('worker', 'r1'),
    )

    const restartedApp = fakeApp([], ['review-2'])
    const restartedHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    restartedHost.bind(restartedApp.app as never)
    const refused = await toolNamed(restartedHost, 'boring-worker', 'fresh_review').execute(
      { beadId: 'br-1', brief: 'Review Bead br-1 at abcdef2 after restart.' }, context('worker', 'r2'),
    )

    expect(refused.details).toMatchObject({ code: 'REVIEW_ROUND_CAP_REACHED', current: 1, maximum: 1 })
    expect(restartedApp.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
  })

  it('counts a review reserved before a crash-before-attach and refuses after restart', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const crashingApp = fakeApp([], ['orphan-review'], { crashAfterSessionCreation: true })
    const firstHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    firstHost.bind(crashingApp.app as never)
    const crashed = await toolNamed(firstHost, 'boring-worker', 'fresh_review').execute(
      { beadId: 'br-1', brief: 'Review Bead br-1 at abcdef1 then crash before attach.' }, context('worker', 'r1'),
    )
    expect(crashed).toMatchObject({ isError: true, details: { code: 'DELEGATE_FAILED' } })
    const persisted = JSON.parse(await readFile(resolve(stateRoot, 'dispatches.json'), 'utf8')) as {
      reviews: Array<{ outcome: string; childSessionId?: string; round: number }>
    }
    expect(persisted.reviews).toEqual([expect.objectContaining({ outcome: 'reserved', round: 1 })])
    expect(persisted.reviews[0]!.childSessionId).toBeUndefined()

    const restartedApp = fakeApp([], ['review-2'])
    const restartedHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    restartedHost.bind(restartedApp.app as never)
    const refused = await toolNamed(restartedHost, 'boring-worker', 'fresh_review').execute(
      { beadId: 'br-1', brief: 'Retry review Bead br-1 at abcdef2 after crash.' }, context('worker', 'r2'),
    )
    expect(refused.details).toMatchObject({ code: 'REVIEW_ROUND_CAP_REACHED', current: 1, maximum: 1 })
    expect(restartedApp.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
  })

  it('counts a failed review-session creation against the cap', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const failingApp = fakeApp([], ['failed-review'], { sessionCreationStatusCode: 503 })
    const firstHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    firstHost.bind(failingApp.app as never)
    const failed = await toolNamed(firstHost, 'boring-worker', 'fresh_review').execute(
      { beadId: 'br-1', brief: 'Review Bead br-1 at abcdef1 despite transport failure.' }, context('worker', 'r1'),
    )
    expect(failed).toMatchObject({ isError: true, details: { code: 'CREATE_SESSION_FAILED', status: 503 } })

    const restartedApp = fakeApp([], ['review-2'])
    const restartedHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    restartedHost.bind(restartedApp.app as never)
    const refused = await toolNamed(restartedHost, 'boring-worker', 'fresh_review').execute(
      { beadId: 'br-1', brief: 'Retry failed review Bead br-1 at abcdef2.' }, context('worker', 'r2'),
    )
    expect(refused.details).toMatchObject({ code: 'REVIEW_ROUND_CAP_REACHED', current: 1, maximum: 1 })
    expect(restartedApp.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
  })

  it('serializes SHA-lineage resolution with concurrent review appends that omit beadId', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const { app } = fakeApp([], ['review-a', 'review-b'])
    const handle = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, timeoutMs: 1_000,
    })
    handle.bind(app as never)
    const tool = toolNamed(handle, 'boring-worker', 'fresh_review')

    const results = await Promise.all([
      tool.execute({ brief: 'Review the current target at abcdef1 without a Bead id.' }, context('worker', 'r1')),
      tool.execute({ brief: 'Review the updated target at abcdef2 without a Bead id.' }, context('worker', 'r2')),
    ])

    expect(results.map((result) => (result.details as { reviewRound: number }).reviewRound).sort()).toEqual([1, 2])
    expect(new Set(results.map((result) => (result.details as { reviewTarget: string }).reviewTarget)).size).toBe(1)
  })

  it('preserves an inferred no-Bead SHA lineage across changed SHAs and restart', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const { runBr } = fakeBr()
    const firstApp = fakeApp([], ['review-1'])
    const firstHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    firstHost.bind(firstApp.app as never)
    const first = await toolNamed(firstHost, 'boring-worker', 'fresh_review').execute(
      { brief: 'Review the untracked target at abcdef1 without a Bead id.' }, context('worker', 'r1'),
    )
    expect(first.details).toMatchObject({ reviewRound: 1, reviewTarget: 'sha-lineage:abcdef1', capReached: true })

    const restartedApp = fakeApp([], ['review-2'])
    const restartedHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr,
      env: { BORING_FACTORY_MAX_REVIEW_ROUNDS: '1' }, timeoutMs: 1_000,
    })
    restartedHost.bind(restartedApp.app as never)
    const refused = await toolNamed(restartedHost, 'boring-worker', 'fresh_review').execute(
      { brief: 'Review the changed untracked target at abcdef2 without a Bead id.' }, context('worker', 'r2'),
    )

    expect(refused).toMatchObject({
      isError: true,
      details: { code: 'REVIEW_ROUND_CAP_REACHED', reviewTarget: 'sha-lineage:abcdef1', current: 1, maximum: 1 },
    })
    expect(restartedApp.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
  })

  it('fails closed when a Bead or ledger inference conflicts with an authoritative binding', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies({ foreign: 'other-epic' })
    const { runBr } = fakeBr([{ id: 'br-1', status: 'in_progress', assignee: 'foreign' }])
    const { app, calls } = fakeApp([{ sessionId: 'foreign', status: 'running', updatedAt: 1 }])
    const handle = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr, readGitStatus: gitStatus,
    })
    handle.bind(app as never)

    const status = await toolNamed(handle, 'boring-orchestrator', 'factory_status').execute({}, context('orch', 'status'))
    const dispatch = await toolNamed(handle, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Dispatch target Bead br-1 despite conflicting ownership.' }, context('orch', 'dispatch'),
    )

    expect(status).toMatchObject({ isError: true, details: { code: 'FACTORY_STATUS_FAILED', message: expect.stringContaining('ownership conflict') } })
    expect(dispatch).toMatchObject({ isError: true, details: { code: 'DELEGATE_FAILED', message: expect.stringContaining('ownership conflict') } })
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
  })

  it('persists dispatch counters across host restart and enforces them on the next admission', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const firstBr = fakeBr()
    const firstApp = fakeApp([], ['first-worker'])
    const firstHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr: firstBr.runBr,
      env: { BORING_FACTORY_MAX_DISPATCHES_PER_BEAD: '1' }, timeoutMs: 1_000,
    })
    firstHost.bind(firstApp.app as never)
    await toolNamed(firstHost, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Implement and persist target Bead br-1.' }, context('orch', 'first'),
    )

    const persisted = JSON.parse(await readFile(resolve(stateRoot, 'dispatches.json'), 'utf8')) as { dispatches: unknown[] }
    expect(persisted.dispatches).toHaveLength(1)
    const secondBr = fakeBr()
    const secondApp = fakeApp()
    const restartedHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr: secondBr.runBr,
      readGitStatus: gitStatus, env: { BORING_FACTORY_MAX_DISPATCHES_PER_BEAD: '1' }, timeoutMs: 1_000,
    })
    restartedHost.bind(secondApp.app as never)
    const status = await toolNamed(restartedHost, 'boring-orchestrator', 'factory_status').execute({}, context('orch', 'status'))
    expect(status.details).toMatchObject({ counters: { dispatchesPerOpenBead: { 'br-1': 1 } } })
    const refused = await toolNamed(restartedHost, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Retry target Bead br-1 after host restart.' }, context('orch', 'second'),
    )
    expect(refused.details).toMatchObject({ code: 'BEAD_DISPATCH_CAP_REACHED', current: 1, maximum: 1 })
    expect(secondApp.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
  })

  it('persists a dispatch reservation before child attach and enforces it after a crash restart', async () => {
    const stateRoot = await makeStateRoot()
    const { registry, sessionBindings } = dependencies()
    const firstBr = fakeBr()
    const firstApp = fakeApp([], ['orphan-worker'], { crashAfterSessionCreation: true })
    const firstHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr: firstBr.runBr,
      env: { BORING_FACTORY_MAX_DISPATCHES_PER_BEAD: '1' }, timeoutMs: 1_000,
    })
    firstHost.bind(firstApp.app as never)

    const crashed = await toolNamed(firstHost, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Crash after creating the child for target Bead br-1.' }, context('orch', 'crash'),
    )
    expect(crashed).toMatchObject({ isError: true, details: { code: 'DELEGATE_FAILED' } })
    expect(firstApp.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(true)
    const persisted = JSON.parse(await readFile(resolve(stateRoot, 'dispatches.json'), 'utf8')) as {
      dispatches: Array<{ outcome: string; childSessionId?: string }>
    }
    expect(persisted.dispatches).toEqual([expect.objectContaining({ outcome: 'reserved' })])
    expect(persisted.dispatches[0]!.childSessionId).toBeUndefined()

    const secondBr = fakeBr()
    const secondApp = fakeApp()
    const restartedHost = createFactoryDelegatePlugin({
      stateRoot, workspaceScopeId: 'factory-hub', registry, sessionBindings, runBr: secondBr.runBr,
      env: { BORING_FACTORY_MAX_DISPATCHES_PER_BEAD: '1' }, timeoutMs: 1_000,
    })
    restartedHost.bind(secondApp.app as never)
    const refused = await toolNamed(restartedHost, 'boring-orchestrator', 'dispatch_worker').execute(
      { beadId: 'br-1', brief: 'Retry target Bead br-1 after the attach crash.' }, context('orch', 'restart'),
    )
    expect(refused.details).toMatchObject({ code: 'BEAD_DISPATCH_CAP_REACHED', current: 1, maximum: 1 })
    expect(secondApp.calls.some((call) => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(false)
  })
})
