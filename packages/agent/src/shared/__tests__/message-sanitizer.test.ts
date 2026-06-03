import { describe, expect, test } from 'vitest'
import type { UIMessage } from '../message'
import { dropEmptyAssistantUiMessages, sanitizeUiMessage, sanitizeUiMessages, uiMessageContentKey } from '../message-sanitizer'

function text(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('')
}

describe('message sanitizer', () => {
  test('collapses exact repeated assistant text with min unit length four', () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'donedone' }],
    } as UIMessage

    expect(text(sanitizeUiMessage(message))).toBe('done')
  })

  test('does not collapse repeated assistant text with unit shorter than four', () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'nonono' }],
    } as UIMessage

    expect(text(sanitizeUiMessage(message))).toBe('nonono')
  })

  test('collapses adjacent duplicate assistant text parts after normalization', () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'donedone' },
        { type: 'text', text: 'done' },
      ],
    } as UIMessage

    expect(sanitizeUiMessage(message).parts).toEqual([{ type: 'text', text: 'done' }])
  })

  test('collapses adjacent assistant messages with identical visible text', () => {
    const messages = sanitizeUiMessages([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'same answer' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'reasoning', text: '' }, { type: 'text', text: 'same answer' }] },
    ] as UIMessage[])

    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1'])
  })

  test('removes later duplicate user only when id is transient', () => {
    const messages = sanitizeUiMessages([
      { id: 'stable-user', role: 'user', parts: [{ type: 'text', text: 'wait10s before response' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
      { id: 'user-1780472366061', role: 'user', parts: [{ type: 'text', text: 'wait10s before response' }] },
    ] as UIMessage[])

    expect(messages.map((message) => message.id)).toEqual(['stable-user', 'a1'])
  })

  test('preserves pending duplicate user messages', () => {
    const messages = sanitizeUiMessages([
      { id: 'stable-user', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
      { id: 'pending-user:1', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
    ] as UIMessage[])

    expect(messages.map((message) => message.id)).toEqual(['stable-user', 'pending-user:1'])
  })

  test('preserves stable repeated user prompts with distinct stable ids', () => {
    const messages = sanitizeUiMessages([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
    ] as UIMessage[])

    expect(messages.map((message) => message.id)).toEqual(['u1', 'u2'])
  })

  test('drops empty assistant messages only when requested', () => {
    const emptyAssistant = { id: 'a-empty', role: 'assistant', parts: [] } as unknown as UIMessage

    expect(sanitizeUiMessages([emptyAssistant]).map((message) => message.id)).toEqual(['a-empty'])
    expect(sanitizeUiMessages([emptyAssistant], { dropEmptyAssistantMessages: true })).toEqual([])
  })

  test('dropEmptyAssistantUiMessages does not otherwise sanitize transcript fallback', () => {
    const messages = dropEmptyAssistantUiMessages([
      { id: 'a-empty', role: 'assistant', parts: [] },
      { id: 'a-repeat', role: 'assistant', parts: [{ type: 'text', text: 'donedone' }] },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
      { id: 'user-1780472366061', role: 'user', parts: [{ type: 'text', text: 'retry this' }] },
    ] as UIMessage[])

    expect(messages.map((message) => message.id)).toEqual(['a-repeat', 'u1', 'user-1780472366061'])
    expect(text(messages[0])).toBe('donedone')
  })

  test('content key uses sanitized message parts', () => {
    const repeated = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'donedone' }] } as UIMessage
    const clean = { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'done' }] } as UIMessage

    expect(uiMessageContentKey(repeated)).toBe(uiMessageContentKey(clean))
  })
})
