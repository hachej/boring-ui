import type { Workspace } from './workspace'

export type SandboxCapability = 'exec' | 'isolated-code'

export interface Sandbox {
  readonly id: string
  readonly placement: 'server' | 'browser'
  readonly capabilities: readonly SandboxCapability[]

  init(ctx: { workspace: Workspace; sessionId: string }): Promise<void>

  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>

  executeIsolatedCode?(input: IsolatedCodeInput): Promise<IsolatedCodeOutput>

  dispose?(): Promise<void>
}

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
  onHeartbeat?: (elapsedMs: number) => void
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

export interface IsolatedCodeInput {
  code: string
  language: 'python' | 'shell'
  image?: string
  packages?: string[]
  sandboxId?: string
  vmSize?: 'xxs' | 'xs' | 's' | 'm' | 'l'
}

export interface IsolatedCodeOutput {
  sandboxId: string
  stdout: string
  stderr: string
  exitCode: number
}
