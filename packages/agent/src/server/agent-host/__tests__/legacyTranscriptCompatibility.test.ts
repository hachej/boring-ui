import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentHarnessFactory } from '../../../shared/harness'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import {
  createStandaloneAgentHostApp,
  type CreateStandaloneAgentHostAppOptions,
} from '../../createStandaloneAgentHostApp'
import { getEnv, restoreEnvForTest, setEnvForTest } from '../../config/env'
import { sessionFilePath } from '../../harness/pi-coding-agent/__tests__/fixtures/sessionFiles'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import { createScriptedPiHarness } from '../../testing/scriptedPiHarness'

const roots: string[] = []
const originalSessionRoot = getEnv('BORING_AGENT_SESSION_ROOT')
const originalHome = getEnv('HOME')

afterEach(async () => {
  restoreEnvForTest('BORING_AGENT_SESSION_ROOT', originalSessionRoot)
  restoreEnvForTest('HOME', originalHome)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(prefix: string) {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}

function persistedHarness(store: PiSessionStore): AgentHarnessFactory {
  return (input) => {
    const scripted = createScriptedPiHarness(input)
    return {
      ...scripted,
      sessions: store,
      hasPiSession: () => false,
    }
  }
}

async function proveDirectHostCutover(
  store: PiSessionStore,
  options: Pick<CreateStandaloneAgentHostAppOptions, 'workspaceRoot' | 'sessionDir' | 'sessionRoot' | 'sessionNamespace'>,
) {
  // The direct standalone Host preserves the HTTP shell's
  // app-defined default workspace context; transcript layout is independent.
  const ctx = { workspaceId: 'default' }
  const created = await store.create(ctx, { title: 'pre-AH0 fixture' })
  const path = await sessionFilePath(store.getSessionDir(), created.id)
  await appendFile(path, `${JSON.stringify({
    type: 'message', id: 'legacy-user', parentId: null, timestamp: '2026-07-20T00:00:01.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 },
  })}\n`)
  const before = await readFile(path)

  const app = await createStandaloneAgentHostApp({
    ...options,
    sessionId: 'workspace-a',
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    logger: false,
    externalPlugins: false,
    harnessFactory: persistedHarness(store),
  })
  const listed = await app.inject({ method: 'GET', url: '/api/v1/agents/default/sessions' })
  expect(listed.statusCode).toBe(200)
  expect(listed.json()).toEqual({
    sessions: expect.arrayContaining([expect.objectContaining({
      ref: { agentTypeId: 'default', sessionId: created.id },
      title: 'pre-AH0 fixture',
    })]),
  })
  const state = await app.inject({ method: 'GET', url: `/api/v1/agents/default/sessions/${created.id}/state` })
  expect(state.statusCode).toBe(200)
  expect(state.json()).toMatchObject({
    ref: { agentTypeId: 'default', sessionId: created.id },
    state: { protocolVersion: 1, sessionId: created.id, status: 'idle' },
  })

  try {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('missing test server address')
    const abort = new AbortController()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/agents/default/sessions/${created.id}/events?cursor=0`, {
      signal: abort.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    const firstFrameBytes = (await response.body!.getReader().read()).value
    expect(firstFrameBytes).toBeDefined()
    const firstFrame = new TextDecoder().decode(firstFrameBytes).trim().split('\n')[0]
    expect(JSON.parse(firstFrame)).toMatchObject({ type: 'heartbeat', now: expect.any(String) })
    abort.abort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
  }
  await app.close()

  // Direct Host cutover and rollback are both readers of the original byte path:
  // no move/copy/repair write is permitted.
  expect(await readFile(path)).toEqual(before)
  expect((await store.list(ctx)).map((session) => session.id)).toContain(created.id)
  expect((await store.load(ctx, created.id)).title).toBe('pre-AH0 fixture')
  expect(await readFile(path)).toEqual(before)
}

describe.sequential('legacy transcript compatibility through direct Host cutover', () => {
  it('preserves explicit sessionDir list/read/state/events and rollback bytes', async () => {
    const workspaceRoot = await root('legacy-explicit-workspace-')
    const sessionDir = await root('legacy-explicit-')
    await proveDirectHostCutover(new PiSessionStore(workspaceRoot, sessionDir), { workspaceRoot, sessionDir })
  })

  it('preserves sessionRoot/sessionNamespace list/read/state/events and rollback bytes', async () => {
    const workspaceRoot = await root('legacy-namespace-workspace-')
    const sessionRoot = await root('legacy-namespace-')
    const store = new PiSessionStore(workspaceRoot, { sessionRoot, sessionNamespace: 'workspace-a' })
    expect(store.getSessionDir()).toBe(join(sessionRoot, 'workspace-a'))
    await proveDirectHostCutover(store, { workspaceRoot, sessionRoot, sessionNamespace: 'workspace-a' })
  })

  it('preserves CLI defaultSessionDir with BORING_AGENT_SESSION_ROOT unset', async () => {
    const home = await root('legacy-home-')
    const workspaceRoot = await root('legacy-cli-workspace-')
    setEnvForTest('HOME', home)
    setEnvForTest('BORING_AGENT_SESSION_ROOT', undefined)
    const store = new PiSessionStore(workspaceRoot)
    expect(store.getSessionDir()).toMatch(new RegExp(`^${join(home, '.pi', 'agent', 'sessions').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    await proveDirectHostCutover(store, { workspaceRoot })
  })

  it('preserves CLI defaultSessionDir with BORING_AGENT_SESSION_ROOT set', async () => {
    const workspaceRoot = await root('legacy-cli-env-workspace-')
    const sessionRoot = await root('legacy-env-root-')
    setEnvForTest('BORING_AGENT_SESSION_ROOT', sessionRoot)
    const store = new PiSessionStore(workspaceRoot)
    expect(store.getSessionDir()).toMatch(new RegExp(`^${sessionRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    await proveDirectHostCutover(store, { workspaceRoot })
  })
})
