import { createHash } from 'node:crypto'

import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  SessionManager,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import type { JsonValue } from '../../../../shared/index'
import type { RunContext } from '../../../../shared/harness'
import { InMemoryAgentRequestLedger } from '../../../agent-host/requestLedger'
import type { AgentHostRuntime } from '../../../agent-host/createAgentHost'
import type { AgentRequestKey } from '../../../agent-host/types'
import {
  attachAcceptedWorkProvenance,
  createAcceptedToolEffectExecutor,
  defineAcceptedExternalEffectTool,
  readAcceptedWorkProvenance,
} from '../../../agent-host/acceptedWork'
import { canonicalDigest } from '../../../agent-host/canonical'
import {
  rememberQueuedFollowUpRunContexts,
  resolvePiRunContext,
  updateRunContextStateFromPiEvent,
  type PiRunContextState,
} from '../createHarness'
import { adaptToolForPi } from '../tool-adapter'

function usage() {
  return { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

function assistantMessage(id: string, content: unknown[], stopReason: 'toolUse' | 'stop') {
  return { id, role: 'assistant', content, api: 'accepted-work-test', provider: 'accepted-work-test', model: 'loop-model', usage: usage(), stopReason, timestamp: Date.now() }
}

function stream(events: unknown[], finalMessage: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) { await Promise.resolve(); yield event }
    },
    async result() { return finalMessage },
  }
}

function emptyResourceLoader() {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() }
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}

function parentContext(subject: string, requestId: string, operation: 'session.prompt' | 'session.followup'): RunContext {
  const key: AgentRequestKey = {
    workspaceScopeId: 'workspace-a',
    authSubjectId: subject,
    operation,
    target: { kind: 'session', ref: { agentTypeId: 'worker', sessionId: 'session-a' } },
    requestId,
  }
  return attachAcceptedWorkProvenance({
    abortSignal: new AbortController().signal,
    workdir: '/workspace',
    workspaceId: 'workspace-a',
    requestId,
  }, { parentKey: key, claim: { workspaceScopeId: 'workspace-a', authSubjectId: subject } })
}

function expectedChildRequestId(parentKey: AgentRequestKey, toolCallId: string): string {
  return `tool:${createHash('sha256').update(canonicalDigest({ parentKey: parentKey as unknown as JsonValue, toolCallId })).digest('hex')}`
}

describe('accepted work through the pinned Pi queue', () => {
  it('uses the queued follow-up parent key across Pi async draining', async () => {
    const ledger = new InMemoryAgentRequestLedger()
    const admitted: AgentRequestKey[] = []
    const runtime = {
      ledger,
      effectAdmission: { async admit({ key }: { key: AgentRequestKey }) { admitted.push(key); return { type: 'accepted' as const, admissionReceipt: `admitted:${key.requestId}` } } },
      assertOpen() {},
      startPreparedEffect<T>(_key: AgentRequestKey, effect: () => Promise<T>) { return effect() },
    } as unknown as AgentHostRuntime
    const executeAccepted = createAcceptedToolEffectExecutor({
      runtime,
      workspaceScopeId: 'workspace-a',
      agentTypeId: 'worker',
      sessionId: 'session-a',
      allowInMemoryLedgerForTests: true,
    })

    let firstToolStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => { firstToolStarted = resolve })
    let releaseFirst!: () => void
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve })
    const action = vi.fn(async () => {
      if (action.mock.calls.length === 1) { firstToolStarted(); await firstRelease }
      return { ok: true } satisfies JsonValue
    })
    const managementTool = defineAcceptedExternalEffectTool({
      name: 'sandbox', description: 'test', parameters: {},
      async execute() { throw new Error('public execution must not run') },
    }, async (_params, _ctx, invocation) => ({
      content: [{ type: 'text', text: JSON.stringify(await executeAccepted({
        provenance: invocation.provenance,
        toolCallId: invocation.toolCallId,
        tool: 'sandbox',
        op: 'create',
        action,
      })) }],
    }))

    const initial = parentContext('alpha', 'parent-initial', 'session.prompt')
    const queued = parentContext('beta', 'parent-queued', 'session.followup')
    const state: PiRunContextState = { queuedFollowUpContexts: new WeakMap() }
    let submittingContext: RunContext | undefined = initial
    const adapted = adaptToolForPi(managementTool, 'session-a', undefined, () => resolvePiRunContext(state, submittingContext))

    const authStorage = AuthStorage.inMemory()
    const modelRegistry = ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider('accepted-work-test', {
      name: 'Accepted Work Test', api: 'accepted-work-test', baseUrl: 'https://example.invalid', apiKey: 'test-key',
      models: [{ id: 'loop-model', name: 'Loop Model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 128 }],
      streamSimple(_model, context) {
        const userCount = context.messages.filter((message) => (message as { role?: unknown }).role === 'user').length
        let latestUser = -1
        for (let index = context.messages.length - 1; index >= 0; index -= 1) {
          if ((context.messages[index] as { role?: unknown }).role === 'user') {
            latestUser = index
            break
          }
        }
        const hasResult = context.messages.slice(latestUser + 1).some((message) => (message as { role?: unknown }).role === 'toolResult')
        if (!hasResult) {
          const toolCall = { type: 'toolCall', id: `tool-${userCount}`, name: 'sandbox', arguments: {} }
          const final = assistantMessage(`assistant-tool-${userCount}`, [toolCall], 'toolUse')
          return stream([{ type: 'start', partial: assistantMessage(`assistant-tool-${userCount}`, [], 'toolUse') }, { type: 'toolcall_end', contentIndex: 0, toolCall, partial: final }, { type: 'done', reason: 'toolUse', message: final }], final) as any
        }
        const final = assistantMessage(`assistant-final-${userCount}`, [{ type: 'text', text: 'done' }], 'stop')
        return stream([{ type: 'start', partial: assistantMessage(`assistant-final-${userCount}`, [], 'stop') }, { type: 'text_delta', contentIndex: 0, delta: 'done', partial: final }, { type: 'text_end', contentIndex: 0, content: 'done', partial: final }, { type: 'done', reason: 'stop', message: final }], final) as any
      },
    })
    const model = modelRegistry.find('accepted-work-test', 'loop-model')!
    const { session } = await createAgentSession({ cwd: process.cwd(), authStorage, modelRegistry, model, noTools: 'builtin', customTools: [adapted as ToolDefinition], resourceLoader: emptyResourceLoader() as any, sessionManager: SessionManager.inMemory(process.cwd()), thinkingLevel: 'off' })
    const restore = rememberQueuedFollowUpRunContexts(session, state, () => submittingContext)
    const unsubscribe = session.subscribe((event) => updateRunContextStateFromPiEvent(state, event))

    try {
      const prompt = session.prompt('initial')
      await firstStarted
      submittingContext = queued
      await session.followUp('queued')
      submittingContext = initial
      releaseFirst()
      await prompt

      const initialKey = readAcceptedWorkProvenance(initial)!.parentKey
      const queuedKey = readAcceptedWorkProvenance(queued)!.parentKey
      expect(admitted.map((key) => key.requestId)).toEqual([
        expectedChildRequestId(initialKey, 'tool-1'),
        expectedChildRequestId(queuedKey, 'tool-2'),
      ])
      expect(admitted.map((key) => key.authSubjectId)).toEqual(['alpha', 'beta'])
      expect(action).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
      restore()
      session.dispose()
    }
  })
})
