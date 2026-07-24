import { describe, expect, it } from 'vitest'
import {
  AGENT_GATEWAY_ERROR_CODES,
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGateway,
  type AgentSessionActivity,
  type AgentSessionRef,
  type AgentSessionSummary,
  type AuthorizedAgentScope,
} from '../../../shared/index'
import type { AgentGatewayEffect } from '../types'

/** G1 ships only the embedded bounded-replay contract. */
export type GatewayReplayConformanceLevel = 'B'
/** G1 ships only mutation-best-effort keyset pagination. */
export type GatewayPaginationConformanceLevel = 'keyset'

export interface GatewayConformanceFixture {
  readonly gateway: AgentGateway
  issueScope(input?: {
    readonly workspaceScopeId?: string
    readonly authSubjectId?: string
    readonly issuer?: 'primary' | 'foreign'
  }): AuthorizedAgentScope
  revoke(scope: AuthorizedAgentScope): void
  setActivity(ref: AgentSessionRef, activity: AgentSessionActivity): void
  moveSession(ref: AgentSessionRef, updatedAt: number): void
  queueAdmission(
    operation: AgentGatewayEffect,
    disposition: 'strong-reject' | 'retryable',
  ): void
}

export interface GatewayConformanceOptions {
  readonly createFixture: () => Promise<GatewayConformanceFixture>
  readonly replayLevel: GatewayReplayConformanceLevel
  readonly paginationLevel: GatewayPaginationConformanceLevel
}

async function expectCode(
  operation: Promise<unknown>,
  code: AgentGatewayErrorCode,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code })
}

async function createSession(
  fixture: GatewayConformanceFixture,
  scope: AuthorizedAgentScope,
  requestId: string,
  agentTypeId = 'alpha',
) {
  return fixture.gateway.createSession({
    scope,
    agentTypeId,
    requestId,
    title: requestId,
  })
}

/**
 * Registers the placement-independent Gateway semantic contract against any
 * implementation. Pagination capability is intentionally independent of the
 * replay durability level.
 */
