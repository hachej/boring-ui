import { describe, expect, test } from 'vitest'
import { parsePiChatNdjsonLine, parsePiChatReplayRangeError } from '../piChatStream'

describe('addressed Pi chat stream compatibility', () => {
  test('rejects an addressed envelope whose cursor disagrees with the Pi event', () => {
    const result = parsePiChatNdjsonLine(JSON.stringify({
      ref: { agentTypeId: 'alpha', sessionId: 'session-1' },
      seq: 2,
      event: { type: 'agent-end', seq: 1 },
    }))
    expect(result.type).toBe('schema-error')
  })

  test.each([
    ['AGENT_SESSION_REPLAY_GAP', 'replay_gap'],
    ['AGENT_SESSION_CURSOR_AHEAD', 'cursor_ahead'],
  ] as const)('maps %s onto the existing recovery contract', (code, type) => {
    expect(parsePiChatReplayRangeError(409, {
      error: { code, message: 'recover', details: { latestSeq: 8 } },
    })).toEqual({ type, latestSeq: 8 })
  })
})
