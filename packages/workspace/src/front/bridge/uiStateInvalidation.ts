import { events, remoteMeta, workspaceEvents } from "../events"

export function dispatchUiStateInvalidation(params: Record<string, unknown>): boolean {
  const keys = params.keys
  if (!Array.isArray(keys) || keys.length === 0 || keys.some((key) => typeof key !== "string" || key.length === 0)) {
    return false
  }
  events.emit(workspaceEvents.uiStateInvalidated, { ...remoteMeta(), keys })
  return true
}
