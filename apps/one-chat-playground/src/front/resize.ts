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

/** Mobile: chat is a bottom sheet; its height is clamped the same way. */
export const CHAT_HEIGHT_DEFAULT_RATIO = 0.42
export const CHAT_HEIGHT_MIN = 160
export const STAGE_MIN_HEIGHT = 220
export const CHAT_HEIGHT_STORAGE_KEY = 'one-chat.chat-height'

export function clampChatHeight(height: number, viewportHeight: number): number {
  const fallback = Math.round(viewportHeight * CHAT_HEIGHT_DEFAULT_RATIO)
  if (!Number.isFinite(height)) return fallback
  const max = Math.max(CHAT_HEIGHT_MIN, viewportHeight - STAGE_MIN_HEIGHT)
  return Math.round(Math.min(max, Math.max(CHAT_HEIGHT_MIN, height)))
}

export function readStoredChatHeight(viewportHeight: number): number {
  try {
    const raw = window.localStorage.getItem(CHAT_HEIGHT_STORAGE_KEY)
    if (raw === null) return clampChatHeight(Number.NaN, viewportHeight)
    return clampChatHeight(Number(raw), viewportHeight)
  } catch {
    return clampChatHeight(Number.NaN, viewportHeight)
  }
}

export function storeChatHeight(height: number): void {
  try {
    window.localStorage.setItem(CHAT_HEIGHT_STORAGE_KEY, String(height))
  } catch {
    // Storage is a convenience; the layout works without it.
  }
}
