export const WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT = "boring-workspace:open-app-left-overlay"

const SAFE_APP_LEFT_OVERLAY_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/

export interface AppLeftOverlayRequest {
  id: string
  params?: Readonly<Record<string, string>>
}

export function appLeftOverlayRequestFromEvent(event: Event): AppLeftOverlayRequest | null {
  const detail = (event as CustomEvent<unknown>).detail as { id?: unknown; params?: unknown } | undefined
  const id = typeof detail?.id === "string" ? detail.id.trim() : ""
  if (!SAFE_APP_LEFT_OVERLAY_ID.test(id)) return null
  if (detail?.params === undefined) return { id }
  if (!detail.params || typeof detail.params !== "object" || Array.isArray(detail.params)) return null
  const entries = Object.entries(detail.params)
  if (entries.length > 16 || entries.some(([key, value]) => !key || key.length > 64 || typeof value !== "string" || value.length > 1024)) return null
  return { id, params: Object.fromEntries(entries) as Record<string, string> }
}

export function appLeftOverlayIdFromEvent(event: Event): string | null {
  return appLeftOverlayRequestFromEvent(event)?.id ?? null
}

export function requestAppLeftOverlay(id: string, params?: Readonly<Record<string, string>>): boolean {
  const normalized = id.trim()
  const browserWindow = (globalThis as typeof globalThis & { window?: { dispatchEvent(event: Event): boolean } }).window
  if (!browserWindow || !SAFE_APP_LEFT_OVERLAY_ID.test(normalized)) return false
  browserWindow.dispatchEvent(new CustomEvent(WORKSPACE_OPEN_APP_LEFT_OVERLAY_EVENT, { detail: { id: normalized, ...(params ? { params } : {}) } }))
  return true
}
