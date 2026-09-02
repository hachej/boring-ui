import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import type { RunContext } from '../../../../shared/harness.js'
import {
  bindQueuedFollowUpRunContexts,
  type PiHarnessCredentialOperationLease,
} from '../createHarness.js'

type ProviderConfig = Parameters<ModelRuntime['registerProvider']>[1]
type ProviderStream = ReturnType<NonNullable<ProviderConfig['streamSimple']>>

function assistantMessage(id: string, text: string) {
  return {
    id,
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'openai-completions' as const,
    provider: 'actor-probe',
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

function runContext(userId: string): RunContext {
  return {
    abortSignal: new AbortController().signal,
    workdir: '/tmp',
    workspaceId: 'workspace-a',
    userId,
  }
}

describe('pinned Pi queued actor compaction boundary', () => {
  it('activates each queued submitter before automatic compaction and keeps one Pi writer', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-queued-compaction-'))
    try {
      let currentContext = runContext('A')
      let activeActor = 'A'
      const authActors: string[] = []
      const events: string[] = []
      let releaseFirst!: () => void
      const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve })
      let firstStarted!: () => void
      const firstStart = new Promise<void>((resolve) => { firstStarted = resolve })
      let providerCall = 0

      const credentials: CredentialStore = {
        async read(providerId) {
          if (providerId !== 'actor-probe') return undefined
          authActors.push(activeActor)
          return { type: 'api_key', key: `key-${activeActor}` }
        },
        async list() { return [{ providerId: 'actor-probe', type: 'api_key' }] },
        async modify(_providerId, modify) { return modify(undefined) },
        async delete() {},
      }
      const modelRuntime = await ModelRuntime.create({
        credentials,
        modelsPath: null,
        refreshOnCreate: false,
      })
      modelRuntime.registerProvider('actor-probe', {
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
          const first = providerCall === 1
          if (first) firstStarted()
          const text = first ? `A ${'large-context '.repeat(200)}` : `response-${providerCall}`
          return providerStream(assistantMessage(`assistant-${providerCall}`, text), first ? firstRelease : undefined)
        },
      })
      await modelRuntime.refresh({ allowNetwork: false })
      const model = modelRuntime.getModel('actor-probe', 'actor-probe')
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
      const state = {
        queuedFollowUpContexts: new WeakMap<object, RunContext>(),
        queuedTurnActive: false,
        activeQueuedLease: undefined as (PiHarnessCredentialOperationLease & { revoke(): void }) | undefined,
      }
      const binding = bindQueuedFollowUpRunContexts(
        session,
        state,
        () => currentContext,
        (context) => {
          activeActor = context.userId ?? 'missing'
          let active = true
          const controller = new AbortController()
          return {
            context,
            signal: controller.signal,
            assertActive() {
              if (!active) throw new Error('inactive')
            },
            revoke() {
              active = false
              controller.abort()
            },
          }
        },
        true,
      )
      const unsubscribe = session.subscribe((event) => {
        if (event.type === 'compaction_start') events.push(`compact:${activeActor}`)
      })

      const prompt = session.prompt('turn A')
      await firstStart
      currentContext = runContext('B')
      await session.followUp('turn B')
      currentContext = runContext('C')
      await session.followUp('turn C')
      releaseFirst()
      await prompt

      const firstB = authActors.indexOf('B')
      const firstC = authActors.indexOf('C')
      expect(authActors[0]).toBe('A')
      expect(firstB).toBeGreaterThan(0)
      expect(firstC).toBeGreaterThan(firstB)
      expect(authActors.slice(firstB, firstC).every((actor) => actor === 'B')).toBe(true)
      expect(authActors.slice(firstC).every((actor) => actor === 'C')).toBe(true)
      expect(events).toContain('compact:B')
      expect(session.sessionId).toBeDefined()

      unsubscribe()
      binding.cleanup()
      session.dispose()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