export function gatewayConformance(options: GatewayConformanceOptions): void {
  describe(`AgentGateway conformance (replay ${options.replayLevel}, pagination ${options.paginationLevel})`, () => {
    it('requires issuer provenance and current membership on every operation', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const ref = await createSession(fixture, scope, 'create-valid')
      const foreign = fixture.issueScope({ issuer: 'foreign' })
      const spread = { ...scope }
      const jsonCopy = JSON.parse(JSON.stringify(scope)) as AuthorizedAgentScope
      const forged = {
        workspaceScopeId: scope.workspaceScopeId,
        authSubjectId: scope.authSubjectId,
      } as AuthorizedAgentScope

      fixture.revoke(scope)
      for (const [index, denied] of [foreign, spread, jsonCopy, forged, scope].entries()) {
        await expectCode(fixture.gateway.listAgents({ scope: denied }), 'AGENT_SCOPE_DENIED')
        await expectCode(fixture.gateway.listSessions({ scope: denied }), 'AGENT_SCOPE_DENIED')
        await expectCode(fixture.gateway.createSession({ scope: denied, agentTypeId: 'alpha', requestId: `denied-create-${index}` }), 'AGENT_SCOPE_DENIED')
        await expectCode(fixture.gateway.connectSession({ scope: denied, ref }), 'AGENT_SCOPE_DENIED')
        await expectCode(fixture.gateway.readSessionState({ scope: denied, ref }), 'AGENT_SCOPE_DENIED')
        await expectCode(fixture.gateway.renameSession({ scope: denied, ref, requestId: `denied-rename-${index}`, title: 'x' }), 'AGENT_SCOPE_DENIED')
        await expectCode(fixture.gateway.deleteSession({ scope: denied, ref, requestId: `denied-delete-${index}` }), 'AGENT_SCOPE_DENIED')
      }
    })

    it('re-verifies membership for every command on an open connection', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const ref = await createSession(fixture, scope, 'open-command-session')
      const connection = await fixture.gateway.connectSession({ scope, ref })
      fixture.revoke(scope)

      await expectCode(connection.send({ kind: 'prompt', requestId: 'p', clientNonce: 'n', content: 'hello' }), 'AGENT_SCOPE_DENIED')
      await expectCode(connection.interrupt({ requestId: 'i' }), 'AGENT_SCOPE_DENIED')
      await expectCode(connection.stop({ requestId: 's' }), 'AGENT_SCOPE_DENIED')
      await expectCode(connection.clearQueue({ requestId: 'q' }), 'AGENT_SCOPE_DENIED')
      await connection.close()
    })

    it('exposes the complete closed v0 stable error mapping', () => {
      expect(AGENT_GATEWAY_ERROR_CODES).toEqual([
        'AGENT_TYPE_UNKNOWN',
        'AGENT_SESSION_NOT_FOUND',
        'AGENT_SCOPE_DENIED',
        'AGENT_SESSION_REPLAY_GAP',
        'AGENT_SESSION_CURSOR_AHEAD',
        'AGENT_SESSION_CURSOR_EXPIRED',
        'AGENT_SESSION_CURSOR_INVALID',
        'AGENT_REQUEST_CONFLICT',
        'AGENT_REQUEST_OUTCOME_UNKNOWN',
        'AGENT_COMMAND_INVALID_STATE',
        'AGENT_SESSION_RUNTIME_SCOPE_MISMATCH',
        'AGENT_SHARED_ENVIRONMENT_UNAVAILABLE',
        'AGENT_GATEWAY_CLOSED',
      ])
      expect(new AgentGatewayError(AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN, 'unknown').toJSON()).toEqual({
        code: AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN,
        message: 'unknown',
      })
    })

    it('applies admission before mutation with strong denial for every effect', async () => {
      const cases: readonly {
        readonly effect: AgentGatewayEffect
        readonly run: (fixture: GatewayConformanceFixture, scope: AuthorizedAgentScope, requestId: string) => Promise<void>
      }[] = [
        {
          effect: 'session.create',
          run: async (fixture, scope, requestId) => {
            await expectCode(fixture.gateway.createSession({ scope, agentTypeId: 'alpha', requestId, title: 'denied' }), 'AGENT_SCOPE_DENIED')
            expect(await fixture.gateway.listSessions({ scope })).toEqual({ sessions: [] })
          },
        },
        {
          effect: 'session.rename',
          run: async (fixture, scope, requestId) => {
            const ref = await createSession(fixture, scope, `${requestId}-session`)
            await expectCode(fixture.gateway.renameSession({ scope, ref, requestId, title: 'mutated' }), 'AGENT_SCOPE_DENIED')
            expect((await fixture.gateway.readSessionState({ scope, ref })).summary.title).toBe(`${requestId}-session`)
          },
        },
        {
          effect: 'session.delete',
          run: async (fixture, scope, requestId) => {
            const ref = await createSession(fixture, scope, `${requestId}-session`)
            await expectCode(fixture.gateway.deleteSession({ scope, ref, requestId }), 'AGENT_SCOPE_DENIED')
            await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({ ref })
          },
        },
        {
          effect: 'session.prompt',
          run: async (fixture, scope, requestId) => {
            const ref = await createSession(fixture, scope, `${requestId}-session`)
            const connection = await fixture.gateway.connectSession({ scope, ref })
            await expectCode(connection.send({ kind: 'prompt', requestId, clientNonce: requestId, content: 'prompt' }), 'AGENT_SCOPE_DENIED')
            const state = await fixture.gateway.readSessionState({ scope, ref })
            expect(state.summary.status).toBe('idle')
            expect(state.state.messages).toEqual([])
            await connection.close()
          },
        },
        {
          effect: 'session.followup',
          run: async (fixture, scope, requestId) => {
            const ref = await createSession(fixture, scope, `${requestId}-session`)
            const connection = await fixture.gateway.connectSession({ scope, ref })
            fixture.setActivity(ref, 'running')
            await expectCode(connection.send({ kind: 'followup', requestId, clientNonce: requestId, clientSeq: 1, content: 'followup' }), 'AGENT_SCOPE_DENIED')
            const state = await fixture.gateway.readSessionState({ scope, ref })
            expect(state.summary.status).toBe('running')
            expect(state.state.queue.followUps).toEqual([])
            await connection.close()
          },
        },
        {
          effect: 'session.interrupt',
          run: async (fixture, scope, requestId) => {
            const ref = await createSession(fixture, scope, `${requestId}-session`)
            const connection = await fixture.gateway.connectSession({ scope, ref })
            fixture.setActivity(ref, 'running')
            await expectCode(connection.interrupt({ requestId }), 'AGENT_SCOPE_DENIED')
            expect((await fixture.gateway.readSessionState({ scope, ref })).summary.status).toBe('running')
            await connection.close()
          },
        },
        {
          effect: 'session.stop',
          run: async (fixture, scope, requestId) => {
            const ref = await createSession(fixture, scope, `${requestId}-session`)
            const connection = await fixture.gateway.connectSession({ scope, ref })
            fixture.setActivity(ref, 'running')
            await connection.send({ kind: 'followup', requestId: `${requestId}-queued`, clientNonce: `${requestId}-queued`, clientSeq: 1, content: 'queued' })
            await expectCode(connection.stop({ requestId }), 'AGENT_SCOPE_DENIED')
            const state = await fixture.gateway.readSessionState({ scope, ref })
            expect(state.summary.status).toBe('running')
            expect(state.state.queue.followUps).toHaveLength(1)
            await connection.close()
          },
        },
        {
          effect: 'session.queue.clear',
          run: async (fixture, scope, requestId) => {
            const ref = await createSession(fixture, scope, `${requestId}-session`)
            const connection = await fixture.gateway.connectSession({ scope, ref })
            fixture.setActivity(ref, 'running')
            await connection.send({ kind: 'followup', requestId: `${requestId}-queued`, clientNonce: `${requestId}-queued`, clientSeq: 1, content: 'queued' })
            await expectCode(connection.clearQueue({ requestId }), 'AGENT_SCOPE_DENIED')
            const state = await fixture.gateway.readSessionState({ scope, ref })
            expect(state.summary.status).toBe('running')
            expect(state.state.queue.followUps).toHaveLength(1)
            await connection.close()
          },
        },
      ]

      for (const [index, testCase] of cases.entries()) {
        const fixture = await options.createFixture()
        const scope = fixture.issueScope()
        const requestId = `strong-reject-${index}`
        fixture.queueAdmission(testCase.effect, 'strong-reject')
        await testCase.run(fixture, scope, requestId)
      }
    })

    it('applies admission before mutation with retryable retry and digest conflict', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()

      fixture.queueAdmission('session.create', 'strong-reject')
      await expectCode(fixture.gateway.createSession({
        scope,
        agentTypeId: 'alpha',
        requestId: 'strong-reject',
        title: 'denied',
      }), 'AGENT_SCOPE_DENIED')
      await expectCode(fixture.gateway.createSession({
        scope,
        agentTypeId: 'alpha',
        requestId: 'strong-reject',
        title: 'denied',
      }), 'AGENT_SCOPE_DENIED')
      await expectCode(fixture.gateway.createSession({
        scope,
        agentTypeId: 'alpha',
        requestId: 'strong-reject',
        title: 'conflicting digest',
      }), 'AGENT_REQUEST_CONFLICT')

      fixture.queueAdmission('session.create', 'retryable')
      await expectCode(fixture.gateway.createSession({
        scope,
        agentTypeId: 'alpha',
        requestId: 'retryable',
      }), 'AGENT_GATEWAY_CLOSED')
      await expect(fixture.gateway.listSessions({ scope })).resolves.toEqual({ sessions: [] })
      await expect(fixture.gateway.createSession({
        scope,
        agentTypeId: 'alpha',
        requestId: 'retryable',
      })).resolves.toMatchObject({ agentTypeId: 'alpha' })
    })

    it('fails unknown agents and hidden cross-scope sessions with stable errors', async () => {
      const fixture = await options.createFixture()
      const scopeA = fixture.issueScope({ workspaceScopeId: 'workspace-a' })
      const scopeB = fixture.issueScope({ workspaceScopeId: 'workspace-b' })
      const ref = await createSession(fixture, scopeA, 'scope-a-session')

      await expectCode(createSession(fixture, scopeA, 'unknown-agent', 'missing'), 'AGENT_TYPE_UNKNOWN')
      await expectCode(fixture.gateway.readSessionState({ scope: scopeB, ref }), 'AGENT_SESSION_NOT_FOUND')
      await expectCode(fixture.gateway.readSessionState({ scope: scopeA, ref: { agentTypeId: ref.agentTypeId, sessionId: 'missing' } }), 'AGENT_SESSION_NOT_FOUND')
    })

    it('keys idempotency by scope, effect, full target, request id, and digest', async () => {
      const fixture = await options.createFixture()
      const scopeA = fixture.issueScope({ workspaceScopeId: 'workspace-a' })
      const scopeB = fixture.issueScope({ workspaceScopeId: 'workspace-b' })
      const [first, concurrentRetry] = await Promise.all([
        createSession(fixture, scopeA, 'same-id'),
        createSession(fixture, scopeA, 'same-id'),
      ])
      expect(concurrentRetry).toEqual(first)
      expect(await createSession(fixture, scopeA, 'same-id')).toEqual(first)
      await expectCode(
        fixture.gateway.createSession({ scope: scopeA, agentTypeId: 'alpha', requestId: 'same-id', title: 'different' }),
        'AGENT_REQUEST_CONFLICT',
      )

      const otherScope = await createSession(fixture, scopeB, 'same-id')
      const otherAgent = await createSession(fixture, scopeA, 'same-id', 'beta')
      expect(otherScope).not.toEqual(first)
      expect(otherAgent.agentTypeId).toBe('beta')

      const second = await createSession(fixture, scopeA, 'second-target')
      const renamedFirst = await fixture.gateway.renameSession({ scope: scopeA, ref: first, requestId: 'shared-target-id', title: 'one' })
      expect(await fixture.gateway.renameSession({ scope: scopeA, ref: first, requestId: 'shared-target-id', title: 'one' })).toEqual(renamedFirst)
      await expectCode(
        fixture.gateway.renameSession({ scope: scopeA, ref: first, requestId: 'shared-target-id', title: 'changed' }),
        'AGENT_REQUEST_CONFLICT',
      )
      await expect(fixture.gateway.renameSession({ scope: scopeA, ref: second, requestId: 'shared-target-id', title: 'two' })).resolves.toMatchObject({ title: 'two' })

      await fixture.gateway.deleteSession({ scope: scopeA, ref: second, requestId: 'delete-id' })
      await expect(fixture.gateway.deleteSession({ scope: scopeA, ref: second, requestId: 'delete-id' })).resolves.toBeUndefined()
    })

    it('enforces command states, queue controls, typed receipts, and command idempotency', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const ref = await createSession(fixture, scope, 'commands')
      const connection = await fixture.gateway.connectSession({ scope, ref })

      expect(await connection.interrupt({ requestId: 'idle-interrupt' })).toMatchObject({ accepted: true })
      expect((await fixture.gateway.readSessionState({ scope, ref })).summary.status).toBe('idle')
      const prompt = await connection.send({ kind: 'prompt', requestId: 'prompt', clientNonce: 'nonce-p', content: 'start' })
      expect(prompt).toMatchObject({ accepted: true, disposition: 'prompt', clientNonce: 'nonce-p' })
      expect(await connection.send({ kind: 'prompt', requestId: 'prompt', clientNonce: 'nonce-p', content: 'start' })).toMatchObject({ duplicate: true })
      await expectCode(
        connection.send({ kind: 'prompt', requestId: 'prompt', clientNonce: 'nonce-p', content: 'different' }),
        'AGENT_REQUEST_CONFLICT',
      )
      await expectCode(
        connection.send({ kind: 'prompt', requestId: 'second-prompt', clientNonce: 'nonce-p2', content: 'invalid while running' }),
        'AGENT_COMMAND_INVALID_STATE',
      )

      const followup = await connection.send({ kind: 'followup', requestId: 'followup', clientNonce: 'nonce-f', clientSeq: 4, content: 'next' })
      expect(followup).toMatchObject({ accepted: true, disposition: 'followup', clientNonce: 'nonce-f', clientSeq: 4 })
      expect(await connection.interrupt({ requestId: 'interrupt' })).toMatchObject({ accepted: true })
      expect(await connection.interrupt({ requestId: 'interrupt' })).toMatchObject({ accepted: true })
      expect(await connection.interrupt({ requestId: 'interrupt-aborting' })).toMatchObject({ accepted: true })
      await expectCode(
        connection.send({ kind: 'prompt', requestId: 'aborting-prompt', clientNonce: 'nonce-a', content: 'invalid while aborting' }),
        'AGENT_COMMAND_INVALID_STATE',
      )
      await expect(connection.send({ kind: 'followup', requestId: 'aborting-followup', clientNonce: 'nonce-af', clientSeq: 5, content: 'queued while aborting' })).resolves.toMatchObject({ disposition: 'followup' })
      expect(await connection.clearQueue({ requestId: 'clear' })).toMatchObject({ accepted: true, cleared: 2 })
      expect(await connection.clearQueue({ requestId: 'clear' })).toMatchObject({ accepted: true, cleared: 2 })

      fixture.setActivity(ref, 'error')
      await expect(connection.send({ kind: 'prompt', requestId: 'error-recovery', clientNonce: 'nonce-e', content: 'retry' })).resolves.toMatchObject({ disposition: 'prompt' })
      const stop = await connection.stop({ requestId: 'stop' })
      expect(stop).toMatchObject({ accepted: true, stopped: true, clearedQueue: [] })
      expect(await connection.stop({ requestId: 'stop' })).toEqual(stop)
      await connection.close()
    })

    it('covers the complete command-state table and queue selector semantics', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const states: readonly AgentSessionActivity[] = ['idle', 'running', 'aborting', 'error']

      for (const [index, state] of states.entries()) {
        const ref = await createSession(fixture, scope, `state-${state}`)
        const connection = await fixture.gateway.connectSession({ scope, ref })
        fixture.setActivity(ref, state)
        const prompt = connection.send({
          kind: 'prompt',
          requestId: `state-prompt-${index}`,
          clientNonce: `state-prompt-${index}`,
          content: 'prompt',
        })
        if (state === 'idle' || state === 'error') {
          await expect(prompt).resolves.toMatchObject({ disposition: 'prompt' })
        } else {
          await expectCode(prompt, 'AGENT_COMMAND_INVALID_STATE')
        }

        fixture.setActivity(ref, state)
        const followupInput = {
          kind: 'followup' as const,
          requestId: `state-followup-${index}`,
          clientNonce: `state-followup-${index}`,
          clientSeq: index,
          content: 'follow-up',
        }
        await expect(connection.send(followupInput)).resolves.toMatchObject({ disposition: 'followup' })
        await expect(connection.send(followupInput)).resolves.toMatchObject({ duplicate: true })
        await expectCode(connection.send({ ...followupInput, content: 'conflict' }), 'AGENT_REQUEST_CONFLICT')
        await expectCode(connection.clearQueue({
          requestId: `selector-mismatch-${index}`,
          clientNonce: followupInput.clientNonce,
          clientSeq: index + 100,
        }), 'AGENT_REQUEST_CONFLICT')

        const beforeClear = (await fixture.gateway.readSessionState({ scope, ref })).summary.status
        await expect(connection.clearQueue({ requestId: `state-clear-${index}` })).resolves.toMatchObject({ accepted: true })
        expect((await fixture.gateway.readSessionState({ scope, ref })).summary.status).toBe(beforeClear)

        fixture.setActivity(ref, state)
        await expect(connection.interrupt({ requestId: `state-interrupt-${index}` })).resolves.toMatchObject({ accepted: true })
        const afterInterrupt = (await fixture.gateway.readSessionState({ scope, ref })).summary.status
        expect(afterInterrupt).toBe(state === 'running' ? 'aborting' : state)

        fixture.setActivity(ref, state)
        await expect(connection.stop({ requestId: `state-stop-${index}` })).resolves.toMatchObject({
          accepted: true,
          stopped: state === 'running' || state === 'aborting',
        })
        expect((await fixture.gateway.readSessionState({ scope, ref })).summary.status).toBe('idle')
        await connection.close()
      }
    })

    it('treats close as unsubscribe and keeps the session turn alive', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const ref = await createSession(fixture, scope, 'close-unsubscribe')
      const first = await fixture.gateway.connectSession({ scope, ref })
      const pendingEvent = first.events[Symbol.asyncIterator]().next()
      await first.close()
      await expect(pendingEvent).resolves.toMatchObject({ done: true })

      const second = await fixture.gateway.connectSession({ scope, ref })
      await second.send({ kind: 'prompt', requestId: 'run', clientNonce: 'run', content: 'continue' })
      await second.close()
      const snapshot = await fixture.gateway.readSessionState({ scope, ref })
      expect(snapshot.summary.status).toBe('running')
      const third = await fixture.gateway.connectSession({ scope, ref })
      await expect(third.interrupt({ requestId: 'interrupt-after-close' })).resolves.toMatchObject({ accepted: true })
      await third.close()
    })

    it('provides monotonic single-sequence envelopes and consistent snapshots', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const ref = await createSession(fixture, scope, 'sequence')
      const connection = await fixture.gateway.connectSession({ scope, ref, cursor: 0 })
      await connection.send({ kind: 'prompt', requestId: 'event-1', clientNonce: 'event-1', content: 'one' })
      await connection.send({ kind: 'followup', requestId: 'event-2', clientNonce: 'event-2', clientSeq: 1, content: 'two' })
      const iterator = connection.events[Symbol.asyncIterator]()
      const first = await iterator.next()
      const second = await iterator.next()
      expect(first.done).toBe(false)
      expect(second.done).toBe(false)
      if (!first.done && !second.done) {
        expect(first.value.seq).toBe(first.value.event.seq)
        expect(second.value.seq).toBe(second.value.event.seq)
        expect(second.value.seq).toBeGreaterThan(first.value.seq)
      }
      const snapshot = await fixture.gateway.readSessionState({ scope, ref })
      expect(snapshot.seq).toBe(snapshot.state.seq)
      expect(snapshot.ref).toEqual(ref)
      await connection.close()
    })

    it('recovers a bounded replay gap through snapshot then reconnect', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const ref = await createSession(fixture, scope, 'replay')
      const connection = await fixture.gateway.connectSession({ scope, ref })
      for (let index = 0; index < 6; index += 1) {
        await connection.send({ kind: 'followup', requestId: `replay-${index}`, clientNonce: `replay-${index}`, clientSeq: index, content: 'event' })
      }
      await connection.close()

      await expectCode(fixture.gateway.connectSession({ scope, ref, cursor: 0 }), 'AGENT_SESSION_REPLAY_GAP')
      const snapshot = await fixture.gateway.readSessionState({ scope, ref })
      await expect(fixture.gateway.connectSession({ scope, ref, cursor: snapshot.seq })).resolves.toMatchObject({ ref })
      await expectCode(fixture.gateway.connectSession({ scope, ref, cursor: snapshot.seq + 1 }), 'AGENT_SESSION_CURSOR_AHEAD')
    })

    it('orders keyset pages and denies tampered or rebound cursors', async () => {
      const fixture = await options.createFixture()
      const scopeA = fixture.issueScope({ workspaceScopeId: 'workspace-a' })
      const scopeB = fixture.issueScope({ workspaceScopeId: 'workspace-b' })
      const alphaA = await createSession(fixture, scopeA, 'a', 'alpha')
      const beta = await createSession(fixture, scopeA, 'b', 'beta')
      const alphaC = await createSession(fixture, scopeA, 'c', 'alpha')
      fixture.moveSession(alphaA, 5_000)
      fixture.moveSession(beta, 5_000)
      fixture.moveSession(alphaC, 5_000)
      const page = await fixture.gateway.listSessions({ scope: scopeA, limit: 1 })
      expect(page.sessions).toHaveLength(1)
      expect(page.nextCursor).toBeDefined()
      const cursor = page.nextCursor!

      await expectCode(fixture.gateway.listSessions({ scope: scopeA, cursor: `${cursor}tampered`, limit: 1 }), 'AGENT_SESSION_CURSOR_INVALID')
      await expectCode(fixture.gateway.listSessions({ scope: scopeB, cursor, limit: 1 }), 'AGENT_SESSION_CURSOR_INVALID')
      await expectCode(fixture.gateway.listSessions({ scope: scopeA, cursor, limit: 2 }), 'AGENT_SESSION_CURSOR_INVALID')
      await expectCode(fixture.gateway.listSessions({ scope: scopeA, cursor, agentTypeId: 'alpha', limit: 1 }), 'AGENT_SESSION_CURSOR_INVALID')

      const all = await fixture.gateway.listSessions({ scope: scopeA, limit: 20 })
      expect(all.sessions).toEqual([...all.sessions].sort((left, right) =>
        right.updatedAt - left.updatedAt
        || left.ref.agentTypeId.localeCompare(right.ref.agentTypeId)
        || left.ref.sessionId.localeCompare(right.ref.sessionId),
      ))
      expect(all.sessions.map((session) => session.ref)).toEqual([alphaA, alphaC, beta])
    })

    it('documents keyset mutation behavior: moved rows may shift and deleted rows disappear', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const first = await createSession(fixture, scope, 'mutation-a')
      const moved = await createSession(fixture, scope, 'mutation-b')
      const deleted = await createSession(fixture, scope, 'mutation-c')
      const page = await fixture.gateway.listSessions({ scope, limit: 1 })
      expect(page.nextCursor).toBeDefined()

      fixture.moveSession(moved, Date.now() + 100_000)
      await fixture.gateway.deleteSession({ scope, ref: deleted, requestId: 'mutation-delete' })
      const continuation = await fixture.gateway.listSessions({ scope, limit: 1, cursor: page.nextCursor })
      expect(continuation.sessions).not.toContainEqual(expect.objectContaining({ ref: deleted }))
      expect(continuation.sessions).not.toContainEqual(expect.objectContaining({ ref: moved }))
      expect([first, moved, deleted]).toHaveLength(3)
    })

    it('allows a still-valid cursor to yield an empty page after mutation', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      const tail = await createSession(fixture, scope, 'empty-a')
      await createSession(fixture, scope, 'empty-b')
      const page = await fixture.gateway.listSessions({ scope, limit: 1 })
      expect(page.nextCursor).toBeDefined()
      await fixture.gateway.deleteSession({ scope, ref: tail, requestId: 'empty-delete' })
      await expect(fixture.gateway.listSessions({ scope, limit: 1, cursor: page.nextCursor })).resolves.toEqual({ sessions: [] })
    })

    it('closes the facade idempotently and rejects subsequent operations', async () => {
      const fixture = await options.createFixture()
      const scope = fixture.issueScope()
      await fixture.gateway.close()
      await fixture.gateway.close()
      await expectCode(fixture.gateway.listAgents({ scope }), 'AGENT_GATEWAY_CLOSED')
    })

    it.skip('Level D restart preserves sequence continuity [owner: streaming lane]', () => {})
    it.skip('Level D durable request ledger replays receipts and create tombstones across restart [owner: streaming lane]', () => {})
    it.skip('Level D durable admission/effect crash matrix resolves acknowledged and outcome-unknown work [owner: streaming lane]', () => {})
    it.skip('Level D durable activity index reconciles non-quiescent states at startup [owner: streaming lane]', () => {})
    it.skip('Level D/v2 immutable snapshot pagination is mutation-stable and expires [owner: #905 pool cursor]', () => {})
    it.skip('v2 remote wire validates JSON event leaves, paths, depth, and size [owner: #905 remote wire]', () => {})
  })
}
