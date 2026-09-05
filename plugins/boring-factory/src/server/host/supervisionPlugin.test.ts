import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFactorySupervisionPlugin, SUPERVISION_MIN_INTERVAL_MS, SUPERVISION_MAX_INTERVAL_MS } from './supervisionPlugin'
import type { FactoryEpicEntry, FactoryEpicRegistry } from './epicRegistry'
import type { FactorySessionBindings } from './sessionBindings'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

async function makeStateRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'factory-supervision-'))
  temporaryRoots.push(root)
  return root
}

async function writeSupervisionFile(stateRoot: string, entries: Record<string, unknown>): Promise<void> {
  await mkdir(stateRoot, { recursive: true })
  await writeFile(resolve(stateRoot, 'supervision.json'), JSON.stringify({ entries }, null, 2), 'utf8')
}

function epicDeps(orchestratorSessionId = 'session-orch-1'): { registry: FactoryEpicRegistry; sessionBindings: FactorySessionBindings } {
  const entry: FactoryEpicEntry = {
    epicKey: 'live-farewell',
    featureName: 'Live Farewell',
    worktree: '/tmp/factory-live-farewell',
    branch: 'epic/live-farewell',
    repositoryRoot: '/tmp/repository',
    orchestratorSessionId,
    createdAt: '2026-09-05T00:00:00.000Z',
    status: 'active',
  }
  const bindings: Record<string, string> = {
    s1: entry.epicKey,
    'session-orch-1': entry.epicKey,
    'session-restart': entry.epicKey,
    'session-busy': entry.epicKey,
    'session-close': entry.epicKey,
  }
  return {
    registry: {
      load: async () => [entry],
      list: async () => [entry],
      get: async (key) => key === entry.epicKey ? entry : undefined,
      register: async () => entry,
      setOrchestratorSession: async () => entry,
      markClosed: async () => ({ ...entry, status: 'closed' }),
    },
    sessionBindings: {
      load: async () => ({ ...bindings }),
      get: async (sessionId) => bindings[sessionId],
      bind: async (sessionId, key) => { bindings[sessionId] = key },
      unbind: async (sessionId) => { delete bindings[sessionId] },
      inherit: async (parentSessionId, childSessionId) => {
        const key = bindings[parentSessionId]!
        bindings[childSessionId] = key
        return key
      },
      reconcile: async () => ({ droppedSessionIds: [], restoredOrchestratorSessionIds: [] }),
    },
  }
}

interface FakeInjectCall {
  readonly method: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly payload?: unknown
}

/** Minimal fastify-shaped fake: `inject` is scripted, `addHook` just records the onClose callback. */
function createFakeApp(options: { status: string }) {
  const calls: FakeInjectCall[] = []
  const prompts: string[] = []
  let onCloseHook: (() => Promise<void> | void) | undefined

  const app = {
    addHook(name: string, handler: () => Promise<void> | void) {
      if (name === 'onClose') onCloseHook = handler
    },
    async inject(request: FakeInjectCall) {
      calls.push(request)
      if (request.method === 'GET' && request.url.includes('/state')) {
        return { statusCode: 200, json: <T>() => ({ state: { status: options.status } }) as T }
      }
      if (request.method === 'POST' && request.url.includes('/prompt')) {
        const payload = request.payload as { content: string }
        prompts.push(payload.content)
        return { statusCode: 202, json: <T>() => ({}) as T }
      }
      return { statusCode: 404, json: <T>() => ({}) as T }
    },
  }

  return { app, calls, prompts, triggerClose: async () => { await onCloseHook?.() } }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  if (!(await predicate())) throw new Error('waitFor: predicate never became true')
}

