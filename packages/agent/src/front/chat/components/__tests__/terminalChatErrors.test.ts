import { describe, expect, test } from 'vitest'
import { hasTerminalChatError, isTerminalChatErrorId } from '../terminalChatErrors'

describe('terminalChatErrors', () => {
  test.each(['chat-error', 'protocol-error', 'session-navigation-error'])('treats %s as a terminal chat error id', (id) => {
    expect(isTerminalChatErrorId(id)).toBe(true)
  })

  test.each(['connection-reconnecting', 'auto-retry', 'large-state-warning', 'command:foo'])(
    'does not treat %s as a terminal chat error id',
    (id) => {
      expect(isTerminalChatErrorId(id)).toBe(false)
    },
  )

  test('hasTerminalChatError finds a terminal id anywhere in the list', () => {
    expect(hasTerminalChatError([{ id: 'connection-reconnecting' }, { id: 'chat-error' }])).toBe(true)
    expect(hasTerminalChatError([{ id: 'connection-reconnecting' }, { id: 'auto-retry' }])).toBe(false)
    expect(hasTerminalChatError([])).toBe(false)
  })
})
