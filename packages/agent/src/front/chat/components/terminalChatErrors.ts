/**
 * Notice ids that CAN represent a terminal chat error: the transcript failed
 * to load. `protocol-error` is deliberately excluded — it always pairs with
 * `connection.state = 'reconnecting'` and self-clears on the next
 * heartbeat/connect (see `clearProtocolError` in piChatReducer.ts), so it is
 * routine websocket noise recovering on its own, not a terminal failure.
 *
 * An id in this set is only genuinely terminal when the transcript is empty
 * (`historyEmpty`). The same 'chat-error' id can also carry a turn/send
 * failure (e.g. "model overloaded") that survives into `state.error` across a
 * later snapshot resync (piChatReducer.ts hydrateFromSnapshot copies
 * `snapshot.error` verbatim) even though real message history is present —
 * that's a normal mid-conversation error, not "history unavailable", so it
 * keeps its own raw headline instead of the terminal presentation.
 */
export const TERMINAL_CHAT_ERROR_IDS = new Set(['chat-error', 'session-navigation-error'])

export function isTerminalChatErrorId(id: string): boolean {
  return TERMINAL_CHAT_ERROR_IDS.has(id)
}

/** True only when `id` is a terminal-error id AND the transcript is empty. */
export function isTerminalChatErrorNotice(id: string, historyEmpty: boolean): boolean {
  return historyEmpty && isTerminalChatErrorId(id)
}

export function hasTerminalChatError(notices: ReadonlyArray<{ id: string }>, historyEmpty: boolean): boolean {
  return historyEmpty && notices.some((notice) => isTerminalChatErrorId(notice.id))
}

/**
 * Notice ids that are pure connectivity/retry noise: accurate on their own,
 * but redundant once a terminal chat error notice already explains why
 * nothing is happening. Kept as an explicit set (not a substring match) and
 * deliberately excludes 'auto-retry-failed', which reports a real terminal
 * retry failure and should keep showing alongside a terminal chat error.
 */
const COMPETING_NOISE_NOTICE_IDS = new Set(['connection-reconnecting', 'auto-retry'])

/**
 * Drops competing reconnect/retry noise once a terminal chat error is
 * present and the transcript is empty. No-op otherwise (including whenever
 * `historyEmpty` is false, e.g. a mid-conversation turn error resurfaced via
 * `chat-error` — see the module doc above).
 */
export function filterCompetingNoiseNotices<T extends { id: string }>(notices: T[], historyEmpty: boolean): T[] {
  if (!hasTerminalChatError(notices, historyEmpty)) return notices
  return notices.filter((notice) => !COMPETING_NOISE_NOTICE_IDS.has(notice.id))
}
