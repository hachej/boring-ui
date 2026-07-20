import { spawn } from 'node:child_process'

import type { WorkspaceRuntimeContext } from '../../../shared/runtime'
import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'
import { withWorkspacePythonEnv } from '@hachej/boring-bash/agent'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const TERMINATION_GRACE_MS = 5_000

interface CaptureState {
  capturedBytes: number
  maxBytes: number
  truncated: boolean
}

function appendOutput(
  chunks: Buffer[],
  chunk: Buffer,
  state: CaptureState,
  onChunk?: (chunk: Uint8Array) => void,
): void {
  const remaining = state.maxBytes - state.capturedBytes
  if (remaining <= 0) {
    state.truncated = true
    return
  }

  if (chunk.length > remaining) {
    const partial = chunk.subarray(0, remaining)
    chunks.push(partial)
    state.capturedBytes += remaining
    state.truncated = true
    onChunk?.(new Uint8Array(partial))
    return
  }

  chunks.push(chunk)
  state.capturedBytes += chunk.length
  onChunk?.(new Uint8Array(chunk))
}


function terminateProcess(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid
  if (!pid) return

  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      // Fall back to direct child kill.
    }
  }

  try {
    child.kill(signal)
  } catch {
    // Process may have already exited.
  }
}

export interface CreateDirectSandboxOptions {
  runtimeContext?: WorkspaceRuntimeContext
}

export function createDirectSandbox(opts: CreateDirectSandboxOptions = {}): Sandbox {
  let workspace: Workspace | null = null
  let runtimeContext = opts.runtimeContext ?? { runtimeCwd: process.cwd() }

  return {
    id: 'direct',
    placement: 'server',
    provider: 'direct',
    capabilities: ['exec'],
    get runtimeContext() {
      return runtimeContext
    },
    async init(ctx) {
      workspace = ctx.workspace
      runtimeContext = opts.runtimeContext ?? ctx.workspace.runtimeContext
    },
    async exec(cmd, opts) {
      if (!workspace) {
        throw new Error('DirectSandbox not initialized')
      }

      const start = Date.now()
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
      const workspaceRoot = runtimeContext.runtimeCwd
      const cwd = opts?.cwd ?? workspaceRoot

      return await new Promise((resolve, reject) => {
        const child = spawn(cmd, {
          cwd,
          env: withWorkspacePythonEnv({ workspaceRoot, env: opts?.env, preserveHostHome: true }),
          shell: true,
          windowsHide: true,
          detached: process.platform !== 'win32',
        })

        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        const captureState: CaptureState = {
          capturedBytes: 0,
          maxBytes: maxOutputBytes,
          truncated: false,
        }

        let timeoutHandle: NodeJS.Timeout | null = null
        let killHandle: NodeJS.Timeout | null = null
        let heartbeatHandle: NodeJS.Timeout | null = null
        let timedOut = false
        let settled = false

        const cleanup = (): void => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          if (killHandle) clearTimeout(killHandle)
          if (heartbeatHandle) clearInterval(heartbeatHandle)
        }

        const settle = (exitCode: number | null): void => {
          if (settled) return
          settled = true
          cleanup()

          resolve({
            stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
            stderr: new Uint8Array(Buffer.concat(stderrChunks)),
            exitCode: typeof exitCode === 'number' ? exitCode : timedOut ? 124 : 1,
            durationMs: Date.now() - start,
            truncated: captureState.truncated,
            stdoutEncoding: 'utf-8',
            stderrEncoding: 'utf-8',
          })
        }

        child.stdout?.on('data', (chunk: Buffer) => {
          appendOutput(stdoutChunks, chunk, captureState, opts?.onStdout)
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          appendOutput(stderrChunks, chunk, captureState, opts?.onStderr)
        })

        child.on('error', (error) => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        })

        child.on('close', (code) => {
          settle(code)
        })

        timeoutHandle = setTimeout(() => {
          timedOut = true
          terminateProcess(child, 'SIGTERM')
          killHandle = setTimeout(() => {
            if (!settled) terminateProcess(child, 'SIGKILL')
          }, TERMINATION_GRACE_MS)
        }, timeoutMs)

        if (opts?.onHeartbeat) {
          heartbeatHandle = setInterval(() => {
            opts.onHeartbeat?.(Date.now() - start)
          }, 1_000)
        }

        if (opts?.signal) {
          const abort = (): void => {
            terminateProcess(child, 'SIGTERM')
            killHandle = setTimeout(() => {
              if (!settled) terminateProcess(child, 'SIGKILL')
            }, TERMINATION_GRACE_MS)
          }

          if (opts.signal.aborted) {
            abort()
          } else {
            opts.signal.addEventListener('abort', abort, { once: true })
            child.on('close', () => {
              opts.signal?.removeEventListener('abort', abort)
            })
          }
        }
      })
    },
  }
}
