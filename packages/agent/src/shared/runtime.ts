export interface WorkspaceRuntimeContext {
  /** Agent-visible working directory shared by file-tree and shell execution. */
  readonly runtimeCwd: string
}
