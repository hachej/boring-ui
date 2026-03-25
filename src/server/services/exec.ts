/**
 * Exec service — transport-independent business logic for command execution.
 * The BwrapBackend provides sandboxed execution via bubblewrap.
 */

export interface ExecResult {
  stdout: string
  stderr: string
  exit_code: number
}

export interface ExecServiceDeps {
  workspaceRoot: string
  bwrapEnabled: boolean
}

export interface ExecService {
  exec(command: string, cwd?: string): Promise<ExecResult>
  pythonExec(code: string, cwd?: string): Promise<ExecResult>
}

export function createExecService(_deps: ExecServiceDeps): ExecService {
  throw new Error('Not implemented — see bd-qvv02.1 (Phase 2: BwrapBackend)')
}
