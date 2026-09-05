import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { SqliteAgentRequestLedger } from '../sqliteRequestLedger'
import { InMemoryHarnessBackend } from '../testing/inMemoryHarnessBackend'
import type { AgentGatewayEffect } from '../types'
import { createEmbeddedGatewayFixture } from './embeddedGatewayFixture'

const denied = { code: AgentGatewayErrorCode.AGENT_SCOPE_DENIED }

async function createSession() {
  const fixture = await createEmbeddedGatewayFixture()
  const scope = fixture.issueScope()
  const ref = await fixture.gateway.createSession({
    scope,
    agentTypeId: 'alpha',
    requestId: 'create-session',
    title: 'Original title',
  })
  return { fixture, scope, ref }
}

describe('Embedded Agent Gateway strong effect admission', () => {
  it('records a strong create rejection before mutation and replays it without readmission', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    fixture.queueAdmission('session.create', 'strong-reject')

    const input = { scope, agentTypeId: 'alpha', requestId: 'denied-create' }
    await expect(fixture.gateway.createSession(input)).rejects.toMatchObject(denied)
    await expect(fixture.gateway.createSession(input)).rejects.toMatchObject(denied)
    await expect(fixture.gateway.listSessions({ scope, agentTypeId: 'alpha' })).resolves.toEqual({ sessions: [] })
  })

  it('retries a denied admission with the same request without duplicating the effect', async () => {
    const fixture = await createEmbeddedGatewayFixture()
    const scope = fixture.issueScope()
    fixture.queueAdmission('session.create', 'retryable')
    const input = { scope, agentTypeId: 'alpha', requestId: 'retry-create' }

    await expect(fixture.gateway.createSession(input)).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
    })
    await expect(fixture.gateway.listSessions({ scope, agentTypeId: 'alpha' })).resolves.toMatchObject({ sessions: [] })
    await expect(fixture.gateway.createSession({ ...input, title: 'changed payload' })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })

    const admission = fixture.blockAdmission('session.create')
    const retry = fixture.gateway.createSession(input)
    try {
      await Promise.race([admission.entered, retry.then(() => undefined)])
      await expect(fixture.gateway.createSession(input)).rejects.toMatchObject({
        code: AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS,
      })
      await expect(fixture.gateway.listSessions({ scope })).resolves.toEqual({ sessions: [] })
    } finally {
      admission.release()
    }
    const ref = await retry
    await expect(fixture.gateway.createSession(input)).resolves.toEqual(ref)
    await expect(fixture.gateway.listSessions({ scope })).resolves.toMatchObject({ sessions: [{ ref }] })
  })

  it('does not let a duplicate guarded prompt bypass an active admission owner', async () => {
    const { fixture, scope, ref } = await createSession()
    const connection = await fixture.gateway.connectSession({ scope, ref })
    const admission = fixture.blockAdmission('session.prompt')
    const command = { kind: 'prompt' as const, requestId: 'one-prompt', clientNonce: 'one-prompt', content: 'hello' }
    const pending = connection.send(command)
    try {
      await admission.entered
      await expect(connection.send(command)).rejects.toMatchObject({
        code: AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS,
      })
      expect(fixture.modelLoopStarts(ref)).toBe(0)
    } finally {
      admission.release()
      await pending
      await connection.close()
    }
    expect(fixture.modelLoopStarts(ref)).toBe(1)
  })

  it.each([false, true])('preserves pre-effect prompt retries with requireIdle=%s', async (requireIdle) => {
    const { fixture, scope, ref } = await createSession()
    const connection = await fixture.gateway.connectSession({ scope, ref })
    const command = {
      kind: 'prompt' as const,
      requestId: 'retry-prompt',
      clientNonce: 'retry-prompt',
      content: 'hello',
      ...(requireIdle ? { requireIdle: true as const } : {}),
    }
    try {
      fixture.setActivity(ref, 'running')
      await expect(connection.send(command)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
      await expect(connection.send({ ...command, content: 'changed' })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT })
      expect(fixture.modelLoopStarts(ref)).toBe(0)
      fixture.setActivity(ref, 'error')
      if (requireIdle) {
        await expect(connection.send(command)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
        expect(fixture.modelLoopStarts(ref)).toBe(0)
        fixture.setActivity(ref, 'idle')
      }
      const receipt = await connection.send(command)
      await expect(connection.send(command)).resolves.toMatchObject({ ...receipt, duplicate: true })
      expect(fixture.modelLoopStarts(ref)).toBe(1)
    } finally {
      await connection.close()
    }
  })

  it('does not reclaim a pending prompt after its admission guard throws', async () => {
    const { fixture, scope, ref } = await createSession()
    const connection = await fixture.gateway.connectSession({ scope, ref })
    const failure = new Error('snapshot unavailable')
    const snapshot = vi.spyOn(InMemoryHarnessBackend.prototype, 'readSnapshot').mockRejectedValueOnce(failure)
    const command = { kind: 'prompt' as const, requestId: 'uncertain-prompt', clientNonce: 'uncertain-prompt', content: 'hello' }
    try {
      await expect(connection.send(command)).rejects.toBe(failure)
      await expect(connection.send(command)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS })
      expect(fixture.modelLoopStarts(ref)).toBe(0)
    } finally {
      snapshot.mockRestore()
      await connection.close()
    }
  })

  it('can retry an explicitly denied admission after reopening the SQLite ledger', async () => {
    const path = join(tmpdir(), `gateway-retry-${randomUUID()}.sqlite`)
    const ledger = new SqliteAgentRequestLedger(path)
    const first = await createEmbeddedGatewayFixture({ requestLedger: ledger })
    first.queueAdmission('session.create', 'retryable')
    const input = { agentTypeId: 'alpha', requestId: 'durable-retry' }
    try {
      await expect(first.gateway.createSession({ ...input, scope: first.issueScope() })).rejects.toMatchObject({
        code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
      })
    } finally {
      await first.gateway.close()
      ledger.close()
    }

    const reopened = new SqliteAgentRequestLedger(path)
    const next = await createEmbeddedGatewayFixture({ requestLedger: reopened })
    const scope = next.issueScope()
    try {
      const ref = await next.gateway.createSession({ ...input, scope })
      await expect(next.gateway.createSession({ ...input, scope })).resolves.toEqual(ref)
      await expect(next.gateway.listSessions({ scope })).resolves.toMatchObject({ sessions: [{ ref }] })
    } finally {
      await next.gateway.close()
      reopened.close()
    }
  })

  it('admits rename, archive, and delete before any session mutation', async () => {
    const { fixture, scope, ref } = await createSession()
    fixture.queueAdmission('session.rename', 'strong-reject')
    await expect(fixture.gateway.renameSession({
      scope,
      ref,
      requestId: 'denied-rename',
      title: 'Forbidden title',
    })).rejects.toMatchObject(denied)
    await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({
      summary: { title: 'Original title' },
    })

    fixture.queueAdmission('session.archive', 'strong-reject')
    await expect(fixture.gateway.setSessionArchived({
      scope,
      ref,
      requestId: 'denied-archive',
      archived: true,
    })).rejects.toMatchObject(denied)
    await expect(fixture.gateway.listSessions({ scope, archived: 'active' })).resolves.toMatchObject({
      sessions: [expect.objectContaining({ ref })],
    })

    fixture.queueAdmission('session.delete', 'strong-reject')
    await expect(fixture.gateway.deleteSession({
      scope,
      ref,
      requestId: 'denied-delete',
    })).rejects.toMatchObject(denied)
    await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({ ref })
  })

  it('joins selected-plugin cleanup once after successful session deletion', async () => {
    const { fixture, scope, ref } = await createSession()
    const calls: unknown[] = []
    fixture.setSessionDeleteHook(async (input) => { calls.push(input) })

    await fixture.gateway.deleteSession({ scope, ref, requestId: 'delete-with-cleanup' })

    expect(calls).toEqual([{
      workspaceScopeId: 'workspace',
      agentTypeId: 'alpha',
      sessionId: ref.sessionId,
    }])
  })

  it('does not run selected-plugin cleanup when deletion is denied', async () => {
    const { fixture, scope, ref } = await createSession()
    const calls: unknown[] = []
    fixture.setSessionDeleteHook(async (input) => { calls.push(input) })
    fixture.queueAdmission('session.delete', 'strong-reject')

    await expect(fixture.gateway.deleteSession({
      scope,
      ref,
      requestId: 'denied-delete-cleanup',
    })).rejects.toMatchObject(denied)

    expect(calls).toEqual([])
  })

  it('keeps selected-plugin cleanup failure visible instead of returning success', async () => {
    const { fixture, scope, ref } = await createSession()
    fixture.setSessionDeleteHook(async () => { throw new Error('cleanup failed') })

    await expect(fixture.gateway.deleteSession({
      scope,
      ref,
      requestId: 'failed-delete-cleanup',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN })
  })

  it('executes archive through inventory with replay and digest-conflict semantics', async () => {
    const { fixture, scope, ref } = await createSession()
    const input = { scope, ref, requestId: 'archive-once', archived: true }
    const first = await fixture.gateway.setSessionArchived(input)
    expect(first.archived).toBe(true)
    await expect(fixture.gateway.setSessionArchived(input)).resolves.toEqual(first)
    await expect(fixture.gateway.setSessionArchived({ ...input, archived: false })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
    await expect(fixture.gateway.listSessions({ scope, archived: 'archived' })).resolves.toMatchObject({
      sessions: [expect.objectContaining({ ref, archived: true })],
    })
    await expect(fixture.gateway.listSessions({ scope, archived: 'active' })).resolves.toEqual({ sessions: [] })
  })

  it('rejects and replays an unsupported archive capability without mutation', async () => {
    const { fixture, scope, ref } = await createSession()
    fixture.disableArchiveCapability()
    const input = { scope, ref, requestId: 'archive-unsupported', archived: true }

    await expect(fixture.gateway.setSessionArchived(input)).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
    })
    await expect(fixture.gateway.setSessionArchived(input)).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
    })
    await expect(fixture.gateway.setSessionArchived({ ...input, archived: false })).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
    })
    await expect(fixture.gateway.listSessions({ scope, archived: 'active' })).resolves.toMatchObject({
      sessions: [expect.objectContaining({ ref })],
    })
  })

  it('keeps active runtime activity running when Resume is admitted as a no-op', async () => {
    const { fixture, scope, ref } = await createSession()
    const connection = await fixture.gateway.connectSession({ scope, ref })
    fixture.setActivity(ref, 'running')

    try {
      await expect(connection.interrupt({ requestId: 'active-resume', queueAction: 'resume' })).resolves.toMatchObject({
        accepted: true,
      })
      await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({
        summary: { status: 'running' },
        state: { status: 'streaming' },
      })
    } finally {
      await connection.close()
    }
  })

  it('applies strong admission to prompt, follow-up, interrupt, stop, and queue clear', async () => {
    const { fixture, scope, ref } = await createSession()
    const connection = await fixture.gateway.connectSession({ scope, ref })
    const effects: Array<{
      effect: AgentGatewayEffect
      run: () => Promise<unknown>
    }> = [
      {
        effect: 'session.prompt',
        run: () => connection.send({
          kind: 'prompt',
          requestId: 'denied-prompt',
          clientNonce: 'prompt-nonce',
          content: 'prompt',
        }),
      },
      {
        effect: 'session.followup',
        run: () => connection.send({
          kind: 'followup',
          requestId: 'denied-followup',
          clientNonce: 'followup-nonce',
          clientSeq: 1,
          content: 'follow up',
        }),
      },
      {
        effect: 'session.interrupt',
        run: () => connection.interrupt({ requestId: 'denied-interrupt' }),
      },
      {
        effect: 'session.stop',
        run: () => connection.stop({ requestId: 'denied-stop' }),
      },
      {
        effect: 'session.queue.clear',
        run: () => connection.clearQueue({ requestId: 'denied-clear' }),
      },
    ]

    try {
      for (const entry of effects) {
        fixture.queueAdmission(entry.effect, 'strong-reject')
        await expect(entry.run()).rejects.toMatchObject(denied)
      }
      expect(fixture.modelLoopStarts(ref)).toBe(0)
      await expect(fixture.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({
        state: { status: 'idle', queue: { followUps: [] } },
      })
    } finally {
      await connection.close()
    }
  })
})
