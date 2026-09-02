import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  VerifiedWorkspaceCredentialAuthorityV1,
  WorkspaceCredentialOperationAuthorityV1,
} from '../../../../shared/credentials/authority.js'
import { createFakeAuthorityVerifierV1 } from '../../../credentials/hostResolver.js'
import {
  ACTOR_CREDENTIAL_CONTEXT_MISSING,
  ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN,
  createOperationScopedCredentialStore,
} from '../operationScopedCredentialStore.js'
import {
  createPiCodingAgentHarness,
  type PiHarnessCredentialOperationLease,
  type PiHarnessCredentialStoreFactoryInput,
} from '../createHarness.js'
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

function operationLease(context: RunContext): {
  lease: PiHarnessCredentialOperationLease
  revoke: () => void
} {
  const controller = new AbortController()
  let active = true
  return {
    lease: {
      context,
      signal: controller.signal,
      assertActive() {
        if (!active || controller.signal.aborted) {
          throw Object.assign(new Error('credential operation authority is missing or expired'), {
            code: ACTOR_CREDENTIAL_CONTEXT_MISSING,
          })
        }
      },
    },
    revoke() {
      active = false
      controller.abort()
    },
  }
}

function emptyStore(): CredentialStore {
  return new InMemoryCredentialStore()
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function codexAccessToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: `account-${userId}` },
  })).toString('base64url')
  return `header.${payload}.signature`
}

