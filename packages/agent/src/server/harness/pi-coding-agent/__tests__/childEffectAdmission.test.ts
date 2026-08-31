import { describe, expect, it } from 'vitest'
import type { ChildEffectRunCapability, RunContext } from '../../../../shared/harness'
import type { AgentTool } from '../../../../shared/tool'
import { InMemoryAgentRequestLedger } from '../../../agent-host/requestLedger'
import type { AgentRequestKey } from '../../../agent-host/types'
import { adaptToolForPi } from '../tool-adapter'

const runKey: AgentRequestKey = {
  workspaceScopeId: 'workspace-a',
  authSubjectId: 'subject-a',
  operation: 'session.prompt',
  target: { kind: 'session', ref: { agentTypeId: 'alpha', sessionId: 'session-a' } },
  requestId: 'run-a',
}

function tool(effect?: AgentTool['effect']): AgentTool {
  return {
    name: effect ? `${effect}-tool` : 'unknown-tool',
    ...(effect ? { effect } : {}),
    description: 'test tool',
    parameters: {},
    async execute() { return { content: [{ type: 'text', text: 'ok' }] } },
  }
}

describe('per-Run child-effect admission', () => {
  it('writes zero effect rows for observe tools', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const capability = {
      async admit(toolCallId: string, effectClass: AgentTool['effect']) {
        await ledger.admitEffect!({ runRequestKey: runKey, effectId: toolCallId, effectClass: effectClass!, idempotent: false })
      },
      async begin() {}, async pause() {}, async settle() {}, async markOutcomeUnknown() {},
    } as unknown as ChildEffectRunCapability
    const context = { abortSignal: new AbortController().signal, workdir: '/tmp', childEffectCapability: capability } satisfies RunContext
    const adapted = adaptToolForPi(tool('observe'), 'session-a', undefined, () => context)

    await adapted.execute('observe-1', {}, context.abortSignal, undefined, {} as never)

    expect(await ledger.countEffects!()).toBe(0)
  })

  it('denies unknown/external-effect tools without a gateway-minted capability', async () => {
    const context = { abortSignal: new AbortController().signal, workdir: '/tmp' } satisfies RunContext
    const adapted = adaptToolForPi(tool(), 'session-a', undefined, () => context)
    await expect(adapted.execute('unknown-1', {}, context.abortSignal, undefined, {} as never))
      .rejects.toThrow('gateway-minted child-effect capability')
  })

  it('settles a pause effect only after the tool returns', async () => {
    const calls: string[] = []
    const capability = {
      async admit() { calls.push('admit') },
      async begin() { calls.push('begin') },
      async pause() { calls.push('pause') },
      async settle() { calls.push('settle') },
      async markOutcomeUnknown() { calls.push('unknown') },
    } as unknown as ChildEffectRunCapability
    const context = { abortSignal: new AbortController().signal, workdir: '/tmp', childEffectCapability: capability } satisfies RunContext
    const adapted = adaptToolForPi(tool('pause'), 'session-a', undefined, () => context)

    await adapted.execute('pause-1', {}, context.abortSignal, undefined, {} as never)

    expect(calls).toEqual(['admit', 'pause', 'settle'])
  })
})
