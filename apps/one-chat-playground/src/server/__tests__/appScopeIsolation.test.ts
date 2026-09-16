import { mkdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { createSandboxRuntimeModeAdapter, type RuntimeModeAdapter } from '@hachej/boring-agent/server'

import { createOneChatRuntime, ONE_CHAT_APP_HEADER, type OneChatRuntime } from '../agentHost'
import { openIntent, whereWeAreLine } from '../memoryFiles'
import { workspaceFixture } from './workspaceFixture'

const runtimes: OneChatRuntime[] = []
const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

async function workspace(parent: string, slug: string): Promise<string> {
  const root = path.join(parent, slug)
  await mkdir(path.join(root, 'agent', 'intents'), { recursive: true })
  await mkdir(path.join(root, 'docs'), { recursive: true })
  return root
}

describe('per-app runtime scope', () => {
  test('shutdown fences a request waiting on provider acquisition', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-scope-shutdown-'))
    const alpha = await workspace(root, 'alpha')
    const base = createSandboxRuntimeModeAdapter('direct')
    disposers.push(async () => { await base.dispose?.() })
    const entered = deferred()
    const blocked = deferred()
    const settled = deferred()
    const adapter: RuntimeModeAdapter = {
      ...base,
      async create(context) {
        entered.resolve()
        await blocked.promise
        try {
          return await base.create(context)
        } finally {
          settled.resolve()
        }
      },
    }
    const runtime = await createOneChatRuntime({
      logger: false,
      sessionRoot: path.join(root, 'sessions'),
      runtimeModeAdapter: adapter,
      resolveApp(slug) {
        return slug === 'alpha' ? { slug, workspaceRoot: alpha, appBaseUrl: 'http://localhost:6101/' } : undefined
      },
      defaultAppSlug: 'alpha',
    })
    const request = runtime.app.inject({
      method: 'POST',
      url: '/api/v1/agents/default/sessions',
      headers: { [ONE_CHAT_APP_HEADER]: 'alpha' },
      payload: {},
    })
    await entered.promise

    await expect(runtime.close()).resolves.toBeUndefined()
    await expect(request).resolves.toMatchObject({ statusCode: 503 })
    blocked.resolve()
    await settled.promise
  }, 10_000)

  test('retries a transient runtime acquisition failure instead of poisoning the app cache', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-scope-retry-'))
    const alpha = await workspace(root, 'alpha')
    const base = createSandboxRuntimeModeAdapter('direct')
    disposers.push(async () => {
      await base.dispose?.()
    })
    let failures = 1
    const adapter: RuntimeModeAdapter = {
      ...base,
      async create(context) {
        if (failures > 0 && context.workspaceId === 'one-chat-playground') {
          failures -= 1
          throw new Error('temporary provider failure')
        }
        return base.create(context)
      },
    }
    const runtime = await createOneChatRuntime({
      logger: false,
      sessionRoot: path.join(root, 'sessions'),
      runtimeModeAdapter: adapter,
      resolveApp(slug) {
        return slug === 'alpha' ? { slug, workspaceRoot: alpha, appBaseUrl: 'http://localhost:6101/' } : undefined
      },
      defaultAppSlug: 'alpha',
    })
    runtimes.push(runtime)

    const create = () =>
      runtime.app.inject({
        method: 'POST',
        url: '/api/v1/agents/default/sessions',
        headers: { [ONE_CHAT_APP_HEADER]: 'alpha' },
        payload: {},
      })
    expect((await create()).statusCode).toBe(503)
    expect((await create()).statusCode).toBe(201)
  })

  test('isolates two session inventories and each app intent directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'one-chat-scopes-'))
    const alpha = await workspace(root, 'alpha')
    const beta = await workspace(root, 'beta')
    const runtime = await createOneChatRuntime({
      logger: false,
      sessionRoot: path.join(root, 'sessions'),
      resolveApp(slug) {
        if (slug === 'alpha')
          return {
            slug,
            workspaceRoot: alpha,
            appBaseUrl: 'http://localhost:6101/',
          }
        if (slug === 'beta')
          return {
            slug,
            workspaceRoot: beta,
            appBaseUrl: 'http://localhost:6102/',
          }
        return undefined
      },
    })
    runtimes.push(runtime)

    const create = (slug: string) =>
      runtime.app.inject({
        method: 'POST',
        url: '/api/v1/agents/default/sessions',
        headers: { [ONE_CHAT_APP_HEADER]: slug },
        payload: {},
      })
    const alphaCreated = await create('alpha')
    const betaCreated = await create('beta')
    expect(alphaCreated.statusCode).toBe(201)
    expect(betaCreated.statusCode).toBe(201)
    const alphaSession = alphaCreated.json<{ sessionId: string }>().sessionId
    const betaSession = betaCreated.json<{ sessionId: string }>().sessionId
    expect(alphaSession).not.toBe(betaSession)

    const stateStatus = async (slug: string, sessionId: string) =>
      (
        await runtime.app.inject({
          method: 'GET',
          url: `/api/v1/agents/default/sessions/${sessionId}/state`,
          headers: { [ONE_CHAT_APP_HEADER]: slug },
        })
      ).statusCode
    expect(await stateStatus('alpha', alphaSession)).toBe(200)
    expect(await stateStatus('alpha', betaSession)).toBe(404)
    expect(await stateStatus('beta', betaSession)).toBe(200)
    expect(await stateStatus('beta', alphaSession)).toBe(404)

    const alphaBundle = await workspaceFixture('one-chat-alpha-memory-', alpha)
    const betaBundle = await workspaceFixture('one-chat-beta-memory-', beta)
    disposers.push(alphaBundle.disposeRuntime ?? (async () => {}), betaBundle.disposeRuntime ?? (async () => {}))
    await openIntent(alphaBundle.workspace, 'alpha-only', 'Only alpha remembers this.')
    expect(await whereWeAreLine(alphaBundle.workspace)).toContain('alpha-only')
    expect(await whereWeAreLine(betaBundle.workspace)).toBeUndefined()

    const alphaStage: unknown[] = []
    const betaStage: unknown[] = []
    runtime.stageForApp('alpha').subscribe((event) => alphaStage.push(event))
    runtime.stageForApp('beta').subscribe((event) => betaStage.push(event))
    runtime.stageForApp('alpha').emit({ type: 'stage.show', what: 'app', url: 'http://localhost:6101/' })
    expect(alphaStage).toHaveLength(1)
    expect(betaStage).toHaveLength(0)
  })
})
