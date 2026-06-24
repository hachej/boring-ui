export interface UiBridge {
  getState(): Promise<UiState | null>
  setState(state: UiState): Promise<void>
  /** Canonical UI command dispatch method. */
  postCommand(cmd: UiCommand): Promise<CommandResult>
  subscribeCommands(handler: (cmd: UiCommand & { seq: number }) => unknown): () => void
  drainCommands?(): Promise<Array<UiCommand & { seq: number }>>
}

export type WorkspaceBridge = UiBridge & {
  /** @deprecated Use postCommand. Kept as a compatibility alias for WorkspaceBridge RPC callers. */
  emitUiEffect(cmd: UiCommand): Promise<CommandResult>
}

export type UiState = Record<string, unknown>

export type UiCommand =
  | { kind: 'openFile'; params: { path: string; mode?: 'view' | 'edit' | 'diff' } }
  | { kind: 'openSurface'; params: { kind: string; target: string; meta?: Record<string, unknown> } }
  | { kind: 'openPanel'; params: { id: string; component: string; params?: Record<string, unknown> } }
  | { kind: 'closePanel'; params: { id: string } }
  | { kind: 'closeWorkbenchLeftPane'; params: Record<string, never> }
  | { kind: 'showNotification'; params: { msg: string; level?: 'info' | 'warn' | 'error' } }
  | { kind: 'navigateToLine'; params: { file: string; line: number } }
  | { kind: 'expandToFile'; params: { path: string } }
  | { kind: string; params: Record<string, unknown> }

export interface CommandResult {
  seq: number
  status: 'ok' | 'error'
  error?: { code: string; message: string }
}
