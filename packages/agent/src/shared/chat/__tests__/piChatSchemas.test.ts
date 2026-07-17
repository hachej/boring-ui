import { describe, expect, test } from 'vitest'
import {
  CommandReceiptSchema,
  FollowUpPayloadSchema,
  FollowUpReceiptSchema,
  InterruptPayloadSchema,
  PiChatEventSchema,
  PiChatSnapshotSchema,
  PiChatStreamFrameSchema,
  PromptPayloadSchema,
  QueueClearPayloadSchema,
  QueueClearReceiptSchema,
  sanitizeToolUiMetadata,
  StopPayloadSchema,
  StopReceiptSchema,
} from '../piChatSchemas'

describe('Pi chat shared schemas', () => {
  test('parses active /state snapshot fields needed for reload while an agent is running', () => {
    const snapshot = {
      protocolVersion: 1,
      sessionId: 'pi-session-1',
      seq: 42,
      status: 'streaming',
      activeTurnId: 'turn-1',
      messages: [
        {
          id: 'entry-user-1',
          role: 'user',
          status: 'done',
          parts: [{ type: 'text', text: 'hello' }],
          piEntryId: 'entry-user-1',
          turnId: 'turn-1',
        },
      ],
      queue: {
        followUps: [
          {
            id: 'queued-1',
            kind: 'followup',
            clientNonce: 'nonce-1',
            clientSeq: 1,
            displayText: 'next question',
          },
        ],
      },
      followUpMode: 'one-at-a-time',
    }

    const parsed = PiChatSnapshotSchema.parse(snapshot)

    expect(parsed).toMatchObject({
      protocolVersion: 1,
      sessionId: 'pi-session-1',
      seq: 42,
      status: 'streaming',
      activeTurnId: 'turn-1',
      queue: { followUps: [{ displayText: 'next question' }] },
    })
  })

  test('rejects unsupported snapshot protocol versions and missing active reload fields', () => {
    expect(PiChatSnapshotSchema.safeParse({ protocolVersion: 2 }).success).toBe(false)
    expect(
      PiChatSnapshotSchema.safeParse({
        protocolVersion: 1,
        sessionId: 's1',
        status: 'streaming',
        messages: [],
        queue: { followUps: [] },
        followUpMode: 'one-at-a-time',
      }).success,
    ).toBe(false)
  })

  test('validates prompt/follow-up payloads adapted from old route body validation', () => {
    expect(
      PromptPayloadSchema.parse({
        message: 'hello',
        clientNonce: 'nonce-1',
        model: { provider: 'anthropic', id: 'claude' },
        thinkingLevel: 'high',
        attachments: [{ filename: 'a.txt', mediaType: 'text/plain', url: 'https://example.test/a.txt' }],
      }),
    ).toMatchObject({ message: 'hello', thinkingLevel: 'high' })

    expect(PromptPayloadSchema.safeParse({ message: '', clientNonce: 'nonce-1' }).success).toBe(false)
    expect(PromptPayloadSchema.safeParse({ message: 'hello', clientNonce: 'nonce-1', thinkingLevel: 'max' }).success).toBe(false)
    expect(PromptPayloadSchema.safeParse({ message: 'hello', clientNonce: 'nonce-1', model: { provider: '' } }).success).toBe(false)

    expect(FollowUpPayloadSchema.parse({ message: 'next', clientNonce: 'nonce-2', clientSeq: 2 })).toMatchObject({
      clientSeq: 2,
    })
    expect(FollowUpPayloadSchema.safeParse({ message: 'next', clientNonce: 'nonce-2' }).success).toBe(false)
  })

  test('validates empty command payloads and command receipts', () => {
    expect(QueueClearPayloadSchema.parse({})).toEqual({})
    expect(QueueClearPayloadSchema.parse(undefined)).toEqual({})
    expect(QueueClearPayloadSchema.parse({ clientNonce: 'nonce-q', clientSeq: 1 })).toEqual({ clientNonce: 'nonce-q', clientSeq: 1 })
    expect(InterruptPayloadSchema.parse({})).toEqual({})
    expect(StopPayloadSchema.parse({})).toEqual({})
    expect(QueueClearPayloadSchema.safeParse({ unexpected: true }).success).toBe(false)


    expect(CommandReceiptSchema.parse({ accepted: true, cursor: 10 })).toEqual({ accepted: true, cursor: 10 })
    expect(FollowUpReceiptSchema.parse({ accepted: true, cursor: 11, clientNonce: 'n', clientSeq: 1, queued: true })).toMatchObject({ queued: true })
    expect(QueueClearReceiptSchema.parse({ accepted: true, cursor: 12, cleared: 3 })).toMatchObject({ cleared: 3 })
    expect(StopReceiptSchema.parse({ accepted: true, cursor: 13, stopped: true, clearedQueue: [] })).toMatchObject({ stopped: true })

    expect(CommandReceiptSchema.safeParse({ accepted: false, cursor: 10 }).success).toBe(false)
    expect(FollowUpReceiptSchema.safeParse({ accepted: true, cursor: 11, clientNonce: 'n', queued: true }).success).toBe(false)
  })

  test('parses stream frames, strips unknown event fields, and rejects unknown event types', () => {
    expect(PiChatStreamFrameSchema.parse({ type: 'heartbeat', now: '2026-06-03T00:00:00.000Z' })).toMatchObject({ type: 'heartbeat' })

    const parsed = PiChatEventSchema.parse({
      type: 'message-delta',
      seq: 5,
      messageId: 'm1',
      partId: 'p1',
      kind: 'text',
      delta: 'hi',
      futureField: 'ignored',
    })

    expect(parsed).toEqual({ type: 'message-delta', seq: 5, messageId: 'm1', partId: 'p1', kind: 'text', delta: 'hi' })
    expect(PiChatEventSchema.parse({
      type: 'message-start',
      seq: 6,
      messageId: 'u1',
      role: 'user',
      createdAt: '2026-06-06T10:00:00.000Z',
    })).toMatchObject({ type: 'message-start', createdAt: '2026-06-06T10:00:00.000Z' })
    expect(PiChatEventSchema.parse({
      type: 'file-changed',
      seq: 7,
      path: '/company/handbook.md',
      changeType: 'write',
      filesystem: 'company_context',
    })).toMatchObject({ filesystem: 'company_context' })
    expect(PiChatEventSchema.parse({
      type: 'message-start',
      seq: 8,
      messageId: 'u-company',
      role: 'user',
      files: [{ type: 'file', path: '/company/hr/policy.md', filesystem: 'company_context' }],
    })).toMatchObject({
      type: 'message-start',
      files: [{ type: 'file', path: '/company/hr/policy.md', filesystem: 'company_context' }],
    })
    expect(PiChatEventSchema.safeParse({ type: 'new-future-event', seq: 1 }).success).toBe(false)
    expect(PiChatEventSchema.safeParse({ type: 'message-delta', messageId: 'm1', partId: 'p1', kind: 'text', delta: 'hi' }).success).toBe(false)
  })

  test('treats tool UI metadata as untrusted display metadata', () => {
    expect(
      sanitizeToolUiMetadata({
        rendererId: 'ask-user.question',
        displayGroup: 'questions',
        icon: 'help',
        details: { questionId: 'q1' },
        onClick: 'not allowed',
      }),
    ).toEqual({
      rendererId: 'ask-user.question',
      displayGroup: 'questions',
      icon: 'help',
      details: { questionId: 'q1' },
    })

    expect(sanitizeToolUiMetadata({ rendererId: 123, details: { ignored: true } })).toBeUndefined()

    const parsed = PiChatEventSchema.parse({
      type: 'tool-call',
      seq: 7,
      messageId: 'm1',
      toolCallId: 'tc1',
      toolName: 'ask_user',
      input: { q: 'continue?' },
      ui: { rendererId: 123, details: { unsafe: true } },
    })

    expect(parsed).toEqual({
      type: 'tool-call',
      seq: 7,
      messageId: 'm1',
      toolCallId: 'tc1',
      toolName: 'ask_user',
      input: { q: 'continue?' },
      ui: undefined,
    })
  })

  test('invalid events fail at the schema boundary without mutating source data', () => {
    const invalid = {
      type: 'message-end',
      seq: 8,
      messageId: 'm1',
      final: { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 123 }] },
    }
    const before = structuredClone(invalid)

    expect(PiChatEventSchema.safeParse(invalid).success).toBe(false)
    expect(invalid).toEqual(before)
  })
})
