/**
 * Notice ids that represent a "terminal" chat error: the transcript itself
 * failed to load (session lookup, history hydrate, protocol desync), as
 * opposed to transient noise (reconnect attempts, warmup, retries) that
 * resolves on its own. These get plain-language presentation with
 * collapsible technical details and an explicit recovery action, and they
 * suppress competing reconnect/warmup notices so the two don't contradict
 * each other in the timeline.
 */
export const TERMINAL_CHAT_ERROR_IDS = new Set(['chat-error', 'protocol-error', 'session-navigation-error'])

export function isTerminalChatErrorId(id: string): boolean {
  return TERMINAL_CHAT_ERROR_IDS.has(id)
}

export function hasTerminalChatError(notices: ReadonlyArray<{ id: string }>): boolean {
  return notices.some((notice) => isTerminalChatErrorId(notice.id))
}
