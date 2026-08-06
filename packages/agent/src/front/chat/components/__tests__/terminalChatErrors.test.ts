import { describe, expect, test } from 'vitest'
import {
  filterCompetingNoiseNotices,
  hasTerminalChatError,
  isTerminalChatErrorId,
  isTerminalChatErrorNotice,
} from '../terminalChatErrors'

describe('terminalChatErrors', () => {
  test.each(['chat-error', 'session-navigation-error'])('treats %s as a terminal chat error id', (id) => {
    expect(isTerminalChatErrorId(id)).toBe(true)
  })

  test.each(['protocol-error', 'connection-reconnecting', 'auto-retry', 'large-state-warning', 'command:foo'])(
    'does not treat %s as a terminal chat error id (protocol-error self-clears on reconnect)',
    (id) => {
      expect(isTerminalChatErrorId(id)).toBe(false)
    },
  )

  test('isTerminalChatErrorNotice requires both a terminal id and an empty transcript', () => {
    expect(isTerminalChatErrorNotice('chat-error', true)).toBe(true)
    expect(isTerminalChatErrorNotice('chat-error', false)).toBe(false)
    expect(isTerminalChatErrorNotice('connection-reconnecting', true)).toBe(false)
  })

  test('hasTerminalChatError finds a terminal id anywhere in the list, only when history is empty', () => {
    expect(hasTerminalChatError([{ id: 'connection-reconnecting' }, { id: 'chat-error' }], true)).toBe(true)
    expect(hasTerminalChatError([{ id: 'connection-reconnecting' }, { id: 'chat-error' }], false)).toBe(false)
    expect(hasTerminalChatError([{ id: 'connection-reconnecting' }, { id: 'auto-retry' }], true)).toBe(false)
    expect(hasTerminalChatError([], true)).toBe(false)
  })

  describe('filterCompetingNoiseNotices', () => {
    test('drops connection-reconnecting and auto-retry once a terminal notice is present and history is empty', () => {
      const notices = [
        { id: 'connection-reconnecting' },
        { id: 'auto-retry' },
        { id: 'chat-error' },
      ]
      expect(filterCompetingNoiseNotices(notices, true)).toEqual([{ id: 'chat-error' }])
    })

    test('keeps auto-retry-failed even alongside a terminal notice: it reports a real terminal retry failure', () => {
      const notices = [
        { id: 'connection-reconnecting' },
        { id: 'auto-retry-failed' },
        { id: 'session-navigation-error' },
      ]
      expect(filterCompetingNoiseNotices(notices, true)).toEqual([
        { id: 'auto-retry-failed' },
        { id: 'session-navigation-error' },
      ])
    })

    test('renders reconnect/retry noise unchanged when no terminal notice is present', () => {
      const notices = [{ id: 'connection-reconnecting' }, { id: 'auto-retry' }]
      expect(filterCompetingNoiseNotices(notices, true)).toEqual(notices)
    })

    test('renders reconnect/retry noise unchanged when history is not empty, even with a chat-error notice', () => {
      const notices = [
        { id: 'connection-reconnecting' },
        { id: 'auto-retry' },
        { id: 'chat-error' },
      ]
      expect(filterCompetingNoiseNotices(notices, false)).toEqual(notices)
    })
  })
})
