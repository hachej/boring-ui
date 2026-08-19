import { events, remoteMeta, workspaceEvents } from "../events"

export function dispatchUiStateInvalidation(params: unknown): boolean {
  if (!params || typeof params !== "object" || Array.isArray(params)) return false
  const keys = (params as Record<string, unknown>).keys
  if (!Array.isArray(keys) || keys.length === 0 || keys.some((key) => typeof key !== "string" || key.length === 0)) {
    return false
  }
  events.emit(workspaceEvents.uiStateInvalidated, { ...remoteMeta(), keys })
  return true
}
