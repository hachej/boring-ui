import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import { buildPiChatHistory } from '../piChatHistory'

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

describe('buildPiChatHistory', () => {
  it('maps user, assistant, system, files, reasoning, and notices into BoringChatMessage', () => {
    const history = buildPiChatHistory(
      [
        { id: 'entry-system', message: { role: 'system', content: 'system prompt', timestamp: 1 } },
        {
          id: 'entry-user',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'hello' },
              { type: 'image', data: 'redacted', mimeType: 'image/png' },
            ],
            timestamp: 2,
          },
        },
        {
          id: 'entry-assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'plan' },
              { type: 'text', text: 'answer' },
            ],
            api: 'test',
            provider: 'test',
            model: 'model',
            usage,
            stopReason: 'stop',
            timestamp: 3,
          },
        },
        { id: 'entry-notice', message: { role: 'custom', content: 'custom notice', display: true, timestamp: 4 } },
      ],
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(history).toEqual([
      expect.objectContaining({ id: 'entry-system', role: 'system', piEntryId: 'entry-system', turnId: 'turn-1' }),
      expect.objectContaining({ id: 'entry-user', role: 'user', piEntryId: 'entry-user', turnId: 'turn-1' }),
      expect.objectContaining({ id: 'entry-assistant', role: 'assistant', piEntryId: 'entry-assistant', turnId: 'turn-1' }),
      expect.objectContaining({ id: 'entry-notice', role: 'system', piEntryId: 'entry-notice', turnId: 'turn-1' }),
    ])
    expect(history[0]?.parts).toEqual([{ type: 'text', id: 'entry-system:text:0', text: 'system prompt' }])
    expect(history[1]?.parts).toEqual([
      { type: 'text', id: 'entry-user:text:0', text: 'hello' },
      { type: 'file', id: 'entry-user:file:1', mediaType: 'image/png', url: 'data:image/png;base64,redacted' },
    ])
    expect(history[2]?.runTerminalState).toBe('success')
    expect(history[2]?.parts).toEqual([
      { type: 'reasoning', id: 'entry-assistant:reasoning:0', text: 'plan', state: 'done' },
      { type: 'text', id: 'entry-assistant:text:1', text: 'answer' },
    ])
    expect(history[3]?.parts).toEqual([{ type: 'text', id: 'entry-notice:text:0', text: 'custom notice' }])
  })

  it('can map persisted image parts to lazy attachment URLs instead of inlining base64 into /state', () => {
    const history = buildPiChatHistory(
      [
        {
          id: 'entry-user',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'see image' },
              { type: 'image', data: 'base64-bytes', mimeType: 'image/png', filename: 'image.png' },
            ],
          },
        },
      ],
      {
        sessionId: 'session-1',
        attachmentUrl: ({ messageId, index }) => `/api/v1/agent/pi-chat/session-1/attachments/${messageId}/${index}`,
      },
    )

    expect(history[0]?.parts).toEqual([
      { type: 'text', id: 'entry-user:text:0', text: 'see image' },
      {
        type: 'file',
        id: 'entry-user:file:1',
        filename: 'image.png',
        mediaType: 'image/png',
        url: '/api/v1/agent/pi-chat/session-1/attachments/entry-user/1',
      },
    ])
  })

  it('attaches tool results to the owning assistant tool part by toolCallId', () => {
    const history = buildPiChatHistory(
      [
        {
          id: 'entry-assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'call-read', name: 'read', arguments: { path: 'README.md' } },
              { type: 'text', text: 'I read it.' },
            ],
            api: 'test',
            provider: 'test',
            model: 'model',
            usage,
            stopReason: 'stop',
            timestamp: 1,
          },
        },
        {
          id: 'entry-tool',
          message: {
            role: 'toolResult',
            toolCallId: 'call-read',
            toolName: 'read',
            content: [{ type: 'text', text: '# Hello' }],
            details: { code: ErrorCode.enum.WORKSPACE_NOT_READY, retryable: true, ui: { rendererId: 'read.result' } },
            isError: true,
            timestamp: 2,
          },
        },
      ],
      { sessionId: 'session-1' },
    )

    expect(history).toHaveLength(1)
    expect(history[0]?.parts).toEqual([
      {
        type: 'tool-call',
        id: 'call-read',
        toolName: 'read',
        input: { path: 'README.md' },
        state: 'output-error',
        output: {
          content: [{ type: 'text', text: '# Hello' }],
          details: { code: ErrorCode.enum.WORKSPACE_NOT_READY, retryable: true, ui: { rendererId: 'read.result' } },
        },
        errorText: '# Hello',
        ui: { rendererId: 'read.result' },
      },
      { type: 'text', id: 'entry-assistant:text:1', text: 'I read it.' },
    ])
  })

  it('uses stable fallback ids only when Pi entry ids are unavailable', () => {
    const history = buildPiChatHistory(
      [
        { role: 'user', content: 'hello', timestamp: 123 },
        { role: 'assistant', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop', timestamp: 124 },
      ],
      { sessionId: 'session-1' },
    )

    expect(history.map((message) => message.id)).toEqual([
      'pi:session-1:message:0:user:1970-01-01T00:00:00.123Z',
      'pi:session-1:message:1:assistant:1970-01-01T00:00:00.124Z',
    ])
    expect(history.map((message) => message.piEntryId)).toEqual([undefined, undefined])
  })

  it('keeps final Pi entry ids so stream message ids reconcile with /state hydration', () => {
    const history = buildPiChatHistory(
      [
        { id: 'entry-final-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'final' }], stopReason: 'stop', timestamp: 1 } },
      ],
      { sessionId: 'session-1', turnId: 'turn-final' },
    )

    expect(history[0]).toMatchObject({
      id: 'entry-final-assistant',
      piEntryId: 'entry-final-assistant',
      turnId: 'turn-final',
      status: 'done',
      parts: [{ type: 'text', id: 'entry-final-assistant:text:0', text: 'final' }],
    })
  })
})
