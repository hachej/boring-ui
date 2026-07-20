export const WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT = "boring-workspace:open-app-left-overlay"

const SAFE_APP_LEFT_OVERLAY_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/

export function appLeftOverlayIdFromEvent(event: Event): string | null {
  const detail = (event as CustomEvent<unknown>).detail as { id?: unknown } | undefined
  const id = typeof detail?.id === "string" ? detail.id.trim() : ""
  return SAFE_APP_LEFT_OVERLAY_ID.test(id) ? id : null
}

export function requestAppLeftOverlay(id: string): boolean {
  const normalized = id.trim()
  const browserWindow = (globalThis as typeof globalThis & { window?: { dispatchEvent(event: Event): boolean } }).window
  if (!browserWindow || !SAFE_APP_LEFT_OVERLAY_ID.test(normalized)) return false
  browserWindow.dispatchEvent(new CustomEvent(WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT, { detail: { id: normalized } }))
  return true
}
