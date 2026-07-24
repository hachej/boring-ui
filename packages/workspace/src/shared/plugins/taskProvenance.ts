export const WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT = "boring-workspace:task-provenance-changed" as const

export function emitWorkspaceTaskProvenanceChanged(browserWindow: Pick<Window, "dispatchEvent"> | undefined = globalThis.window): boolean {
  if (!browserWindow) return false
  browserWindow.dispatchEvent(new Event(WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT))
  return true
}
