import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryCredentialStore, type CredentialStore } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunContext } from '../../../../shared/harness.js'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  WorkspaceCredentialOperationAuthorityV1,
} from '../../../../shared/credentials/authority.js'
import { CREDENTIAL_ERROR_CODES } from '../../../../shared/credentials/errors.js'
import { createFakeAuthorityVerifierV1 } from '../../../credentials/hostResolver.js'
import {
  createPiCodingAgentHarness,
  type PiHarnessCredentialStore,
  type PiHarnessCredentialStoreFactoryInput,
} from '../createHarness.js'
import { createOperationScopedCredentialStore } from '../operationScopedCredentialStore.js'

const signal = new AbortController().signal

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function bounded<T>(label: string, promise: Promise<T>, ms = 5_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)),
  ])
}

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
    executionClass: 'request-attached-interactive',
    credentialAuthority: credentialAuthority(workspaceId, userId),
  }
}

function emptyStore(): CredentialStore {
  return new InMemoryCredentialStore()
}

function credential(userId: string) {
  return {
    type: 'oauth' as const,
    access: `access-${userId}`,
    refresh: `refresh-${userId}`,
    expires: Date.now() + 3_600_000,
    accountId: `account-${userId}`,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('Pi handle-scoped credential lifetime', () => {
  it('aborts a deferred command read on handle deletion and rejects a retained adapter', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-handle-read-delete-'))
    try {
      const readStarted = deferred()
      const releaseRead = deferred()
      const holdCommand = deferred()
      let actorSignal: AbortSignal | undefined
      let pendingRead: Promise<unknown> | undefined
      let deferRead = false
      let capturedStore: PiHarnessCredentialStore | undefined
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore: (input) => {
            capturedStore = createOperationScopedCredentialStore({
              ...input,
              compatibilityStore: emptyStore(),
              resolveActorStore: (actor): CredentialStore => ({
                async read(_providerId, options) {
                  if (deferRead) {
                    actorSignal = options?.signal
                    readStarted.resolve()
                    await releaseRead.promise
                    if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
                  }
                  return credential(actor.userId)
                },
                async list() { return [{ providerId: 'openai-codex', type: 'oauth' }] },
                async modify(_providerId, modify) { return modify(undefined) },
                async delete() {},
              }),
            })
            return capturedStore
          },
          extensionFactories: [(pi) => {
            pi.registerCommand('deferred-read-on-delete', {
              description: 'keep one handle operation active while its credential read waits',
              handler: async () => {
                pendingRead = capturedStore!.read('openai-codex').catch((error) => error)
                await readStarted.promise
                await holdCommand.promise
              },
            })
          }],
        },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id } = await harness.sessions.create(sessionCtx)
      const adapter = await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd, 'reader'),
      )

      deferRead = true
      const command = harness.executeSlashCommand!(
        id,
        'deferred-read-on-delete',
        '',
        runContext(cwd, 'reader'),
      )
      await bounded('read command started', Promise.race([
        readStarted.promise,
        command.then(() => { throw new Error('read command ended before read started') }),
      ]))
      const deletion = harness.sessions.delete(sessionCtx, id)
      await vi.waitFor(() => expect(actorSignal?.aborted).toBe(true))
      releaseRead.resolve()
      await expect(pendingRead).resolves.toMatchObject({ name: 'AbortError' })
      await expect(adapter.prompt('stale')).rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
      })
      holdCommand.resolve()
      await bounded('read command', command)
      await bounded('read deletion', deletion)
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)

  it('aborts a deferred command modify before durable commit on handle deletion', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-handle-modify-delete-'))
    try {
      const writeStarted = deferred()
      const releaseWrite = deferred()
      const holdCommand = deferred()
      let committed = false
      let writeSignal: AbortSignal | undefined
      let pendingModify: Promise<unknown> | undefined
      let capturedStore: PiHarnessCredentialStore | undefined
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore: (input) => {
            capturedStore = createOperationScopedCredentialStore({
              ...input,
              compatibilityStore: emptyStore(),
              resolveActorStore: (): CredentialStore => ({
                async read() { return credential('writer') },
                async list() { return [{ providerId: 'openai-codex', type: 'oauth' }] },
                async modify(_providerId, modify, options) {
                  writeSignal = options?.signal
                  const next = await modify(credential('writer'))
                  writeStarted.resolve()
                  await releaseWrite.promise
                  if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
                  committed = next !== undefined
                  return next
                },
                async delete() {},
              }),
            })
            return capturedStore
          },
          extensionFactories: [(pi) => {
            pi.registerCommand('deferred-modify-on-delete', {
              description: 'keep one handle operation active while its credential write waits',
              handler: async () => {
                pendingModify = capturedStore!.modify(
                  'openai-codex',
                  async () => credential('rotated'),
                ).catch((error) => error)
                await writeStarted.promise
                await holdCommand.promise
              },
            })
          }],
        },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id } = await harness.sessions.create(sessionCtx)
      await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd, 'writer'),
      )

      const command = harness.executeSlashCommand!(
        id,
        'deferred-modify-on-delete',
        '',
        runContext(cwd, 'writer'),
      )
      await writeStarted.promise
      const deletion = harness.sessions.delete(sessionCtx, id)
      await vi.waitFor(() => expect(writeSignal?.aborted).toBe(true))
      releaseWrite.resolve()
      await expect(pendingModify).resolves.toMatchObject({ name: 'AbortError' })
      expect(committed).toBe(false)
      holdCommand.resolve()
      await bounded('modify command', command)
      await bounded('modify deletion', deletion)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)

  it('revokes pending cold creation before accepting a late handle', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-handle-cold-delete-'))
    try {
      const listStarted = deferred()
      const releaseList = deferred()
      let listSignal: AbortSignal | undefined
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore: (input: PiHarnessCredentialStoreFactoryInput) =>
            createOperationScopedCredentialStore({
              ...input,
              compatibilityStore: emptyStore(),
              resolveActorStore: (): CredentialStore => ({
                async read() { return credential('cold') },
                async list(options) {
                  listSignal = options?.signal
                  listStarted.resolve()
                  await releaseList.promise
                  if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
                  return [{ providerId: 'openai-codex', type: 'oauth' }]
                },
                async modify(_providerId, modify) { return modify(undefined) },
                async delete() {},
              }),
            }),
        },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id } = await harness.sessions.create(sessionCtx)
      const opening = harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd, 'cold'),
      )
      await listStarted.promise
      const deletion = harness.sessions.delete(sessionCtx, id)
      await vi.waitFor(() => expect(listSignal?.aborted).toBe(true))
      releaseList.resolve()
      await expect(opening).rejects.toMatchObject({ code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID })
      await deletion
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)

  it('does not cancel an active credential operation in an unrelated Pi session', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-handle-unrelated-'))
    try {
      const readStarted = deferred()
      const releaseRead = deferred()
      const holdCommand = deferred()
      let readSignal: AbortSignal | undefined
      let pendingRead: Promise<unknown> | undefined
      let deferRead = false
      const stores: PiHarnessCredentialStore[] = []
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore: (input) => {
            const store = createOperationScopedCredentialStore({
              ...input,
              compatibilityStore: emptyStore(),
              resolveActorStore: (actor): CredentialStore => ({
                async read(_providerId, options) {
                  if (actor.userId === 'session-a' && deferRead) {
                    readSignal = options?.signal
                    readStarted.resolve()
                    await releaseRead.promise
                    if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
                  }
                  return credential(actor.userId)
                },
                async list() { return [{ providerId: 'openai-codex', type: 'oauth' }] },
                async modify(_providerId, modify) { return modify(undefined) },
                async delete() {},
              }),
            })
            stores.push(store)
            return store
          },
          extensionFactories: [(pi) => {
            pi.registerCommand('unrelated-read', {
              description: 'defer a read in session A',
              handler: async () => {
                pendingRead = stores[0]!.read('openai-codex').catch((error) => error)
                await readStarted.promise
                await holdCommand.promise
              },
            })
          }],
        },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id: sessionA } = await harness.sessions.create(sessionCtx)
      const { id: sessionB } = await harness.sessions.create(sessionCtx)
      await harness.getPiSessionAdapter!(
        { sessionId: sessionA, content: '', ctx: sessionCtx },
        runContext(cwd, 'session-a'),
      )
      await harness.getPiSessionAdapter!(
        { sessionId: sessionB, content: '', ctx: sessionCtx },
        runContext(cwd, 'session-b'),
      )

      deferRead = true
      const command = harness.executeSlashCommand!(
        sessionA,
        'unrelated-read',
        '',
        runContext(cwd, 'session-a'),
      )
      await bounded('unrelated read started', Promise.race([
        readStarted.promise,
        command.then(() => { throw new Error('unrelated command ended before read started') }),
      ]))
      await bounded('delete unrelated session B', harness.sessions.delete(sessionCtx, sessionB))
      expect(readSignal?.aborted).toBe(false)
      releaseRead.resolve()
      await expect(pendingRead).resolves.toMatchObject({ access: 'access-session-a' })
      holdCommand.resolve()
      await bounded('unrelated command A', command)
      await bounded('delete session A', harness.sessions.delete(sessionCtx, sessionA))
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
