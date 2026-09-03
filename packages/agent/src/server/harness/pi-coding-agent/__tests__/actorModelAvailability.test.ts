import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  InMemoryCredentialStore,
  type AssistantMessageEventStream,
  type CredentialStore,
} from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunContext } from '../../../../shared/harness.js'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  WorkspaceCredentialOperationAuthorityV1,
} from '../../../../shared/credentials/authority.js'
import { ErrorCode } from '../../../../shared/error-codes.js'
import { createFakeAuthorityVerifierV1 } from '../../../credentials/hostResolver.js'
import { createOperationScopedCredentialStore } from '../operationScopedCredentialStore.js'
import { createPiCodingAgentHarness } from '../createHarness.js'
import { SessionManager } from '@mariozechner/pi-coding-agent'

const interactive = 'request-attached-interactive' as const
const sessionCtx = { workspaceId: 'workspace-a' }
const codexModel = { provider: 'openai-codex', id: 'gpt-5.6-luna' }

function credentialAuthority(userId: string): WorkspaceCredentialOperationAuthorityV1 {
  const scope = Object.freeze({
    contractVersion: 'boring.authorized-workspace-credential-scope.v1',
  }) as unknown as AuthorizedWorkspaceCredentialScopeV1
  return Object.freeze({
    contractVersion: 'boring.workspace-credential-operation-authority.v1',
    scope,
    verifier: createFakeAuthorityVerifierV1([{
      scope,
      authority: {
        workspaceId: sessionCtx.workspaceId,
        appId: 'test-app',
        principal: { kind: 'user', userId, membershipRole: 'editor' },
        authorizationReceiptId: `receipt-${userId}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    }]),
  })
}

function runContext(cwd: string, userId: string): RunContext {
  return {
    abortSignal: new AbortController().signal,
    workdir: cwd,
    ...sessionCtx,
    userId,
    executionClass: interactive,
    credentialAuthority: credentialAuthority(userId),
  }
}

function codexCredential(userId: string) {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: `account-${userId}` },
  })).toString('base64url')
  return {
    type: 'oauth' as const,
    access: `header.${payload}.signature`,
    refresh: `refresh-${userId}`,
    expires: Date.now() + 3_600_000,
    accountId: `account-${userId}`,
  }
}

function providerStream(): AssistantMessageEventStream {
  const message = {
    id: 'availability-response',
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: 'ok' }],
    api: 'openai-completions' as const,
    provider: codexModel.provider,
    model: codexModel.id,
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
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'start', partial: { ...message, content: [] } }
      yield { type: 'text_delta', contentIndex: 0, delta: 'ok', partial: message }
      yield { type: 'text_end', contentIndex: 0, content: 'ok', partial: message }
      yield { type: 'done', reason: 'stop', message }
    },
    async result() { return message },
  } as unknown as AssistantMessageEventStream
}

function createActorHarness(cwd: string, connectedUsers: readonly string[]) {
  const stores = new Map<string, InMemoryCredentialStore>()
  for (const userId of connectedUsers) {
    const store = new InMemoryCredentialStore()
    void store.modify(codexModel.provider, async () => codexCredential(userId))
    stores.set(userId, store)
  }
  const resolvedActors: string[] = []
  const synchronousSnapshots: string[][] = []
  let providerCalls = 0
  const harness = createPiCodingAgentHarness({
    tools: [],
    cwd,
    sessionRoot: cwd,
    pi: {
      strictModelResolution: true,
      createCredentialStore: (input) => createOperationScopedCredentialStore({
        ...input,
        compatibilityStore: new InMemoryCredentialStore(),
        resolveActorStore: (actor): CredentialStore => {
          resolvedActors.push(actor.userId)
          return stores.get(actor.userId) ?? new InMemoryCredentialStore()
        },
      }),
      extensionFactories: [(pi) => {
        pi.registerCommand('snapshot-models', {
          description: 'capture the shared synchronous model snapshot',
          handler: async (_args, commandContext) => {
            synchronousSnapshots.push(commandContext.modelRegistry.getAvailable()
              .map((model) => model.provider))
          },
        })
        pi.registerProvider(codexModel.provider, {
          api: 'openai-completions',
          baseUrl: 'https://example.invalid',
          models: [{
            id: codexModel.id,
            name: 'Actor availability probe',
            api: 'openai-completions',
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1_000,
            maxTokens: 16,
          }],
          streamSimple() {
            providerCalls += 1
            return providerStream()
          },
        })
      }],
    },
  })
  return {
    harness,
    stores,
    resolvedActors,
    synchronousSnapshots,
    providerCalls: () => providerCalls,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('actor-scoped model availability', () => {
  it('lets a connected later actor select Codex after an unconnected actor cold-opens the shared handle', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-actor-model-absent-first-'))
    try {
      const runtime = createActorHarness(cwd, ['B'])
      const { id } = await runtime.harness.sessions.create(sessionCtx)
      const open = vi.spyOn(SessionManager, 'open')

      await runtime.harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd, 'A'),
      )
      runtime.resolvedActors.length = 0

      const adapterB = await runtime.harness.getPiSessionAdapter!(
        { sessionId: id, content: '', model: codexModel, ctx: sessionCtx },
        runContext(cwd, 'B'),
      )
      expect(adapterB.currentModel?.()).toEqual(codexModel)
      await adapterB.prompt('connected B')
      expect(runtime.providerCalls()).toBe(1)
      expect(runtime.resolvedActors).toContain('B')

      await expect(runtime.harness.getPiSessionAdapter!(
        { sessionId: id, content: '', model: codexModel, ctx: sessionCtx },
        runContext(cwd, 'A'),
      )).rejects.toMatchObject({ code: ErrorCode.enum.TOOL_INVALID_INPUT })
      expect(open).toHaveBeenCalledTimes(1)

      // Availability is advisory only. Disconnect after selection and prove the
      // next provider-auth boundary prevents another provider call.
      await runtime.stores.get('B')!.delete(codexModel.provider)
      await expect(adapterB.prompt('disconnected B')).rejects.toThrow('No API key found')
      expect(runtime.providerCalls()).toBe(1)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)

  it('never exposes or selects the cold-opening connected actor Codex state for an unconnected later actor', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-actor-model-connected-first-'))
    try {
      const runtime = createActorHarness(cwd, ['A'])
      const { id } = await runtime.harness.sessions.create(sessionCtx)
      const open = vi.spyOn(SessionManager, 'open')

      const adapterA = await runtime.harness.getPiSessionAdapter!(
        { sessionId: id, content: '', model: codexModel, ctx: sessionCtx },
        runContext(cwd, 'A'),
      )
      expect(adapterA.currentModel?.()).toEqual(codexModel)

      await runtime.harness.executeSlashCommand!(id, 'snapshot-models', '', runContext(cwd, 'A'))
      await runtime.harness.executeSlashCommand!(id, 'snapshot-models', '', runContext(cwd, 'B'))
      expect(runtime.synchronousSnapshots).toHaveLength(2)
      expect(runtime.synchronousSnapshots.every((providers) => !providers.includes(codexModel.provider))).toBe(true)

      const adapterB = await runtime.harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd, 'B'),
      )
      await expect(adapterB.prompt('unconnected B')).rejects.toThrow('No API key found')
      await expect(runtime.harness.getPiSessionAdapter!(
        { sessionId: id, content: '', model: codexModel, ctx: sessionCtx },
        runContext(cwd, 'B'),
      )).rejects.toMatchObject({ code: ErrorCode.enum.TOOL_INVALID_INPUT })
      expect(runtime.providerCalls()).toBe(0)
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
