import type { Entry, ExecResult, Stat, WorkspaceChangeEvent } from './contracts'

export const REMOTE_WORKER_RUNTIME_CWD = '/workspace'
export const REMOTE_WORKER_PROVIDER = 'remote-worker'

export const WORKER_INTERNAL_TOKEN_HEADER = 'x-boring-internal-token'
export const WORKER_WORKSPACE_ID_HEADER = 'x-boring-workspace-id'
export const WORKER_REQUEST_ID_HEADER = 'x-boring-request-id'

export const REMOTE_WORKER_ERROR_CODES = {
  ABORTED: 'ABORTED',
  STREAM_CLOSED: 'REMOTE_WORKER_STREAM_CLOSED',
  TIMEOUT: 'REMOTE_WORKER_TIMEOUT',
} as const

export type RemoteWorkerWorkspaceOp =
  | { op: 'readFile'; path: string }
  | { op: 'readBinaryFile'; path: string }
  | { op: 'writeFile'; path: string; data: string }
  | { op: 'writeBinaryFile'; path: string; dataBase64: string }
  | { op: 'readFileWithStat'; path: string }
  | { op: 'writeFileWithStat'; path: string; data: string }
  | { op: 'writeBinaryFileWithStat'; path: string; dataBase64: string }
  | { op: 'unlink'; path: string }
  | { op: 'readdir'; path: string }
  | { op: 'stat'; path: string }
  | { op: 'mkdir'; path: string; recursive?: boolean }
  | { op: 'rename'; from: string; to: string }

export type RemoteWorkerWorkspaceResult =
  | { content: string }
  | { dataBase64: string }
  | { stat: Stat }
  | { content: string; stat: Stat }
  | { entries: Entry[] }
  | { ok: true }

export interface RemoteWorkerExecRequest {
  cmd: string
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  maxOutputBytes?: number
}

export interface RemoteWorkerExecResponse extends Omit<ExecResult, 'stdout' | 'stderr'> {
  stdoutBase64: string
  stderrBase64: string
}

export interface RemoteWorkerErrorPayload {
  error: {
    code: string
    message: string
    statusCode?: number
    details?: unknown
  }
}

export interface RemoteWorkerFsEventEnvelope {
  event: WorkspaceChangeEvent
}
