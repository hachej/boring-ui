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