function providerStream(id: string, text: string, wait?: Promise<void>): AssistantMessageEventStream {
  const message = {
    id,
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'openai-completions' as const,
    provider: 'openai-codex',
    model: 'gpt-5.6-luna',
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
      await wait
      yield { type: 'start', partial: { ...message, content: [] } }
      yield { type: 'text_delta', contentIndex: 0, delta: text, partial: message }
      yield { type: 'text_end', contentIndex: 0, content: text, partial: message }
      yield { type: 'done', reason: 'stop', message }
    },
    async result() { return message },
  } as unknown as AssistantMessageEventStream
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
    let current: PiHarnessCredentialOperationLease | undefined
    const resolvedActors: Array<Readonly<{ workspaceId: string; userId: string; executionClass: string }>> = []
    const actorStores = new Map<string, CredentialStore>([
      ['user-a', memoryStore({ 'openai-codex': { type: 'oauth', access: 'a', refresh: 'ra', expires: 1 } })],
      ['user-b', memoryStore({ 'openai-codex': { type: 'oauth', access: 'b', refresh: 'rb', expires: 1 } })],
    ])
    const store = createOperationScopedCredentialStore({
      sessionCtx: Object.freeze({ workspaceId: 'workspace-a' }),
      getOperationLease: () => current,
      compatibilityStore: emptyStore(),
      resolveActorStore: (actor) => {
        resolvedActors.push(actor)
        return actorStores.get(actor.userId)!
      },
    })

    current = operationLease(runContext('/tmp', 'user-a')).lease
    await expect(store.read('openai-codex')).resolves.toMatchObject({ access: 'a' })
    current = operationLease(runContext('/tmp', 'user-b')).lease
    await expect(store.read('openai-codex')).resolves.toMatchObject({ access: 'b' })

    expect(resolvedActors.map((actor) => actor.userId)).toEqual(['user-a', 'user-b'])
    expect(resolvedActors.every(Object.isFrozen)).toBe(true)
    expect(resolvedActors[0]).not.toBe(resolvedActors[1])
  })

  it('fails closed for actor-scoped secret operations and safely omits actor listings without trusted context', async () => {
    let current: PiHarnessCredentialOperationLease | undefined
    const compatibility = memoryStore({
      anthropic: { type: 'api_key', key: 'compat' },
      'openai-codex': { type: 'oauth', access: 'must-not-fall-through', refresh: 'x', expires: 1 },
    })
    const resolveActorStore = vi.fn(() => emptyStore())
    const store = createOperationScopedCredentialStore({
      sessionCtx: { workspaceId: 'workspace-a' },
      getOperationLease: () => current,
      compatibilityStore: compatibility,
      resolveActorStore,
    })

    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
    await expect(store.modify('openai-codex', async (value) => value)).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
    await expect(store.delete('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
    await expect(store.list()).resolves.toEqual([{ providerId: 'anthropic', type: 'api_key' }])
    expect(resolveActorStore).not.toHaveBeenCalled()

    current = operationLease(runContext('/tmp', 'user-a', 'workspace-b')).lease
    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN })
    await expect(store.list()).resolves.toEqual([{ providerId: 'anthropic', type: 'api_key' }])

    current = operationLease({ ...runContext('/tmp', 'user-a'), executionClass: undefined }).lease
    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_DELIVERY_FORBIDDEN })

    const valid = runContext('/tmp', 'user-a')
    const copiedScope = {
      ...valid.credentialAuthority!.scope,
    } as AuthorizedWorkspaceCredentialScopeV1
    current = operationLease({
      ...valid,
      credentialAuthority: { ...valid.credentialAuthority!, scope: copiedScope },
    }).lease
    await expect(store.read('openai-codex')).rejects.toMatchObject({ code: ACTOR_CREDENTIAL_CONTEXT_MISSING })
  })

  it('retains the entry lease across a deferred compatibility list and never adopts a newer actor', async () => {
    let current: PiHarnessCredentialOperationLease | undefined
    const compatibilityStarted = deferred<void>()
    const releaseCompatibility = deferred<void>()
    const compatibility: CredentialStore = {
      async read() { return undefined },
      async list() {
        compatibilityStarted.resolve()
        await releaseCompatibility.promise
        return [{ providerId: 'anthropic', type: 'api_key' }]
      },
      async modify(_providerId, modify) { return modify(undefined) },
      async delete() {},
    }
    const resolvedActors: string[] = []
    const store = createOperationScopedCredentialStore({
      sessionCtx: { workspaceId: 'workspace-a' },
      getOperationLease: () => current,
      compatibilityStore: compatibility,
      resolveActorStore: (actor) => {
        resolvedActors.push(actor.userId)
        return memoryStore({
          'openai-codex': {
            type: 'oauth',
            access: actor.userId,
            refresh: `refresh-${actor.userId}`,
            expires: 1,
          },
        })
      },
    })

    const actorA = operationLease(runContext('/tmp', 'user-a'))
    current = actorA.lease
    const pending = store.list()
    await compatibilityStarted.promise
    actorA.revoke()
    current = operationLease(runContext('/tmp', 'user-b')).lease
    releaseCompatibility.resolve()

    await expect(pending).resolves.toEqual([{ providerId: 'anthropic', type: 'api_key' }])
    expect(resolvedActors).toEqual([])
  })

  it('preserves compatibility behavior outside the actor-scoped provider set', async () => {
    const compatibility = memoryStore({ anthropic: { type: 'api_key', key: 'compat' } })
    const store = createOperationScopedCredentialStore({
      sessionCtx: { workspaceId: 'workspace-a' },
      getOperationLease: () => undefined,
      compatibilityStore: compatibility,
      resolveActorStore: () => { throw new Error('must not resolve actor') },
    })

    await expect(store.read('anthropic')).resolves.toEqual({ type: 'api_key', key: 'compat' })
    await expect(store.modify('anthropic', async () => ({ type: 'api_key', key: 'changed' })))
      .resolves.toEqual({ type: 'api_key', key: 'changed' })
    await expect(store.delete('anthropic')).resolves.toBeUndefined()
  })

  it('propagates lease revocation so actor-store modify cannot commit', async () => {
    const operation = operationLease(runContext('/tmp', 'user-a'))
    const writeStarted = deferred<void>()
    const releaseWrite = deferred<void>()
    let committed = false
    let receivedSignal: AbortSignal | undefined
    const actorStore: CredentialStore = {
      async read() { return undefined },
      async list() { return [] },
      async modify(_providerId, modify, options) {
        receivedSignal = options?.signal
        const next = await modify(undefined)
        writeStarted.resolve()
        await releaseWrite.promise
        if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        committed = next !== undefined
        return next
      },
      async delete() {},
    }
    const store = createOperationScopedCredentialStore({
      sessionCtx: { workspaceId: 'workspace-a' },
      getOperationLease: () => operation.lease,
      compatibilityStore: emptyStore(),
      resolveActorStore: () => actorStore,
    })

    const pending = store.modify('openai-codex', async () => ({ type: 'api_key', key: 'new' }))
    await writeStarted.promise
    operation.revoke()
    releaseWrite.resolve()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(receivedSignal?.aborted).toBe(true)
    expect(committed).toBe(false)
  })

  it('propagates lease revocation so actor-store delete cannot commit', async () => {
    const operation = operationLease(runContext('/tmp', 'user-a'))
    const deleteStarted = deferred<void>()
    const releaseDelete = deferred<void>()
    let deleted = false
    const actorStore: CredentialStore = {
      async read() { return undefined },
      async list() { return [] },
      async modify(_providerId, modify) { return modify(undefined) },
      async delete(_providerId, options) {
        deleteStarted.resolve()
        await releaseDelete.promise
        if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        deleted = true
      },
    }
    const store = createOperationScopedCredentialStore({
      sessionCtx: { workspaceId: 'workspace-a' },
      getOperationLease: () => operation.lease,
      compatibilityStore: emptyStore(),
      resolveActorStore: () => actorStore,
    })

    const pending = store.delete('openai-codex')
    await deleteStarted.promise
    operation.revoke()
    releaseDelete.resolve()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(deleted).toBe(false)
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
              'openai-codex': {
                type: 'oauth',
                access: actor.userId,
                refresh: `refresh-${actor.userId}`,
                expires: Date.now() + 3_600_000,
                accountId: `account-${actor.userId}`,
              },
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
      expect(resolvedKeys).toEqual(['user-a', 'user-b'])
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

  it('keeps a blocked queued Pi continuation isolated from concurrent and detached harness commands', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-actor-concurrent-'))
    try {
      const firstStarted = deferred()
      const releaseFirst = deferred()
      const bStarted = deferred()
      const releaseB = deferred()
      const bReadStarted = deferred()
      const releaseBRead = deferred()
      let deferNextBRead = false
      let bReadSignal: AbortSignal | undefined
      let bReadReturnedAfterDispose = false
      let providerCall = 0
      let detachedAuth: Promise<unknown> | undefined
      let queuedAuth: Promise<unknown> | undefined
      let currentRegistry: { getApiKeyForProvider(providerId: string): Promise<string | undefined> } | undefined
      const commandKeys: string[] = []
      const resolvedActors: string[] = []

      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore: (input) => createOperationScopedCredentialStore({
            ...input,
            compatibilityStore: emptyStore(),
            resolveActorStore: (actor): CredentialStore => ({
              async read(_providerId, options) {
                resolvedActors.push(actor.userId)
                if (actor.userId === 'B' && deferNextBRead) {
                  deferNextBRead = false
                  bReadSignal = options?.signal
                  bReadStarted.resolve()
                  await releaseBRead.promise
                  if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
                  bReadReturnedAfterDispose = true
                }
                return {
                  type: 'oauth',
                  access: codexAccessToken(actor.userId),
                  refresh: `refresh-${actor.userId}`,
                  expires: Date.now() + 3_600_000,
                  accountId: `account-${actor.userId}`,
                }
              },
              async list() { return [{ providerId: 'openai-codex', type: 'oauth' }] },
              async modify(_providerId, modify) { return modify(undefined) },
              async delete() {},
            }),
          }),
          extensionFactories: [(pi) => {
            pi.registerProvider('openai-codex', {
              api: 'openai-completions',
              baseUrl: 'https://example.invalid',
              models: [{
                id: 'gpt-5.6-luna',
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
                if (providerCall === 1) firstStarted.resolve()
                if (providerCall === 2) {
                  bStarted.resolve()
                  deferNextBRead = true
                  queuedAuth = currentRegistry!.getApiKeyForProvider('openai-codex')
                }
                return providerStream(
                  `assistant-${providerCall}`,
                  `response-${providerCall}`,
                  providerCall === 1 ? releaseFirst.promise : providerCall === 2 ? releaseB.promise : undefined,
                )
              },
            })
            pi.registerCommand('capture-detached-auth', {
              description: 'capture a lookup whose command lease will expire',
              handler: async (_args, commandContext) => {
                currentRegistry = commandContext.modelRegistry
                detachedAuth = (async () => {
                  await bStarted.promise
                  return commandContext.modelRegistry.getApiKeyForProvider('openai-codex')
                })()
              },
            })
            pi.registerCommand('resolve-current-auth', {
              description: 'resolve the concurrent command actor',
              handler: async (_args, commandContext) => {
                currentRegistry = commandContext.modelRegistry
                commandKeys.push((await commandContext.modelRegistry.getApiKeyForProvider('openai-codex')) ?? 'missing')
              },
            })
          }],
        },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id } = await harness.sessions.create(sessionCtx)
      const model = { provider: 'openai-codex', id: 'gpt-5.6-luna' }
      const adapterA = await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', model, ctx: sessionCtx },
        runContext(cwd, 'A'),
      )
      const adapterB = await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', model, ctx: sessionCtx },
        runContext(cwd, 'B'),
      )
      await harness.executeSlashCommand!(id, 'capture-detached-auth', '', runContext(cwd, 'A'))

      const running = adapterA.prompt('turn A')
      await Promise.race([
        firstStarted.promise,
        running.then(() => { throw new Error(`turn A completed before the test provider started: ${JSON.stringify(adapterA.readSnapshot())}`) }),
      ])
      await adapterB.followUp('turn B')
      releaseFirst.resolve()
      await bStarted.promise
      await bReadStarted.promise

      await harness.executeSlashCommand!(id, 'resolve-current-auth', '', runContext(cwd, 'D'))
      await expect(detachedAuth).resolves.toBeUndefined()
      expect(commandKeys).toEqual([codexAccessToken('D')])

      await harness.sessions.delete(sessionCtx, id)
      expect(bReadSignal?.aborted).toBe(true)
      releaseBRead.resolve()
      await expect(queuedAuth).resolves.toBeUndefined()
      expect(bReadReturnedAfterDispose).toBe(false)
      releaseB.resolve()
      await running

      expect(resolvedActors).toContain('A')
      expect(resolvedActors).toContain('B')
      expect(resolvedActors).toContain('D')
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)

  it('rechecks the same lease after deferred verifier and actor-store reads', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-actor-revocation-'))
    try {
      const verifierStarted = deferred<void>()
      const releaseVerifier = deferred<VerifiedWorkspaceCredentialAuthorityV1>()
      const storeStarted = deferred<void>()
      const releaseStore = deferred<void>()
      let pendingVerifierAuth: Promise<string | undefined> | undefined
      let pendingStoreAuth: Promise<string | undefined> | undefined
      let storeSignal: AbortSignal | undefined

      const createCredentialStore = (input: PiHarnessCredentialStoreFactoryInput) =>
        createOperationScopedCredentialStore({
          ...input,
          compatibilityStore: emptyStore(),
          resolveActorStore: (actor) => ({
            async read(_providerId, options) {
              if (actor.userId === 'deferred-store') {
                storeSignal = options?.signal
                storeStarted.resolve()
                await releaseStore.promise
              }
              return {
                type: 'oauth',
                access: `LEAK-${actor.userId}`,
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
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore,
          extensionFactories: [(pi) => {
            pi.registerCommand('deferred-verifier', {
              description: 'start auth and return before verifier completion',
              handler: async (_args, commandContext) => {
                pendingVerifierAuth = commandContext.modelRegistry.getApiKeyForProvider('openai-codex')
                await verifierStarted.promise
              },
            })
            pi.registerCommand('deferred-store', {
              description: 'start auth and return before store completion',
              handler: async (_args, commandContext) => {
                pendingStoreAuth = commandContext.modelRegistry.getApiKeyForProvider('openai-codex')
                await storeStarted.promise
              },
            })
          }],
        },
      })
      const { id } = await harness.sessions.create({ workspaceId: 'workspace-a' })
      // Warm the one shared Pi runtime before installing either deferred seam.
      await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: { workspaceId: 'workspace-a' } },
        runContext(cwd, 'warm-user'),
      )

      const verifierScope = Object.freeze({
        contractVersion: 'boring.authorized-workspace-credential-scope.v1',
      }) as unknown as AuthorizedWorkspaceCredentialScopeV1
      const verifierContext: RunContext = {
        ...runContext(cwd, 'deferred-verifier'),
        credentialAuthority: {
          contractVersion: 'boring.workspace-credential-operation-authority.v1',
          scope: verifierScope,
          verifier: {
            contractVersion: 'boring.workspace-credential-authority-verifier.v1',
            async verifyCurrent() {
              verifierStarted.resolve()
              return releaseVerifier.promise
            },
          },
        },
      }
      await harness.executeSlashCommand!(id, 'deferred-verifier', '', verifierContext)
      releaseVerifier.resolve({
        workspaceId: 'workspace-a',
        appId: 'test-app',
        principal: { kind: 'user', userId: 'deferred-verifier', membershipRole: 'editor' },
        authorizationReceiptId: 'receipt-deferred-verifier',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      await expect(pendingVerifierAuth).resolves.toBeUndefined()

      await harness.executeSlashCommand!(id, 'deferred-store', '', runContext(cwd, 'deferred-store'))
      expect(storeSignal?.aborted).toBe(true)
      releaseStore.resolve()
      await expect(pendingStoreAuth).resolves.toBeUndefined()
      expect(storeSignal?.aborted).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)
})
