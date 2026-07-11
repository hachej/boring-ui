export interface WorkspaceRuntimeContext {
  readonly runtimeCwd: string
}

export type SandboxCapability =
  | 'exec'
  | 'isolated-code'
  | (string & {})

export type SandboxPlacement = 'server' | 'remote' | 'browser'

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
  onHeartbeat?: (elapsedMs: number) => void
  onStdout?: (chunk: Uint8Array) => void
  onStderr?: (chunk: Uint8Array) => void
}

export interface ExecResult {
  stdout: Uint8Array
  stderr: Uint8Array
  exitCode: number
  durationMs: number
  truncated: boolean
  stdoutEncoding?: 'utf-8' | 'binary'
  stderrEncoding?: 'utf-8' | 'binary'
}

export interface SandboxResources {
  cpuCores?: number
  memoryMb?: number
  gpu?: string
}

export interface IsolatedCodeInput {
  code: string
  language: 'python' | 'shell'
  image?: string
  packages?: string[]
  sandboxId?: string
  resources?: SandboxResources
  vendorHints?: Record<string, unknown>
}

export interface IsolatedCodeOutput {
  sandboxId: string
  stdout: string
  stderr: string
  exitCode: number
}

export interface Sandbox {
  readonly id: string
  readonly placement: SandboxPlacement
  readonly provider: string
  readonly capabilities: readonly SandboxCapability[]
  readonly runtimeContext: WorkspaceRuntimeContext
  init?(ctx: { workspace: Workspace; sessionId: string }): Promise<void>
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>
  executeIsolatedCode?(input: IsolatedCodeInput): Promise<IsolatedCodeOutput>
  dispose?(): Promise<void>
}

export type FsCapability = 'none' | 'best-effort' | 'strong'

export interface Entry {
  name: string
  kind: 'file' | 'dir'
}

export interface Stat {
  size: number
  mtimeMs: number
  kind: 'file' | 'dir'
}

export interface WorkspaceChangeEvent {
  op: 'write' | 'unlink' | 'rename' | 'mkdir'
  path: string
  oldPath?: string
  mtimeMs?: number
}

export type WorkspaceWatcherReadiness =
  | { ok: true }
  | { ok: false; reason: string; message?: string }

export interface WorkspaceWatchControlEvent {
  type: 'resync-required'
  reason: string
}

export interface WorkspaceWatchSubscribeOptions {
  onControlEvent?: (event: WorkspaceWatchControlEvent) => void
}

export interface WorkspaceWatcher {
  subscribe(
    listener: (event: WorkspaceChangeEvent) => void,
    options?: WorkspaceWatchSubscribeOptions,
  ): () => void
  whenReady?(): Promise<WorkspaceWatcherReadiness>
  close(): void
}

export interface Workspace {
  readonly root: string
  readonly runtimeContext: WorkspaceRuntimeContext
  readFile(relPath: string): Promise<string>
  readBinaryFile?(relPath: string): Promise<Uint8Array>
  writeFile(relPath: string, data: string): Promise<void>
  writeBinaryFile?(relPath: string, data: Uint8Array): Promise<void>
  readFileWithStat?(relPath: string): Promise<{ content: string; stat: Stat }>
  writeFileWithStat?(relPath: string, data: string): Promise<Stat>
  writeBinaryFileWithStat?(relPath: string, data: Uint8Array): Promise<Stat>
  unlink(relPath: string): Promise<void>
  readdir(relPath: string): Promise<Entry[]>
  stat(relPath: string): Promise<Stat>
  mkdir(relPath: string, opts?: { recursive?: boolean }): Promise<void>
  rename(fromRelPath: string, toRelPath: string): Promise<void>
  watch?(): WorkspaceWatcher
  readonly fsCapability?: FsCapability
}
