import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryCredentialStore, type CredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import type { RunContext } from '../../../../shared/harness.js'
import { CREDENTIAL_ERROR_CODES } from '../../../../shared/credentials/errors.js'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  WorkspaceCredentialOperationAuthorityV1,
} from '../../../../shared/credentials/authority.js'
import { createFakeAuthorityVerifierV1 } from '../../../credentials/hostResolver.js'
import { createOperationContextCoordinator } from '../operationContextCoordinator.js'
import { createOperationScopedCredentialStore } from '../operationScopedCredentialStore.js'

type ProviderConfig = Parameters<ModelRuntime['registerProvider']>[1]
type ProviderStream = ReturnType<NonNullable<ProviderConfig['streamSimple']>>
type Coordinator = ReturnType<typeof createOperationContextCoordinator>

type RetryFixture = {
  coordinator: Coordinator
  credentials: CredentialStore
  session: AgentSession
  providerActors: string[]
  resolvedActors: string[]
  firstStarted: Promise<void>
  releaseFirst(): void
  getProviderCalls(): number
  close(): Promise<void>
}

function assistantMessage(call: number, stopReason: 'stop' | 'error') {
  return {
    id: `assistant-${call}`,
    role: 'assistant' as const,
    content: stopReason === 'stop' ? [{ type: 'text' as const, text: `response-${call}` }] : [],
    api: 'openai-completions' as const,
    provider: 'openai-codex',
    model: 'actor-retry-probe',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(stopReason === 'error' ? { errorMessage: 'rate limit exceeded' } : {}),
    timestamp: Date.now(),
  }
}

