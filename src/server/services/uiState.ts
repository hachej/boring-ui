/**
 * UI State service — persists frontend UI state on the server.
 * Mirrors Python's modules/ui_state/router.py.
 */

export interface UIStateService {
  get(key: string): Promise<unknown | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  list(): Promise<string[]>
}

export function createUIStateService(_workspaceRoot: string): UIStateService {
  throw new Error('Not implemented — see Phase 2/4 UI state beads')
}
