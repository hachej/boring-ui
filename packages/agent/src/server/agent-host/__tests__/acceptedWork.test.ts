import { describe, expect, it, vi } from 'vitest'

import { AgentGatewayError, AgentGatewayErrorCode, type JsonValue } from '../../../shared/index'
import { InMemoryAgentRequestLedger } from '../requestLedger'
import type { AgentHostRuntime } from '../createAgentHost'
import type { AgentRequestKey } from '../types'
import {
  attachAcceptedWorkProvenance,
  createAcceptedToolEffectExecutor,
  readAcceptedWorkProvenance,
  type AcceptedWorkProvenance,
} from '../acceptedWork'

function parentKey(overrides: Partial<AgentRequestKey> = {}): AgentRequestKey {
  return {
    workspaceScopeId: 'workspace-a',
    authSubjectId: 'subject-a',
    operation: 'session.prompt',
    target: { kind: 'session', ref: { agentTypeId: 'worker', sessionId: 'session-a' } },
    requestId: 'parent-request',
    ...overrides,
  }
}

function provenance(overrides: Partial<AcceptedWorkProvenance> = {}): AcceptedWorkProvenance {
  return {
    parentKey: parentKey(),
    claim: { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' },
    ...overrides,
  }
}

function runtime() {
  const ledger = new InMemoryAgentRequestLedger()
  const admitted: AgentRequestKey[] = []
  const assertOpen = vi.fn()
  const value = {
    ledger,
    effectAdmission: {
      async admit({ key }: { key: AgentRequestKey }) {
        admitted.push(key)
        return { type: 'accepted' as const, admissionReceipt: `admitted:${key.requestId}` }
      },
    },
    assertOpen,
    startPreparedEffect<T>(_key: AgentRequestKey, effect: () => Promise<T>) { return effect() },
  } as unknown as AgentHostRuntime
  return { runtime: value, ledger, admitted, assertOpen }
}

function executor(host: AgentHostRuntime) {
  return createAcceptedToolEffectExecutor({
    runtime: host,
    workspaceScopeId: 'workspace-a',
    agentTypeId: 'worker',
    sessionId: 'session-a',
    allowInMemoryLedgerForTests: true,
  })
}

describe('accepted external tool effects', () => {
  it('requires a durable transactional ledger outside explicit tests', () => {
    const fixture = runtime()
    expect(() => createAcceptedToolEffectExecutor({
      runtime: fixture.runtime,
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
      sessionId: 'session-a',
    })).toThrow(expect.objectContaining({
      code: AgentGatewayErrorCode.AGENT_ACCEPTED_WORK_UNAVAILABLE,
    }))
  })

  it('derives one child request from the exact parent and replays completed receipts', async () => {
    const fixture = runtime()
    const execute = executor(fixture.runtime)
    const action = vi.fn(async () => ({ sandbox: 'lease-1234567890' } satisfies JsonValue))
    const input = {
      provenance: provenance(),
      toolCallId: 'tool-call-a',
      tool: 'sandbox',
      op: 'create',
      action,
    }

    await expect(execute(input)).resolves.toEqual({ sandbox: 'lease-1234567890' })
    await expect(execute(input)).resolves.toEqual({ sandbox: 'lease-1234567890' })

    expect(action).toHaveBeenCalledOnce()
    expect(fixture.admitted).toHaveLength(1)
    expect(fixture.admitted[0]).toMatchObject({
      workspaceScopeId: 'workspace-a',
      authSubjectId: 'subject-a',
      operation: 'session.tool.external-effect',
      target: { kind: 'session', ref: { agentTypeId: 'worker', sessionId: 'session-a' } },
      requestId: expect.stringMatching(/^tool:[a-f0-9]{64}$/),
    })
  })

  it('never reinvokes a model request after its outcome becomes unknown', async () => {
    const fixture = runtime()
    const execute = executor(fixture.runtime)
    const action = vi.fn(async () => { throw new Error('provider acknowledgement lost') })
    const input = {
      provenance: provenance(),
      toolCallId: 'tool-call-unknown',
      tool: 'sandbox',
      op: 'release',
      sandbox: 'lease-1234567890',
      action,
    }

    await expect(execute(input)).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
    })
    await expect(execute(input)).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
    })
    expect(action).toHaveBeenCalledOnce()
  })

  it('settles the known receipt when host drain starts after provider success', async () => {
    const fixture = runtime()
    const execute = executor(fixture.runtime)
    const action = vi.fn(async () => {
      fixture.assertOpen.mockImplementation(() => {
        throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, 'agent host is closing')
      })
      return { released: true } satisfies JsonValue
    })
    const input = {
      provenance: provenance(),
      toolCallId: 'tool-call-drain',
      tool: 'sandbox',
      op: 'release',
      sandbox: 'lease-1234567890',
      action,
    }

    await expect(execute(input)).resolves.toEqual({ released: true })
    fixture.assertOpen.mockReset()
    await expect(execute(input)).resolves.toEqual({ released: true })
    expect(action).toHaveBeenCalledOnce()
  })

  it('records proven pre-provider validation failures as rejected', async () => {
    const fixture = runtime()
    const execute = executor(fixture.runtime)
    const action = vi.fn(async () => ({ ok: true } satisfies JsonValue))
    const preflight = vi.fn(async () => {
      throw new AgentGatewayError(AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE, 'sandbox quota exceeded')
    })
    const input = {
      provenance: provenance(),
      toolCallId: 'tool-call-quota',
      tool: 'sandbox',
      op: 'create',
      preflight,
      action,
    }

    await expect(execute(input)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
    await expect(execute(input)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
    expect(preflight).toHaveBeenCalledOnce()
    expect(action).not.toHaveBeenCalled()
  })

  it('classifies only explicitly safe action failures as rejected', async () => {
    const fixture = runtime()
    const execute = executor(fixture.runtime)
    const providerNotCalled = Object.assign(new Error('reservation unavailable'), { safe: true })
    const action = vi.fn(async () => { throw providerNotCalled })
    const classifySafeActionFailure = vi.fn((error: unknown) => error === providerNotCalled
      ? {
          kind: 'gateway' as const,
          error: new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
            'sandbox reservation unavailable',
          ).toJSON(),
        }
      : undefined)
    const input = {
      provenance: provenance(),
      toolCallId: 'tool-call-safe-failure',
      tool: 'sandbox',
      op: 'create',
      classifySafeActionFailure,
      action,
    }

    await expect(execute(input)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
    await expect(execute(input)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
    expect(action).toHaveBeenCalledOnce()
    expect(classifySafeActionFailure).toHaveBeenCalledOnce()
  })

  it('marks settlement failure outcome-unknown and never reinvokes the action', async () => {
    const fixture = runtime()
    const execute = executor(fixture.runtime)
    vi.spyOn(fixture.ledger, 'complete').mockRejectedValue(new Error('ledger unavailable'))
    const action = vi.fn(async () => ({ sandbox: 'lease-1234567890' } satisfies JsonValue))
    const input = {
      provenance: provenance(),
      toolCallId: 'tool-call-settlement',
      tool: 'sandbox',
      op: 'create',
      action,
    }

    await expect(execute(input)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN })
    await expect(execute(input)).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN })
    expect(action).toHaveBeenCalledOnce()
  })

  it('fails closed on missing or mismatched accepted provenance before admission', async () => {
    const fixture = runtime()
    const execute = executor(fixture.runtime)
    const action = vi.fn(async () => ({ ok: true } satisfies JsonValue))
    const wrongSession = provenance({
      parentKey: parentKey({
        target: { kind: 'session', ref: { agentTypeId: 'worker', sessionId: 'other-session' } },
      }),
    })

    await expect(execute({
      provenance: wrongSession,
      toolCallId: 'tool-call-mismatch',
      tool: 'sandbox',
      op: 'create',
      action,
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_ACCEPTED_WORK_UNAVAILABLE })

    expect(action).not.toHaveBeenCalled()
    expect(fixture.admitted).toEqual([])
  })

  it('keeps provenance non-enumerable and out of serialized run context', () => {
    const runContext = attachAcceptedWorkProvenance({
      abortSignal: new AbortController().signal,
      workdir: '/workspace',
      requestId: 'public-request',
    }, provenance())

    expect(readAcceptedWorkProvenance(runContext)?.parentKey.requestId).toBe('parent-request')
    expect(JSON.stringify(runContext)).not.toContain('parent-request')
    expect(Object.keys(runContext)).not.toContain('acceptedWorkProvenance')
  })
})
