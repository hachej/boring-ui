/**
 * Chat-column width for the One Chat shell: a pure clamp plus the storage key.
 * The drag handle and keyboard both feed through `clampChatWidth`, so the
 * limits live in one place and are unit-tested.
 */
export const CHAT_WIDTH_DEFAULT = 400
export const CHAT_WIDTH_MIN = 280
/** The app must keep at least this much of the viewport. */
export const STAGE_MIN = 480
export const CHAT_WIDTH_STORAGE_KEY = 'one-chat.chat-width'

export function clampChatWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return CHAT_WIDTH_DEFAULT
  const max = Math.max(CHAT_WIDTH_MIN, viewportWidth - STAGE_MIN)
  return Math.round(Math.min(max, Math.max(CHAT_WIDTH_MIN, width)))
}

export function readStoredChatWidth(viewportWidth: number): number {
  try {
    const raw = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY)
    if (raw === null) return CHAT_WIDTH_DEFAULT
    return clampChatWidth(Number(raw), viewportWidth)
  } catch {
    return CHAT_WIDTH_DEFAULT
  }
}

export function storeChatWidth(width: number): void {
  try {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Storage is a convenience; the layout works without it.
  }
}
