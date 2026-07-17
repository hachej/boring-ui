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
  it('maps agent start/end with monotonic session-scoped seq, stable turn id, and final assistant from agent_end', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })

    const start = mapper.map({ type: 'agent_start' } as AgentSessionEvent)
    const end = mapper.map({ type: 'agent_end', messages: [assistantMessage()], willRetry: false } as AgentSessionEvent)

    expect(start).toEqual([{ type: 'agent-start', seq: 1, turnId: 'turn:sess-1:1' }])
    expect(end).toHaveLength(2)
    expect(end[0]).toMatchObject({
      type: 'message-end',
      seq: 2,
      messageId: 'assistant-1',
      final: { id: 'assistant-1', role: 'assistant', turnId: 'turn:sess-1:1' },
    })
    expect(end[1]).toEqual({ type: 'agent-end', seq: 3, turnId: 'turn:sess-1:1', status: 'ok' })
    expect(PiChatEventSchema.parse(end[0])).toEqual(end[0])
  })

  it('does not duplicate a final assistant when message_end is followed by agent_end history', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    const final = assistantMessage({ id: 'assistant-final', content: [{ type: 'text', text: 'final' }] })

    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    const messageEnd = mapper.map({ type: 'message_end', message: final } as unknown as AgentSessionEvent)
    const agentEnd = mapper.map({ type: 'agent_end', messages: [final], willRetry: false } as unknown as AgentSessionEvent)

    expect(messageEnd).toHaveLength(1)
    expect(messageEnd[0]).toMatchObject({ type: 'message-end', messageId: 'assistant-final' })
    expect(agentEnd).toEqual([{ type: 'agent-end', seq: 3, turnId: 'turn-1', status: 'ok' }])
  })

  it('keeps id-less message_start/message_end/agent_end history on one canonical row per role', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    const user = { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1_700_000_000_000 }
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 1_700_000_000_001 }

    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    const userStart = mapper.map({ type: 'message_start', message: user } as unknown as AgentSessionEvent)
    const userStartId = userStart[0]?.type === 'message-start' ? userStart[0].messageId : undefined
    const userEnd = mapper.map({ type: 'message_end', message: user } as unknown as AgentSessionEvent)
    const assistantStart = mapper.map({ type: 'message_start', message: { role: 'assistant', content: [] } } as unknown as AgentSessionEvent)
    const assistantStartId = assistantStart[0]?.type === 'message-start' ? assistantStart[0].messageId : undefined
    const assistantEnd = mapper.map({ type: 'message_end', message: assistant } as unknown as AgentSessionEvent)
    const agentEnd = mapper.map({ type: 'agent_end', messages: [user, assistant], willRetry: false } as unknown as AgentSessionEvent)

    expect(userEnd).toEqual([
      expect.objectContaining({
        type: 'message-end',
        messageId: userStartId,
        final: expect.objectContaining({ id: userStartId, role: 'user' }),
      }),
    ])
    expect(assistantEnd).toEqual([
      expect.objectContaining({
        type: 'message-end',
        messageId: assistantStartId,
        final: expect.objectContaining({ id: assistantStartId, role: 'assistant' }),
      }),
    ])
    expect(agentEnd).toEqual([{ type: 'agent-end', seq: 6, turnId: 'turn-1', status: 'ok' }])
    expect(userStart[0]).toMatchObject({ type: 'message-start', createdAt: '2023-11-14T22:13:20.000Z' })
  })

  it('uses the active assistant id for an id-less final assistant carried on agent_end', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })

    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    const start = mapper.map({
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    } as unknown as AgentSessionEvent)
    const activeAssistantId = start[0]?.type === 'message-start' ? start[0].messageId : undefined

    const end = mapper.map({
      type: 'agent_end',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'final from agent_end' }] },
      ],
      willRetry: false,
    } as unknown as AgentSessionEvent)

    expect(activeAssistantId).toBe('pi:sess-1:event:2:assistant')
    expect(end[0]).toMatchObject({
      type: 'message-end',
      seq: 3,
      messageId: activeAssistantId,
      final: {
        id: activeAssistantId,
        role: 'assistant',
        parts: [{ type: 'text', id: `${activeAssistantId}:text:0`, text: 'final from agent_end' }],
      },
    })
    expect(end[1]).toEqual({ type: 'agent-end', seq: 4, turnId: 'turn-1', status: 'ok' })
  })

  it('does not finalize an active assistant from a contentless aborted agent_end placeholder', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })

    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    mapper.map({
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    } as unknown as AgentSessionEvent)

    const end = mapper.map({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'aborted' }],
      willRetry: false,
    } as unknown as AgentSessionEvent)

    expect(end).toEqual([{ type: 'agent-end', seq: 3, turnId: 'turn-1', status: 'aborted' }])
  })

  it('uses turn-scoped fallback ids for id-less agent_end assistants across turns', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })

    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    const first = mapper.map({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'first final' }] }],
      willRetry: false,
    } as unknown as AgentSessionEvent)

    mapper.map({ type: 'agent_start', turnId: 'turn-2' } as unknown as AgentSessionEvent)
    const second = mapper.map({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'second final' }] }],
      willRetry: false,
    } as unknown as AgentSessionEvent)

    expect(first[0]).toMatchObject({
      type: 'message-end',
      messageId: 'pi:sess-1:turn:turn-1:assistant',
      final: { id: 'pi:sess-1:turn:turn-1:assistant', turnId: 'turn-1' },
    })
    expect(second[0]).toMatchObject({
      type: 'message-end',
      messageId: 'pi:sess-1:turn:turn-2:assistant',
      final: { id: 'pi:sess-1:turn:turn-2:assistant', turnId: 'turn-2' },
    })
  })

  it('allows an id-less retry final to replace the failed final for a retained turn', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })

    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    const failed = mapper.map({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'failed final' }], stopReason: 'error' }],
      willRetry: true,
    } as unknown as AgentSessionEvent)
    mapper.map({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 10, errorMessage: 'failed' } as unknown as AgentSessionEvent)
    const retried = mapper.map({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'retry final' }] }],
      willRetry: false,
    } as unknown as AgentSessionEvent)

    expect(failed[0]).toMatchObject({
      type: 'message-end',
      messageId: 'pi:sess-1:turn:turn-1:assistant',
      final: {
        id: 'pi:sess-1:turn:turn-1:assistant',
        parts: [{ type: 'text', id: 'pi:sess-1:turn:turn-1:assistant:text:0', text: 'failed final' }],
      },
    })
    expect(failed[1]).toMatchObject({ type: 'agent-end', status: 'error' })
    expect(retried[0]).toMatchObject({
      type: 'message-end',
      messageId: 'pi:sess-1:turn:turn-1:assistant',
      final: {
        id: 'pi:sess-1:turn:turn-1:assistant',
        parts: [{ type: 'text', id: 'pi:sess-1:turn:turn-1:assistant:text:0', text: 'retry final' }],
      },
    })
    expect(retried[1]).toMatchObject({ type: 'agent-end', status: 'ok' })
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
        files: [{ type: 'file', id: 'user-1:file:1', mediaType: 'image/png', url: 'data:image/png;base64,redacted' }],
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
        toolCall: { id: 'tool-1', name: 'write', arguments: { path: 'a.ts', filesystem: 'company_context' }, ui: { rendererId: 'fs.write', extra: 'ignored' } },
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
        input: { path: 'a.ts', filesystem: 'company_context' },
        ui: { rendererId: 'fs.write' },
      },
    ])
    expect(toolResult).toMatchObject([
      { type: 'file-changed', seq: 3, path: 'a.ts', changeType: 'write', filesystem: 'company_context' },
      { type: 'tool-result', seq: 4, messageId: 'assistant-1', toolCallId: 'tool-1', isError: false, ui: { rendererId: 'fs.write.result' } },
    ])
  })

  it('keeps tool results attached when Pi ends the assistant tool-call message before executing the tool', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    const assistant = assistantMessage({ id: 'assistant-tool', content: [] })

    mapper.map({ type: 'message_start', message: assistant } as unknown as AgentSessionEvent)
    mapper.map({
      type: 'message_update',
      message: assistant,
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: { id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } },
      },
    } as unknown as AgentSessionEvent)
    mapper.map({ type: 'message_end', message: assistantMessage({ id: 'assistant-tool', content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } }] }) } as unknown as AgentSessionEvent)

    const toolResult = mapper.map({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: '/workspace' }] },
      isError: false,
    } as unknown as AgentSessionEvent)

    expect(toolResult).toEqual([
      {
        type: 'tool-result',
        seq: 4,
        messageId: 'assistant-tool',
        toolCallId: 'tool-1',
        output: { content: [{ type: 'text', text: '/workspace' }] },
        isError: false,
        errorText: undefined,
        ui: undefined,
      },
    ])
  })

  it('does not let an ended assistant tool-call message suppress the post-tool final assistant', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    const toolAssistant = assistantMessage({
      id: 'assistant-tool',
      content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } }],
    })
    const finalAssistant = assistantMessage({
      id: 'assistant-final',
      content: [{ type: 'text', text: 'final after tool' }],
    })

    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    mapper.map({ type: 'message_end', message: toolAssistant } as unknown as AgentSessionEvent)
    const agentEnd = mapper.map({
      type: 'agent_end',
      messages: [toolAssistant, finalAssistant],
      willRetry: false,
    } as unknown as AgentSessionEvent)

    expect(agentEnd).toEqual([
      expect.objectContaining({
        type: 'message-end',
        seq: 3,
        messageId: 'assistant-final',
        final: expect.objectContaining({
          id: 'assistant-final',
          role: 'assistant',
          parts: [{ type: 'text', id: 'assistant-final:text:0', text: 'final after tool' }],
        }),
      }),
      { type: 'agent-end', seq: 4, turnId: 'turn-1', status: 'ok' },
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

  it('surfaces an agent_end turn failure as an error event when no assistant error event was streamed', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)

    const end = mapper.map({
      type: 'agent_end',
      willRetry: false,
      messages: [assistantMessage({ stopReason: 'error', content: [], errorMessage: 'No API key for provider: anthropic' })],
    } as unknown as AgentSessionEvent)

    expect(end).toMatchObject([
      {
        type: 'error',
        turnId: 'turn-1',
        retryable: false,
        error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'No API key for provider: anthropic', retryable: false },
      },
      { type: 'agent-end', turnId: 'turn-1', status: 'error' },
    ])
    expect(PiChatEventSchema.parse(end[0])).toEqual(end[0])
  })

  it('does not duplicate the error event when the assistant already streamed one for the turn', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)
    mapper.map({ type: 'message_update', assistantMessageEvent: { type: 'error', reason: 'error', error: { errorMessage: 'model failed' } } } as unknown as AgentSessionEvent)

    const end = mapper.map({
      type: 'agent_end',
      willRetry: false,
      messages: [assistantMessage({ stopReason: 'error', content: [], errorMessage: 'model failed' })],
    } as unknown as AgentSessionEvent)

    expect(end).toMatchObject([{ type: 'agent-end', turnId: 'turn-1', status: 'error' }])
  })

  it('does not synthesize an error event when pi will auto-retry the turn', () => {
    const mapper = new PiChatEventMapper({ sessionId: 'sess-1' })
    mapper.map({ type: 'agent_start', turnId: 'turn-1' } as unknown as AgentSessionEvent)

    const end = mapper.map({
      type: 'agent_end',
      willRetry: true,
      messages: [assistantMessage({ stopReason: 'error', content: [], errorMessage: 'rate limited' })],
    } as unknown as AgentSessionEvent)

    expect(end).toMatchObject([{ type: 'agent-end', turnId: 'turn-1', status: 'error' }])
  })

  it('provides a stateless helper for one-off event mapping', () => {
    expect(mapPiAgentSessionEvent({ type: 'agent_start' } as AgentSessionEvent, { sessionId: 'sess-1' })).toEqual([
      { type: 'agent-start', seq: 1, turnId: 'turn:sess-1:1' },
    ])
  })
})