describe('factory supervision plugin', () => {
  it('grants `supervise` only to boring-orchestrator', () => {
    const { plugin } = createFactorySupervisionPlugin({ stateRoot: '/tmp/does-not-matter', workspaceScopeId: 'factory-hub', ...epicDeps() })
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }).map((tool) => tool.name)).toEqual(['supervise'])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-worker' })).toEqual([])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-reviewer' })).toEqual([])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'ordinary-agent' })).toEqual([])
  })

  it('start persists an entry to supervision.json, status reads it back, and stop removes it', async () => {
    const stateRoot = await makeStateRoot()
    const { app } = createFakeApp({ status: 'idle' })
    const handle = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId: 'factory-hub', ...epicDeps() })
    handle.bind(app as never)
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    expect(tool).toBeDefined()

    const startResult = await tool!.execute(
      { op: 'start', intervalMs: 45_000, prompt: 'custom nudge text' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-1', sessionId: 'session-orch-1' },
    )
    expect(startResult.isError).toBeFalsy()
    const started = JSON.parse(startResult.content[0]!.text) as { sessionId: string; intervalMs: number; prompt: string; ticks: number }
    expect(started).toMatchObject({ sessionId: 'session-orch-1', intervalMs: 45_000, prompt: 'custom nudge text', ticks: 0 })

    const onDisk = JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8')) as { entries: Record<string, unknown> }
    expect(onDisk.entries['session-orch-1']).toMatchObject({ agentTypeId: 'boring-orchestrator', intervalMs: 45_000 })

    const statusResult = await tool!.execute(
      { op: 'status' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-2', sessionId: 'session-orch-1' },
    )
    expect(JSON.parse(statusResult.content[0]!.text)).toMatchObject({ sessionId: 'session-orch-1', intervalMs: 45_000 })

    const stopResult = await tool!.execute(
      { op: 'stop' },
      { abortSignal: new AbortController().signal, toolCallId: 'call-3', sessionId: 'session-orch-1' },
    )
    expect(JSON.parse(stopResult.content[0]!.text)).toBeNull()
    const afterStop = JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8')) as { entries: Record<string, unknown> }
    expect(afterStop.entries['session-orch-1']).toBeUndefined()

    handle.close()
  })

  it('rejects an unknown op and an out-of-range intervalMs before touching the state file', async () => {
    const stateRoot = await makeStateRoot()
    const { plugin } = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId: 'factory-hub', ...epicDeps() })
    const [tool] = plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const badOp = await tool!.execute({ op: 'pause' }, { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 's1' })
    expect(badOp.isError).toBe(true)
    expect(badOp.details).toMatchObject({ code: 'INVALID_INPUT' })

    const tooSmall = await tool!.execute(
      { op: 'start', intervalMs: SUPERVISION_MIN_INTERVAL_MS - 1 },
      { abortSignal: new AbortController().signal, toolCallId: 'c2', sessionId: 's1' },
    )
    expect(tooSmall.isError).toBe(true)

    const tooLarge = await tool!.execute(
      { op: 'start', intervalMs: SUPERVISION_MAX_INTERVAL_MS + 1 },
      { abortSignal: new AbortController().signal, toolCallId: 'c3', sessionId: 's1' },
    )
    expect(tooLarge.isError).toBe(true)
  })

  it('rearm() re-arms every persisted entry from a pre-written file (short interval) and a tick is sent while idle', async () => {
    const stateRoot = await makeStateRoot()
    await writeSupervisionFile(stateRoot, {
      'session-restart': {
        epicKey: 'live-farewell',
        agentTypeId: 'boring-orchestrator',
        sessionId: 'session-restart',
        intervalMs: 50,
        prompt: 'restart nudge',
        startedAt: new Date().toISOString(),
        ticks: 0,
      },
    })

    const { app, prompts } = createFakeApp({ status: 'idle' })
    const handle = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId: 'factory-hub', ...epicDeps('session-restart') })
    handle.bind(app as never)
    const armedCount = await handle.rearm()
    expect(armedCount).toBe(1)

    await waitFor(() => prompts.length > 0)
    expect(prompts[0]).toContain('Supervision tick 1')
    expect(prompts[0]).toContain('restart nudge')

    handle.close()
  })

  it('rearm() prunes entries that are not the bound registry Orchestrator', async () => {
    const stateRoot = await makeStateRoot()
    const entry = (sessionId: string, epicKey = 'live-farewell', agentTypeId = 'boring-orchestrator') => ({
      epicKey,
      agentTypeId,
      sessionId,
      intervalMs: 50,
      prompt: `${sessionId} nudge`,
      startedAt: '2026-09-05T00:00:00.000Z',
      ticks: 0,
    })
    await writeSupervisionFile(stateRoot, {
      'session-restart': entry('session-restart'),
      'adopted-away': entry('adopted-away'),
      'missing-epic': entry('missing-epic', 'missing'),
      'wrong-agent': entry('wrong-agent', 'live-farewell', 'boring-worker'),
    })

    const { app, prompts } = createFakeApp({ status: 'idle' })
    const handle = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId: 'factory-hub', ...epicDeps('session-restart') })
    handle.bind(app as never)
    expect(await handle.rearm()).toBe(1)
    expect(Object.keys(JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8')).entries)).toEqual(['session-restart'])
    await waitFor(() => prompts.length > 0)
    expect(prompts).toEqual([expect.stringContaining('session-restart nudge')])
    handle.close()
  })

  it('transfers an epic supervision entry to the adopted session idempotently', async () => {
    const stateRoot = await makeStateRoot()
    await writeSupervisionFile(stateRoot, {
      old: {
        epicKey: 'live-farewell', agentTypeId: 'boring-orchestrator', sessionId: 'old', intervalMs: 45_000,
        prompt: 'preserved nudge', startedAt: '2026-09-05T00:00:00.000Z', lastTickAt: '2026-09-05T00:01:00.000Z',
        lastTickOutcome: 'sent', ticks: 4,
      },
    })
    const handle = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId: 'factory-hub', ...epicDeps('adopted') })
    await handle.transferSupervision('live-farewell', 'old', 'adopted')
    await handle.transferSupervision('live-farewell', 'adopted', 'adopted')
    const state = JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8')) as { entries: Record<string, unknown> }
    expect(state.entries).toEqual({ adopted: expect.objectContaining({
      epicKey: 'live-farewell', sessionId: 'adopted', intervalMs: 45_000, prompt: 'preserved nudge', ticks: 4,
      lastTickOutcome: 'sent',
    }) })
    handle.close()
  })

  it('skips a tick as "skipped-busy" and never sends a prompt while the session is not idle', async () => {
    const stateRoot = await makeStateRoot()
    await writeSupervisionFile(stateRoot, {
      'session-busy': {
        epicKey: 'live-farewell',
        agentTypeId: 'boring-orchestrator',
        sessionId: 'session-busy',
        intervalMs: 50,
        prompt: 'busy nudge',
        startedAt: new Date().toISOString(),
        ticks: 0,
      },
    })

    const { app, prompts, calls } = createFakeApp({ status: 'streaming' })
    const handle = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId: 'factory-hub', ...epicDeps('session-busy') })
    handle.bind(app as never)
    await handle.rearm()

    await waitFor(() => calls.some((call) => call.url.includes('/state')))
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
    expect(prompts).toEqual([])

    await waitFor(async () => {
      const state = JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8')) as {
        entries: Record<string, { lastTickOutcome?: string }>
      }
      return state.entries['session-busy']?.lastTickOutcome === 'skipped-busy'
    })
    const state = JSON.parse(await readFile(resolve(stateRoot, 'supervision.json'), 'utf8')) as {
      entries: Record<string, { lastTickOutcome?: string; ticks: number }>
    }
    expect(state.entries['session-busy']?.lastTickOutcome).toBe('skipped-busy')
    expect(state.entries['session-busy']?.ticks).toBe(0)

    handle.close()
  })

  it('bind() registers an onClose hook that clears armed timers', async () => {
    const stateRoot = await makeStateRoot()
    await writeSupervisionFile(stateRoot, {
      'session-close': {
        epicKey: 'live-farewell',
        agentTypeId: 'boring-orchestrator',
        sessionId: 'session-close',
        intervalMs: 50,
        prompt: 'close nudge',
        startedAt: new Date().toISOString(),
        ticks: 0,
      },
    })
    const { app, prompts, triggerClose } = createFakeApp({ status: 'idle' })
    const handle = createFactorySupervisionPlugin({ stateRoot, workspaceScopeId: 'factory-hub', ...epicDeps('session-close') })
    handle.bind(app as never)
    await handle.rearm()

    await triggerClose()
    prompts.length = 0
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
    expect(prompts).toEqual([])
  })
})
