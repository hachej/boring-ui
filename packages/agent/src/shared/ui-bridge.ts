export interface UiBridge {
  getState(): Promise<UiState | null>
  setState(state: UiState): Promise<void>
  postCommand(cmd: UiCommand): Promise<CommandResult>
  subscribeCommands(handler: (cmd: UiCommand & { seq: number }) => void): () => void
}

export type UiState = Record<string, unknown>

export type UiCommand =
  | { kind: 'openFile'; params: { path: string; mode?: 'view' | 'edit' | 'diff' } }
  | { kind: 'openPanel'; params: { id: string; component: string; params?: Record<string, unknown> } }
  | { kind: 'closePanel'; params: { id: string } }
  | { kind: 'showNotification'; params: { msg: string; level?: 'info' | 'warn' | 'error' } }
  | { kind: 'navigateToLine'; params: { file: string; line: number } }
  | { kind: 'expandToFile'; params: { path: string } }
  | { kind: string; params: Record<string, unknown> }

export interface CommandResult {
  seq: number
  status: 'ok' | 'error'
  error?: { code: string; message: string }
}