function providerStream(
  message: ReturnType<typeof assistantMessage>,
  wait?: Promise<void>,
): ProviderStream {
  return {
    async *[Symbol.asyncIterator]() {
      await wait
      yield { type: 'start', partial: { ...message, content: [] } }
      if (message.stopReason === 'stop') {
        yield {
          type: 'text_delta',
          contentIndex: 0,
          delta: message.content[0]?.text ?? '',
          partial: message,
        }
      }
      yield { type: 'done', reason: message.stopReason, message }
    },
    async result() { return message },
  } as unknown as ProviderStream
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function authority(userId: string): WorkspaceCredentialOperationAuthorityV1 {
  const scope = Object.freeze({
    contractVersion: 'boring.authorized-workspace-credential-scope.v1',
  }) as unknown as AuthorizedWorkspaceCredentialScopeV1
  return Object.freeze({
    contractVersion: 'boring.workspace-credential-operation-authority.v1',
    scope,
    verifier: createFakeAuthorityVerifierV1([{
      scope,
      authority: {
        workspaceId: 'workspace-a',
        appId: 'test-app',
        principal: { kind: 'user', userId, membershipRole: 'editor' },
        authorizationReceiptId: `receipt-${userId}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    }]),
  })
}

function runContext(userId: string): RunContext {
  return {
    abortSignal: new AbortController().signal,
    workdir: '/tmp',
    workspaceId: 'workspace-a',
    userId,
    executionClass: 'request-attached-interactive',
    credentialAuthority: authority(userId),
  }
}

async function createRetryFixture(opts: {
  errorCalls: ReadonlySet<number>
  retryDelayMs: number
  maxRetries: number
}): Promise<RetryFixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-queued-retry-'))
  const coordinator = createOperationContextCoordinator()
  const resolvedActors: string[] = []
  const providerActors: string[] = []
  const credentials = createOperationScopedCredentialStore({
    sessionCtx: { workspaceId: 'workspace-a' },
    getOperationLease: coordinator.getActiveLease,
    compatibilityStore: new InMemoryCredentialStore(),
    resolveActorStore: (actor): CredentialStore => ({
      async read() {
        resolvedActors.push(actor.userId)
        return {
          type: 'oauth',
          access: actor.userId,
          refresh: `refresh-${actor.userId}`,
          expires: Date.now() + 3_600_000,
          accountId: `account-${actor.userId}`,
        }
      },
      async list() { return [{ providerId: 'openai-codex', type: 'oauth' }] },
      async modify(_providerId, modify) { return modify(undefined) },
      async delete() {},
    }),
  })
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
  })
  const firstStarted = deferred()
  const releaseFirst = deferred()
  let providerCalls = 0
  modelRuntime.registerProvider('openai-codex', {
    name: 'Actor retry probe',
    api: 'openai-completions',
    baseUrl: 'https://example.invalid',
    models: [{
      id: 'actor-retry-probe',
      name: 'Actor retry probe',
      api: 'openai-completions',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8_000,
      maxTokens: 16,
    }],
    streamSimple(_model, _context, options) {
      providerCalls += 1
      providerActors.push(options?.apiKey ?? 'missing')
      if (providerCalls === 1) firstStarted.resolve()
      return providerStream(
        assistantMessage(providerCalls, opts.errorCalls.has(providerCalls) ? 'error' : 'stop'),
        providerCalls === 1 ? releaseFirst.promise : undefined,
      )
    },
  })
  await modelRuntime.refresh({ allowNetwork: false })
  const model = modelRuntime.getModel('openai-codex', 'actor-retry-probe')
  if (!model) throw new Error('retry probe model unavailable')
  const { session } = await createAgentSession({
    cwd,
    model,
    modelRuntime,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      followUpMode: 'one-at-a-time',
      retry: {
        enabled: true,
        maxRetries: opts.maxRetries,
        baseDelayMs: opts.retryDelayMs,
      },
    }),
    noTools: 'all',
  })
  coordinator.bindQueuedFollowUps(session, true)
  return {
    coordinator,
    credentials,
    session,
    providerActors,
    resolvedActors,
    firstStarted: firstStarted.promise,
    releaseFirst: releaseFirst.resolve,
    getProviderCalls: () => providerCalls,
    async close() {
      coordinator.dispose()
      session.dispose()
      await rm(cwd, { recursive: true, force: true })
    },
  }
}

async function runAWithQueuedB(fixture: RetryFixture): Promise<void> {
  await fixture.coordinator.run(runContext('A'), async () => {
    const running = fixture.session.prompt('turn A')
    await fixture.firstStarted
    await fixture.coordinator.run(runContext('B'), () => fixture.session.followUp('turn B'))
    fixture.releaseFirst()
    await running
  })
}

function detachedCredentialRead(fixture: RetryFixture, gate: Promise<void>): Promise<unknown> {
  return (async () => {
    await gate
    try {
      return await fixture.credentials.read('openai-codex')
    } catch (error) {
      return error
    }
  })()
}

function expectResolvedActorsStayInTurnOrder(actors: readonly string[]): void {
  const firstB = actors.indexOf('B')
  expect(firstB).toBeGreaterThan(0)
  expect(actors.slice(0, firstB).every((actor) => actor === 'A')).toBe(true)
  expect(actors.slice(firstB).every((actor) => actor === 'B')).toBe(true)
}

describe('pinned Pi queued actor retry lifecycle', () => {
  it('retains the queued actor through a transient failure and successful automatic retry', async () => {
    const fixture = await createRetryFixture({
      errorCalls: new Set([2]),
      retryDelayMs: 1,
      maxRetries: 1,
    })
    const detachedGate = deferred()
    let detachedRead: Promise<unknown> | undefined
    const observedEvents: string[] = []
    const unsubscribe = fixture.session.subscribe((event) => {
      observedEvents.push(`${event.type}${event.type === 'agent_end' ? `:${event.willRetry}` : ''}:${fixture.coordinator.getActiveContext()?.userId ?? 'missing'}`)
      if (event.type === 'auto_retry_start') {
        detachedRead = detachedCredentialRead(fixture, detachedGate.promise)
      }
    })
    try {
      await runAWithQueuedB(fixture)
      expect(fixture.getProviderCalls(), observedEvents.join(',')).toBe(3)
      expect(fixture.providerActors).toEqual(['A', 'B', 'B'])
      expectResolvedActorsStayInTurnOrder(fixture.resolvedActors)

      detachedGate.resolve()
      await expect(detachedRead).resolves.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
      })
    } finally {
      unsubscribe()
      await fixture.close()
    }
  }, 30_000)

  it('revokes the queued actor when retry backoff is aborted', async () => {
    const fixture = await createRetryFixture({
      errorCalls: new Set([2]),
      retryDelayMs: 10_000,
      maxRetries: 1,
    })
    const retryStarted = deferred()
    const detachedGate = deferred()
    let detachedRead: Promise<unknown> | undefined
    const unsubscribe = fixture.session.subscribe((event) => {
      if (event.type === 'auto_retry_start') {
        detachedRead = detachedCredentialRead(fixture, detachedGate.promise)
        retryStarted.resolve()
      }
    })
    try {
      const running = runAWithQueuedB(fixture)
      await retryStarted.promise
      await fixture.session.abort()
      await running

      expect(fixture.getProviderCalls()).toBe(2)
      expect(fixture.providerActors).toEqual(['A', 'B'])
      detachedGate.resolve()
      await expect(detachedRead).resolves.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
      })
    } finally {
      unsubscribe()
      await fixture.close()
    }
  }, 30_000)

  it('revokes the queued actor after terminal retry exhaustion', async () => {
    const fixture = await createRetryFixture({
      errorCalls: new Set([2, 3]),
      retryDelayMs: 1,
      maxRetries: 1,
    })
    const detachedGate = deferred()
    let detachedRead: Promise<unknown> | undefined
    const observedEvents: string[] = []
    const unsubscribe = fixture.session.subscribe((event) => {
      observedEvents.push(event.type === 'agent_end' ? `${event.type}:${event.willRetry}` : event.type)
      if (event.type === 'auto_retry_start') {
        detachedRead = detachedCredentialRead(fixture, detachedGate.promise)
      }
    })
    try {
      await runAWithQueuedB(fixture)
      expect(fixture.getProviderCalls(), observedEvents.join(',')).toBe(3)
      expect(fixture.providerActors).toEqual(['A', 'B', 'B'])
      expectResolvedActorsStayInTurnOrder(fixture.resolvedActors)
      expect(fixture.coordinator.getActiveLease()).toBeUndefined()

      detachedGate.resolve()
      await expect(detachedRead).resolves.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
      })
    } finally {
      unsubscribe()
      await fixture.close()
    }
  }, 30_000)
})
