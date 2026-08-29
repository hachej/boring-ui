import { describe, expect, it } from 'vitest'
import { AgentGatewayError } from '../../../shared/gateway/errors'
import { ErrorCode } from '../../../shared/error-codes'
import type { AgentHarnessBackend } from '../harnessBackend/types'

export interface HarnessBackendConformanceFixture {
  readonly backend: AgentHarnessBackend
}

export interface HarnessBackendConformanceOptions<Fixture extends HarnessBackendConformanceFixture> {
  readonly name: string
  readonly createBackend: () => Fixture | Promise<Fixture>
  /** A2 runs the bounded-buffer gap case only against the in-memory backend. */
  readonly replayGapCase?: boolean
  readonly assertRequestContextSnapshot?: (fixture: Fixture) => Promise<void>
}

const scope = (workspaceScopeId: string) => ({ workspaceScopeId, agentTypeId: 'alpha' })
const ctx = (requestId: string, authSubjectId = 'subject') => ({ requestId, authSubjectId })
const address = (workspaceScopeId: string, sessionId: string) => ({
  workspaceScopeId,
  ref: { agentTypeId: 'alpha', sessionId },
})

async function withBackend<Fixture extends HarnessBackendConformanceFixture>(
  options: HarnessBackendConformanceOptions<Fixture>,
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await options.createBackend()
  try {
    await run(fixture)
  } finally {
    await fixture.backend.close()
  }
}

/** Registers the private backend contract against any server-side implementation. */
export function harnessBackendConformance<Fixture extends HarnessBackendConformanceFixture>(
  options: HarnessBackendConformanceOptions<Fixture>,
): void {
  describe(`AgentHarnessBackend conformance (${options.name})`, () => {
    const replayGap = options.replayGapCase ? it : it.skip
    replayGap('case 1: reports a bounded replay gap and a snapshot at latestSeq', async () => {
      await withBackend(options, async ({ backend }) => {
        const created = await backend.createSession(scope('workspace-gap'), ctx('create-gap'))
        const target = address('workspace-gap', created.id)
        for (let index = 1; index <= 6; index += 1) {
          await backend.submitFollowUp(target, ctx(`followup-${index}`), {
            message: `followup ${index}`,
            clientNonce: `nonce-${index}`,
            clientSeq: index,
          })
        }

        const snapshot = await backend.readSnapshot(target, ctx('snapshot-gap'))
        const watched = await backend.watchEvents(target, ctx('watch-gap'), 0, () => {})
        expect(watched).toEqual({ type: 'replay_gap', minReplaySeq: 1, latestSeq: 6 })
        expect(snapshot.seq).toBe(6)
      })
    })

    it('case 3: preserves the coded service error for an unknown session', async () => {
      await withBackend(options, async ({ backend }) => {
        let observed: unknown
        try {
          await backend.readSnapshot(address('workspace-missing', 'missing'), ctx('read-missing'))
        } catch (error) {
          observed = error
        }
        expect(observed).toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND })
        expect(observed).not.toBeInstanceOf(AgentGatewayError)
      })
    })

    it('case 4: isolates the same session id across workspace scopes', async () => {
      await withBackend(options, async ({ backend }) => {
        const left = await backend.createSession(scope('workspace-left'), ctx('create-left', 'subject-left'))
        const right = await backend.createSession(scope('workspace-right'), ctx('create-right', 'subject-right'))
        expect(left.id).toBe(right.id)

        const leftAddress = address('workspace-left', left.id)
        const rightAddress = address('workspace-right', right.id)
        await backend.submitFollowUp(leftAddress, ctx('left-followup', 'subject-left'), {
          message: 'left only',
          clientNonce: 'left-only',
          clientSeq: 1,
        })

        await expect(backend.readSnapshot(leftAddress, ctx('read-left', 'subject-left')))
          .resolves.toMatchObject({ seq: 1, queue: { followUps: [{ displayText: 'left only' }] } })
        await expect(backend.readSnapshot(rightAddress, ctx('read-right', 'subject-right')))
          .resolves.toMatchObject({ seq: 0, queue: { followUps: [] } })
      })
    })

    it('case 5: rejects every operation after close', async () => {
      const fixture = await options.createBackend()
      const { backend } = fixture
      const created = await backend.createSession(scope('workspace-close'), ctx('create-close'))
      const target = address('workspace-close', created.id)
      await backend.close()

      const operations: Array<() => Promise<unknown>> = [
        () => backend.listSessions(scope('workspace-close'), ctx('closed-list')),
        () => backend.createSession(scope('workspace-close'), ctx('closed-create')),
        () => backend.readSnapshot(target, ctx('closed-read')),
        () => backend.watchEvents(target, ctx('closed-watch'), 0, () => {}),
        () => backend.submitPrompt(target, ctx('closed-prompt'), { message: 'prompt', clientNonce: 'prompt' }),
        () => backend.submitFollowUp(target, ctx('closed-followup'), { message: 'followup', clientNonce: 'followup', clientSeq: 1 }),
        () => backend.clearQueue(target, ctx('closed-clear'), {}),
        () => backend.interrupt(target, ctx('closed-interrupt'), {}),
        () => backend.stop(target, ctx('closed-stop'), {}),
        () => backend.renameSession(target, ctx('closed-rename'), 'renamed'),
        () => backend.deleteSession(target, ctx('closed-delete')),
        () => backend.readAttachment(target, ctx('closed-attachment'), 'message', 0),
      ]
      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({
          code: ErrorCode.enum.AGENT_BINDING_DISPOSED,
        })
      }
      await expect(backend.close()).resolves.toBeUndefined()
    })

    if (options.assertRequestContextSnapshot) {
      it('preserves the addressed request-context snapshot', async () => {
        await withBackend(options, options.assertRequestContextSnapshot!)
      })
    }
  })
}
