import { describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { ErrorCode } from '../../../shared/error-codes'
import { PiChatEventSchema } from '../../../shared/chat'
import { PiChatEventMapper, mapPiAgentSessionEvent } from '../piChatEvents'

function assistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: [{ type: 'text', text: 'Done' }],
    stopReason: 'stop',
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: 0,
    ...overrides,
  }
}

describe('PiChatEventMapper', () => {
  it('maps agent start/end with monotonic session-scoped seq and stable turn id', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })

    const start = mapper.map({ type: 'agent_start' } as AgentSessionEvent)
    const end = mapper.map({ type: 'agent_end', messages: [assistantMessage()], willRetry: false } as AgentSessionEvent)

    expect(start).toEqual([{ type: 'agent-start', seq: 1, turnId: 'turn:sess-1:1' }])
    expect(end).toEqual([{ type: 'agent-end', seq: 2, turnId: 'turn:sess-1:1', status: 'ok' }])
  })

  it('maps user message-start and followup-consumed when nonce/seq metadata is present', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1', initialSeq: 10 })

    const events = mapper.map({
      type: 'message_start',
      message: {
        id: 'user-1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }, { type: 'image', mimeType: 'image/png', data: 'redacted' }],
        clientNonce: 'nonce-1',
        clientSeq: 7,
      },
    } as unknown as AgentSessionEvent)

    expect(events).toEqual([
      {
        type: 'message-start',
        seq: 11,
        messageId: 'user-1',
        role: 'user',
        clientNonce: 'nonce-1',
        clientSeq: 7,
        text: 'hello',
        files: [{ type: 'file', id: 'user-1:file:1', mediaType: 'image/png' }],
      },
      { type: 'followup-consumed', seq: 12, clientNonce: 'nonce-1', clientSeq: 7, messageId: 'user-1' },
    ])
  })

  it('maps assistant text/reasoning deltas and part ends by content index', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    mapper.map({ type: 'message_start', message: assistantMessage({ id: 'assistant-1', content: [] }) } as unknown as AgentSessionEvent)

    const events = [
      ...mapper.map({ type: 'message_update', message: assistantMessage({ id: 'assistant-1' }), assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'plan' } } as unknown as AgentSessionEvent),
      ...mapper.map({ type: 'message_update', message: assistantMessage({ id: 'assistant-1' }), assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'plan' } } as unknown as AgentSessionEvent),
      ...mapper.map({ type: 'message_update', message: assistantMessage({ id: 'assistant-1' }), assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'hi' } } as unknown as AgentSessionEvent),
      ...mapper.map({ type: 'message_update', message: assistantMessage({ id: 'assistant-1' }), assistantMessageEvent: { type: 'text_end', contentIndex: 1, content: 'hi' } } as unknown as AgentSessionEvent),
    ]

    expect(events.map((event) => event.type)).toEqual(['message-delta', 'message-part-end', 'message-delta', 'message-part-end'])
    expect(events).toMatchObject([
      { messageId: 'assistant-1', partId: '0', kind: 'reasoning', delta: 'plan' },
      { messageId: 'assistant-1', partId: '0', kind: 'reasoning', text: 'plan' },
      { messageId: 'assistant-1', partId: '1', kind: 'text', delta: 'hi' },
      { messageId: 'assistant-1', partId: '1', kind: 'text', text: 'hi' },
    ])
  })

  it('maps tool calls, tool results, and file-changed display events', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    mapper.map({ type: 'message_start', message: assistantMessage({ id: 'assistant-1', content: [] }) } as unknown as AgentSessionEvent)

    const toolCall = mapper.map({
      type: 'message_update',
      message: assistantMessage({ id: 'assistant-1' }),
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 2,
        toolCall: { id: 'tool-1', name: 'write', arguments: { path: 'a.ts' }, ui: { rendererId: 'fs.write', extra: 'ignored' } },
      },
    } as unknown as AgentSessionEvent)
    const toolResult = mapper.map({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'write',
      result: {
        content: [{ type: 'text', text: 'wrote file' }],
        details: { fileChanges: [{ op: 'write', path: 'a.ts', ignored: true }], ui: { rendererId: 'fs.write.result' } },
      },
      isError: false,
    } as unknown as AgentSessionEvent)

    expect(toolCall).toEqual([
      {
        type: 'tool-call',
        seq: 2,
        messageId: 'assistant-1',
        toolCallId: 'tool-1',
        toolName: 'write',
        input: { path: 'a.ts' },
        ui: { rendererId: 'fs.write' },
      },
    ])
    expect(toolResult).toMatchObject([
      { type: 'file-changed', seq: 3, path: 'a.ts', changeType: 'write' },
      { type: 'tool-result', seq: 4, messageId: 'assistant-1', toolCallId: 'tool-1', isError: false, ui: { rendererId: 'fs.write.result' } },
    ])
  })

  it('maps final message-end and usage from done events', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    const final = assistantMessage({ id: 'assistant-final', content: [{ type: 'text', text: 'final' }] })

    const usage = mapper.map({ type: 'message_update', message: final, assistantMessageEvent: { type: 'done', message: final } } as unknown as AgentSessionEvent)
    const end = mapper.map({ type: 'message_end', message: final } as unknown as AgentSessionEvent)

    expect(usage).toEqual([{ type: 'usage', seq: 1, usage: final.usage }])
    expect(end).toHaveLength(1)
    expect(end[0]).toMatchObject({ type: 'message-end', seq: 2, messageId: 'assistant-final', final: { id: 'assistant-final', role: 'assistant' } })
    expect(PiChatEventSchema.parse(end[0])).toEqual(end[0])
  })

  it('maps queue updates, auto retry notices, UI commands, and assistant errors', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })

    const events = [
      ...mapper.map({ type: 'queue_update', steering: [], followUp: ['first', 'second'] } as AgentSessionEvent),
      ...mapper.map({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: 'rate limit' } as AgentSessionEvent),
      ...mapper.map({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'still rate limited' } as AgentSessionEvent),
      ...mapper.map({ type: 'ui_command', command: { kind: 'open-panel', panelId: 'questions' } }),
      ...mapper.map({ type: 'message_update', assistantMessageEvent: { type: 'error', reason: 'error', error: { errorMessage: 'model failed' } } } as unknown as AgentSessionEvent),
    ]

    expect(events).toMatchObject([
      { type: 'queue-updated', queue: { followUps: [{ displayText: 'first' }, { displayText: 'second' }] } },
      { type: 'auto-retry-start', attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: 'rate limit' },
      { type: 'auto-retry-end', success: false, attempt: 1, finalError: 'still rate limited' },
      { type: 'ui-command', command: { kind: 'open-panel', panelId: 'questions' }, displayOnly: true },
      { type: 'error', error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'model failed', retryable: false } },
    ])
  })

  it('provides a stateless helper for one-off event mapping', () => {
    expect(mapPiAgentSessionEvent({ type: 'agent_start' } as AgentSessionEvent, { sessionId: 'sess-1' })).toEqual([
      { type: 'agent-start', seq: 1, turnId: 'turn:sess-1:1' },
    ])
  })
})
