import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryCredentialStore, type CredentialStore } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunContext } from '../../../../shared/harness.js'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  WorkspaceCredentialOperationAuthorityV1,
} from '../../../../shared/credentials/authority.js'
import { createFakeAuthorityVerifierV1 } from '../../../credentials/hostResolver.js'
import {
  ACTOR_CREDENTIAL_CONTEXT_MISSING,
  ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN,
  createOperationScopedCredentialStore,
} from '../operationScopedCredentialStore.js'
import { createPiCodingAgentHarness, type PiHarnessCredentialStoreFactoryInput } from '../createHarness.js'
import { PiSessionStore } from '../sessions.js'

const signal = new AbortController().signal
const interactive = 'request-attached-interactive' as const

function credentialAuthority(
  workspaceId: string,
  userId: string,
): WorkspaceCredentialOperationAuthorityV1 {
  const scope = Object.freeze({
    contractVersion: 'boring.authorized-workspace-credential-scope.v1',
  }) as unknown as AuthorizedWorkspaceCredentialScopeV1
  return Object.freeze({
    contractVersion: 'boring.workspace-credential-operation-authority.v1',
    scope,
    verifier: createFakeAuthorityVerifierV1([{
      scope,
      authority: {
        workspaceId,
        appId: 'test-app',
        principal: { kind: 'user', userId, membershipRole: 'editor' },
        authorizationReceiptId: `receipt-${userId}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    }]),
  })
}

function runContext(cwd: string, userId: string, workspaceId = 'workspace-a'): RunContext {
  return {
    abortSignal: signal,
    workdir: cwd,
    workspaceId,
    userId,
    executionClass: interactive,
    credentialAuthority: credentialAuthority(workspaceId, userId),
  }
}

function emptyStore(): CredentialStore {
  return new InMemoryCredentialStore()
}

function memoryStore(entries: Record<string, Awaited<ReturnType<CredentialStore['read']>>>): CredentialStore {
  const values = new Map(Object.entries(entries))
  return {
    async read(providerId) { return values.get(providerId) },
    async list() {
      return [...values].flatMap(([providerId, credential]) => credential
        ? [{ providerId, type: credential.type }]
        : [])
    },
    async modify(providerId, modify) {
      const next = await modify(values.get(providerId))
      if (next !== undefined) values.set(providerId, next)
      return values.get(providerId)
    },
    async delete(providerId) { values.delete(providerId) },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('operation-scoped credential delegation', () => {
  it('resolves a fresh immutable actor for each operation and never crosses users', async () => {
    let current: RunContext | undefined
    const resolvedActors: Array<Readonly<{ workspaceId: string; userId: string; executionClass: string }>> = []
    const actorStores = new Map<string, CredentialStore>([
      ['user-a', memoryStore({ 'openai-codex': { type: 'oauth', access: 'a', refresh: 'ra', expires: 1 } })],
      ['user-b', memoryStore({ 'openai-codex': { type: 'oauth', access: 'b', refresh: 'rb', expires: 1 } })],
    ])
    const store = createOperationScopedCredentialStore({
      sessionCtx: Object.freeze({ workspaceId: 'workspace-a' }),
      getRunContext: () => current,
      compatibilityStore: emptyStore(),
      resolveActorStore: (actor) => {
        resolvedActors.push(actor)
        return actorStores.get(actor.userId)!
      },
    })

    current = runContext('/tmp', 'user-a')
    await expect(store.read('openai-codex')).resolves.toMatchObject({ access: 'a' })
    current = runContext('/tmp', 'user-b')
    await expect(store.read('openai-codex')).resolves.toMatchObject({ access: 'b' })

    expect(resolvedActors.map((actor) => actor.userId)).toEqual(['user-a', 'user-b'])
    expect(resolvedActors.every(Object.isFrozen)).toBe(true)
    expect(resolvedActors[0]).not.toBe(resolvedActors[1])
  })

  it('fails closed for actor-scoped secret operations and safely omits actor listings without trusted context', async () => {
    let current: RunContext | undefined
    const compatibility = memoryStore({
      anthropic: { type: 'api_key', key: 'compat' },
      'openai-codex': { type: 'oauth', access: 'must-not-fall-through', refresh: 'x', expires: 1 },
    })
    const resolveActorStore = vi.fn(() => emptyStore())
    const store = createOperationScopedCredentialStore({
      sessionCtx: { workspaceId: 'workspace-a' },
      getRunContext: () => current,
      compatibilityStore: compatibility,
      resolveActorStore,
    })

    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
    await expect(store.modify('openai-codex', async (value) => value)).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
    await expect(store.delete('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
    await expect(store.list()).resolves.toEqual([{ providerId: 'anthropic', type: 'api_key' }])
    expect(resolveActorStore).not.toHaveBeenCalled()

    current = runContext('/tmp', 'user-a', 'workspace-b')
    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN })
    await expect(store.list()).resolves.toEqual([{ providerId: 'anthropic', type: 'api_key' }])

    current = { ...runContext('/tmp', 'user-a'), executionClass: undefined }
    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN })

    const valid = runContext('/tmp', 'user-a')
    const copiedScope = {
      ...valid.credentialAuthority!.scope,
    } as AuthorizedWorkspaceCredentialScopeV1
    current = {
      ...valid,
      credentialAuthority: { ...valid.credentialAuthority!, scope: copiedScope },
    }
    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
  })

  it('preserves compatibility behavior outside the actor-scoped provider set', async () => {
    const compatibility = memoryStore({ anthropic: { type: 'api_key', key: 'compat' } })
    const store = createOperationScopedCredentialStore({
      sessionCtx: { workspaceId: 'workspace-a' },
      getRunContext: () => undefined,
      compatibilityStore: compatibility,
      resolveActorStore: () => { throw new Error('must not resolve actor') },
    })

    await expect(store.read('anthropic')).resolves.toEqual({ type: 'api_key', key: 'compat' })
    await expect(store.modify('anthropic', async () => ({ type: 'api_key', key: 'changed' })))
      .resolves.toEqual({ type: 'api_key', key: 'changed' })
    await expect(store.delete('anthropic')).resolves.toBeUndefined()
  })
})

describe('shared Pi handle actor seam', () => {
  it('uses the harness ModelRuntime, revokes detached work, and enforces one-at-a-time follow-ups', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-actor-handle-'))
    try {
      await mkdir(join(cwd, '.pi'), { recursive: true })
      await writeFile(join(cwd, '.pi', 'settings.json'), JSON.stringify({ followUpMode: 'all' }))

      let factoryInput: PiHarnessCredentialStoreFactoryInput | undefined
      let detachedAuth: Promise<unknown> | undefined
      const actors: string[] = []
      const resolvedKeys: Array<string | undefined> = []
      const createCredentialStore = vi.fn((input: PiHarnessCredentialStoreFactoryInput) => {
        factoryInput = input
        return createOperationScopedCredentialStore({
          ...input,
          compatibilityStore: emptyStore(),
          resolveActorStore: (actor) => {
            actors.push(actor.userId)
            return memoryStore({
              // A synthetic API key makes the extension compatibility facade
              // expose the exact actor selected by the harness ModelRuntime.
              'openai-codex': { type: 'api_key', key: actor.userId },
            })
          },
        })
      })
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore,
          extensionFactories: [(pi) => {
            pi.registerCommand('credential-test', {
              description: 'exercise ModelRuntime credential resolution',
              handler: async (_args, commandContext) => {
                resolvedKeys.push(await commandContext.modelRegistry.getApiKeyForProvider('openai-codex'))
              },
            })
            pi.registerCommand('credential-detached-test', {
              description: 'prove detached async descendants lose authority',
              handler: async (_args, commandContext) => {
                detachedAuth = new Promise((resolve) => {
                  setTimeout(async () => {
                    try {
                      resolve(await commandContext.modelRegistry.getApiKeyForProvider('openai-codex'))
                    } catch (error) {
                      resolve(error)
                    }
                  }, 0)
                })
              },
            })
          }],
        },
      })
      const store = harness.sessions as PiSessionStore
      const { id } = await store.create({ workspaceId: 'workspace-a' })
      const open = vi.spyOn((await import('@mariozechner/pi-coding-agent')).SessionManager, 'open')

      const adapterA = await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: { workspaceId: 'workspace-a' } },
        runContext(cwd, 'user-a'),
      )
      await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: { workspaceId: 'workspace-a' } },
        runContext(cwd, 'user-b'),
      )

      expect(createCredentialStore).toHaveBeenCalledTimes(1)
      expect(factoryInput?.sessionCtx).toEqual({ workspaceId: 'workspace-a' })
      expect(Object.isFrozen(factoryInput?.sessionCtx)).toBe(true)
      expect(open).toHaveBeenCalledTimes(1)
      expect(adapterA.readSnapshot().followUpMode).toBe('one-at-a-time')

      actors.length = 0
      await harness.executeSlashCommand!(id, 'credential-test', '', runContext(cwd, 'user-a'))
      await harness.executeSlashCommand!(id, 'credential-test', '', runContext(cwd, 'user-b'))
      // The OpenAI Codex compatibility facade does not project synthetic API
      // keys, but these calls still traversed the injected actor store.
      expect(resolvedKeys).toEqual([undefined, undefined])
      expect(actors).toEqual(['user-a', 'user-b'])

      await harness.executeSlashCommand!(id, 'credential-detached-test', '', runContext(cwd, 'user-a'))
      await expect(detachedAuth).resolves.toBeUndefined()
      expect(actors).toEqual(['user-a', 'user-b'])
      expect(createCredentialStore).toHaveBeenCalledTimes(1)
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)
})
