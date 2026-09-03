import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunContext } from '../../../../shared/harness.js'
import type {
  AuthorizedWorkspaceCredentialScopeV1,
  WorkspaceCredentialOperationAuthorityV1,
} from '../../../../shared/credentials/authority.js'
import { CREDENTIAL_ERROR_CODES } from '../../../../shared/credentials/errors.js'
import { ErrorCode } from '../../../../shared/error-codes.js'
import { createFakeAuthorityVerifierV1 } from '../../../credentials/hostResolver.js'

const nativeSessionControl = vi.hoisted(() => ({
  created: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
  disposeCalls: 0,
}))

vi.mock('@mariozechner/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-coding-agent')>()
  return {
    ...actual,
    async createAgentSession(...args: Parameters<typeof actual.createAgentSession>) {
      const result = await actual.createAgentSession(...args)
      const originalDispose = result.session.dispose.bind(result.session)
      result.session.dispose = () => {
        nativeSessionControl.disposeCalls += 1
        originalDispose()
      }
      nativeSessionControl.created?.()
      await nativeSessionControl.release
      return result
    },
  }
})

import { createPiCodingAgentHarness } from '../createHarness.js'
import { PiSessionStore } from '../sessions.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
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

function runContext(cwd: string): RunContext {
  return {
    abortSignal: new AbortController().signal,
    workdir: cwd,
    workspaceId: 'workspace-a',
    userId: 'cold-user',
    executionClass: 'request-attached-interactive',
    credentialAuthority: credentialAuthority('workspace-a', 'cold-user'),
  }
}

afterEach(() => {
  nativeSessionControl.created = undefined
  nativeSessionControl.release = undefined
  nativeSessionControl.disposeCalls = 0
  vi.restoreAllMocks()
})

describe('Pi cold-creation disposal', () => {
  it('rejects reopen until durable delete settles and returns with no cached writer', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-delete-reopen-fence-'))
    const deleteStarted = deferred()
    const releaseDelete = deferred()
    const originalDelete = PiSessionStore.prototype.delete
    vi.spyOn(PiSessionStore.prototype, 'delete').mockImplementation(async function (
      this: PiSessionStore,
      ctx,
      sessionId,
    ) {
      deleteStarted.resolve()
      await releaseDelete.promise
      return originalDelete.call(this, ctx, sessionId)
    })

    try {
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: { createCredentialStore: () => new InMemoryCredentialStore() },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id } = await harness.sessions.create(sessionCtx)
      await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd),
      )

      const deletion = harness.sessions.delete(sessionCtx, id)
      await deleteStarted.promise
      await expect(harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd),
      )).rejects.toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND })
      expect(nativeSessionControl.disposeCalls).toBe(1)

      releaseDelete.resolve()
      await deletion
      expect(nativeSessionControl.disposeCalls).toBe(1)
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)

  it('clears a failed deletion fence so the intact session can reopen and deletion can retry', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-delete-retry-fence-'))
    const originalDelete = PiSessionStore.prototype.delete
    let deleteCalls = 0
    vi.spyOn(PiSessionStore.prototype, 'delete').mockImplementation(async function (
      this: PiSessionStore,
      ctx,
      sessionId,
    ) {
      deleteCalls += 1
      if (deleteCalls === 1) throw new Error('synthetic unlink failure')
      return originalDelete.call(this, ctx, sessionId)
    })

    try {
      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: { createCredentialStore: () => new InMemoryCredentialStore() },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id } = await harness.sessions.create(sessionCtx)
      await harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd),
      )

      await expect(harness.sessions.delete(sessionCtx, id)).rejects.toThrow('synthetic unlink failure')
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(false)
      await expect(harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd),
      )).resolves.toBeDefined()
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(true)

      await harness.sessions.delete(sessionCtx, id)
      expect(deleteCalls).toBe(2)
      expect(nativeSessionControl.disposeCalls).toBe(2)
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)

  it('disposes a native session created after its pending authority was revoked', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-cold-native-disposal-'))
    try {
      const created = deferred()
      const release = deferred()
      nativeSessionControl.created = created.resolve
      nativeSessionControl.release = release.promise

      const harness = createPiCodingAgentHarness({
        tools: [],
        cwd,
        sessionRoot: cwd,
        pi: {
          createCredentialStore: () => new InMemoryCredentialStore(),
        },
      })
      const sessionCtx = { workspaceId: 'workspace-a' }
      const { id } = await harness.sessions.create(sessionCtx)
      const opening = harness.getPiSessionAdapter!(
        { sessionId: id, content: '', ctx: sessionCtx },
        runContext(cwd),
      )

      await created.promise
      const deletion = harness.sessions.delete(sessionCtx, id)
      release.resolve()

      await expect(opening).rejects.toMatchObject({
        code: CREDENTIAL_ERROR_CODES.AUTHORITY_INVALID,
      })
      await deletion
      expect(nativeSessionControl.disposeCalls).toBe(1)
      expect(harness.hasPiSession!(id, sessionCtx)).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 20_000)
})
