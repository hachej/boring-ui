import { spawn } from 'node:child_process'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'
import {
  BWRAP_TIMEOUT_SECONDS,
  KILL_GRACE_SECONDS,
  buildBwrapArgs,
} from './buildBwrapArgs'

const DEFAULT_TIMEOUT_MS = BWRAP_TIMEOUT_SECONDS * 1_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const SANDBOX_HOME = '/workspace'

interface CaptureState {
  capturedBytes: number
  maxBytes: number
  truncated: boolean
}

function appendOutput(chunks: Buffer[], chunk: Buffer, state: CaptureState): void {
  const remaining = state.maxBytes - state.capturedBytes
  if (remaining <= 0) {
    state.truncated = true
    return
  }

  if (chunk.length > remaining) {
    chunks.push(chunk.subarray(0, remaining))
    state.capturedBytes += remaining
    state.truncated = true
    return
  }

  chunks.push(chunk)
  state.capturedBytes += chunk.length
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

function computeSandboxCwd(workspaceRoot: string, cwd?: string): string {
  if (!cwd) return SANDBOX_HOME

  const absoluteCwd = isAbsolute(cwd) ? cwd : resolve(workspaceRoot, cwd)
  const relPath = relative(workspaceRoot, absoluteCwd)
  if (relPath === '') return SANDBOX_HOME
  if (relPath === '..' || relPath.startsWith(`..${sep}`)) {
    throw new Error('cwd must stay within workspace root')
  }

  const posixRelPath = relPath.split(sep).join('/')
  return `${SANDBOX_HOME}/${posixRelPath}`
}

function withSandboxCwd(baseArgs: string[], sandboxCwd: string): string[] {
  const args = [...baseArgs]
  const chdirIndex = args.indexOf('--chdir')
  if (chdirIndex === -1 || chdirIndex + 1 >= args.length) {
    throw new Error('buildBwrapArgs must include --chdir <path>')
  }
  args[chdirIndex + 1] = sandboxCwd
  return args
}

async function assertBwrapAvailable(): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('bwrap', ['--version'], { stdio: 'ignore' })
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      rejectPromise(error)
    }

    const succeed = (): void => {
      if (settled) return
      settled = true
      resolvePromise()
    }

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        fail(
          new Error(
            'bubblewrap binary "bwrap" not found on PATH; install bubblewrap to use local mode',
          ),
        )
        return
      }
      fail(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        succeed()
        return
      }
      fail(new Error(`bubblewrap availability check failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

export function createBwrapSandbox(): Sandbox {
  let workspace: Workspace | null = null

  return {
    id: 'bwrap',
    placement: 'server',
    capabilities: ['exec'],
    async init(ctx) {
      workspace = ctx.workspace
      await assertBwrapAvailable()
    },
    async exec(cmd, opts) {
      if (!workspace) {
        throw new Error('BwrapSandbox not initialized')
      }

      const start = Date.now()
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
      const sandboxCwd = computeSandboxCwd(workspace.root, opts?.cwd)
      const baseArgs = buildBwrapArgs(workspace.root)
      const args = [
        ...withSandboxCwd(baseArgs, sandboxCwd),
        'bash',
        '-c',
        cmd,
      ]

      return await new Promise((resolve, reject) => {
        const child = spawn('bwrap', args, {
          env: { ...process.env, ...opts?.env },
          stdio: ['ignore', 'pipe', 'pipe'],
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
          appendOutput(stdoutChunks, chunk, captureState)
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          appendOutput(stderrChunks, chunk, captureState)
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
          }, KILL_GRACE_SECONDS * 1_000)
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
            }, KILL_GRACE_SECONDS * 1_000)
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
