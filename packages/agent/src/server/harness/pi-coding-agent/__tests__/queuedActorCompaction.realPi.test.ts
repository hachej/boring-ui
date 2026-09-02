import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryCredentialStore, type CredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
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

function assistantMessage(id: string, text: string) {
  return {
    id,
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'openai-completions' as const,
    provider: 'openai-codex',
    model: 'actor-probe',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  }
}

function providerStream(message: ReturnType<typeof assistantMessage>, wait?: Promise<void>): ProviderStream {
  return {
    async *[Symbol.asyncIterator]() {
      await wait
      yield { type: 'start', partial: { ...message, content: [] } }
      yield { type: 'text_delta', contentIndex: 0, delta: message.content[0].text, partial: message }
      yield { type: 'text_end', contentIndex: 0, content: message.content[0].text, partial: message }
      yield { type: 'done', reason: 'stop', message }
    },
    async result() { return message },
  } as unknown as ProviderStream
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

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('pinned Pi queued actor compaction boundary', () => {
  it('isolates a queued continuation from concurrent and detached actors, then revokes it on cleanup', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-queued-compaction-'))
    try {
      const coordinator = createOperationContextCoordinator()
      const resolvedActors: string[] = []
      const providerActors: string[] = []
      const secondBReadStarted = deferred()
      const releaseSecondBRead = deferred()
      let deferNextBRead = false
      let committedAfterCleanup = false

      const credentials = createOperationScopedCredentialStore({
        sessionCtx: { workspaceId: 'workspace-a' },
        getOperationLease: coordinator.getActiveLease,
        compatibilityStore: new InMemoryCredentialStore(),
        resolveActorStore: (actor): CredentialStore => ({
          async read(_providerId, options) {
            resolvedActors.push(actor.userId)
            if (actor.userId === 'B' && deferNextBRead) {
              deferNextBRead = false
              secondBReadStarted.resolve()
              await releaseSecondBRead.promise
              if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
              committedAfterCleanup = true
            }
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
      const bStreamStarted = deferred()
      const releaseBStream = deferred()
      let providerCall = 0
      let pendingBRead: Promise<unknown> | undefined
      modelRuntime.registerProvider('openai-codex', {
        name: 'Actor probe',
        api: 'openai-completions',
        baseUrl: 'https://example.invalid',
        models: [{
          id: 'actor-probe',
          name: 'Actor probe',
          api: 'openai-completions',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 50,
          maxTokens: 16,
        }],
        streamSimple() {
          providerCall += 1
          const actor = coordinator.getActiveContext()?.userId ?? 'missing'
          providerActors.push(actor)
          if (providerCall === 1) firstStarted.resolve()
          if (providerCall === 2) {
            bStreamStarted.resolve()
            // Start another B-auth read on Pi's continuation chain. Cleanup
            // must abort it before any material can return.
            deferNextBRead = true
            pendingBRead = credentials.read('openai-codex').catch((error) => error)
          }
          const text = providerCall === 1
            ? `A ${'large-context '.repeat(200)}`
            : `response-${providerCall}`
          const wait = providerCall === 1
            ? releaseFirst.promise
            : providerCall === 2
              ? releaseBStream.promise
              : undefined
          return providerStream(assistantMessage(`assistant-${providerCall}`, text), wait)
        },
      })
      await modelRuntime.refresh({ allowNetwork: false })
      const model = modelRuntime.getModel('openai-codex', 'actor-probe')
      expect(model).toBeDefined()

      const { session } = await createAgentSession({
        cwd,
        model,
        modelRuntime,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager: SettingsManager.inMemory({
          followUpMode: 'one-at-a-time',
          compaction: { enabled: true, reserveTokens: 49, keepRecentTokens: 1 },
        }),
        noTools: 'all',
      })
      coordinator.bindQueuedFollowUps(session, true)
      const compactionActors: string[] = []
      const unsubscribe = session.subscribe((event) => {
        if (event.type === 'compaction_start') {
          compactionActors.push(coordinator.getActiveContext()?.userId ?? 'missing')
        }
      })

      let detachedLookup: Promise<unknown> | undefined
      const prompt = coordinator.run(runContext('A'), async () => {
        detachedLookup = (async () => {
          await bStreamStarted.promise
          try {
            return await credentials.read('openai-codex')
          } catch (error) {
            return error
          }
        })()
        const running = session.prompt('turn A')
        await firstStarted.promise
        await coordinator.run(runContext('B'), () => session.followUp('turn B'))
        await coordinator.run(runContext('C'), () => session.followUp('turn C'))
        releaseFirst.resolve()
        await running
      })

      await bStreamStarted.promise
      await secondBReadStarted.promise
      const dCredential = await coordinator.run(runContext('D'), () => credentials.read('openai-codex'))
      expect(dCredential).toMatchObject({ access: 'D' })
      await expect(detachedLookup).resolves.toMatchObject({ code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID })

      // Mirror handle disposal: retire every handle operation and queued
      // continuation before Pi removes listeners or disposes the writer.
      coordinator.dispose()
      session.dispose()
      releaseSecondBRead.resolve()
      await expect(pendingBRead).resolves.toMatchObject({ name: 'AbortError' })
      expect(committedAfterCleanup).toBe(false)
      releaseBStream.resolve()
      await prompt

      expect(providerActors.slice(0, 2)).toEqual(['A', 'B'])
      expect(compactionActors).toContain('B')
      expect(resolvedActors).toContain('D')
      expect(resolvedActors).not.toContain('C')
      expect(session.sessionId).toBeDefined()

      unsubscribe()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
