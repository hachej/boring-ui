import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

import type { Sandbox, Workspace, WorkspaceRuntimeContext } from '@hachej/boring-agent/shared'

import {
  BWRAP_TIMEOUT_SECONDS,
  KILL_GRACE_SECONDS,
  buildBwrapArgs,
} from './buildBwrapArgs'
import { getNodeWorkspaceHostRoot } from '../node-workspace/createNodeWorkspace'
import { withWorkspacePythonEnv } from '../node-workspace/workspacePythonEnv'

const DEFAULT_TIMEOUT_MS = BWRAP_TIMEOUT_SECONDS * 1_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const SANDBOX_HOME = '/workspace'

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

export function computeSandboxCwd(workspaceRoot: string, runtimeCwd: string, cwd?: string): string {
  if (!cwd) return runtimeCwd
  const normalizedRuntimeCwd = posix.normalize(runtimeCwd).replace(/\/+$/, '') || '/'
  if (cwd === normalizedRuntimeCwd) return normalizedRuntimeCwd
  if (cwd.startsWith(`${normalizedRuntimeCwd}/`)) {
    const normalizedCwd = posix.normalize(cwd)
    if (normalizedCwd === normalizedRuntimeCwd) return normalizedRuntimeCwd
    if (normalizedCwd.startsWith(`${normalizedRuntimeCwd}/`)) return normalizedCwd
    throw new Error('cwd must stay within workspace root')
  }

  const absoluteCwd = isAbsolute(cwd) ? cwd : resolve(workspaceRoot, cwd)
  const relPath = relative(workspaceRoot, absoluteCwd)
  if (relPath === '') return normalizedRuntimeCwd
  if (relPath === '..' || relPath.startsWith(`..${sep}`)) {
    throw new Error('cwd must stay within workspace root')
  }

  const posixRelPath = relPath.split(sep).join('/')
  return `${normalizedRuntimeCwd}/${posixRelPath}`
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function buildGlobalToolMounts(workspaceRoot: string): Promise<string[]> {
  const globalRoot = dirname(workspaceRoot)
  if (globalRoot === workspaceRoot) return []

  const args: string[] = []
  const mountIfChildLacks = async (runtimeRelPath: string): Promise<boolean> => {
    const parentRuntimePath = join(globalRoot, runtimeRelPath)
    const childRuntimePath = join(workspaceRoot, runtimeRelPath)

    if (!(await dirExists(parentRuntimePath))) return false
    if (await pathExists(childRuntimePath)) return false

    args.push('--ro-bind', parentRuntimePath, `${SANDBOX_HOME}/${runtimeRelPath}`)
    return true
  }

  const mountedParentAgentDir = await mountIfChildLacks('.boring-agent')
  if (!mountedParentAgentDir) {
    await mountIfChildLacks('.boring-agent/venv')
  }

  return args
}

export interface BwrapResourceLimits {
  cpuSeconds?: number
  fileSizeBlocks?: number
  maxProcesses?: number
  openFiles?: number
  virtualMemoryKb?: number
}

export interface CreateBwrapSandboxOptions {
  hostWorkspaceRoot?: string
  runtimeContext?: WorkspaceRuntimeContext
  network?: 'shared' | 'isolated'
  dropAllCapabilities?: boolean
  resourceLimits?: BwrapResourceLimits
}

function positiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return Math.floor(value)
}

function buildResourceLimitCommands(limits: BwrapResourceLimits | undefined): string[] {
  if (!limits) return []

  const commands: string[] = []
  const cpuSeconds = positiveInteger(limits.cpuSeconds, 'resourceLimits.cpuSeconds')
  const fileSizeBlocks = positiveInteger(limits.fileSizeBlocks, 'resourceLimits.fileSizeBlocks')
  const maxProcesses = positiveInteger(limits.maxProcesses, 'resourceLimits.maxProcesses')
  const openFiles = positiveInteger(limits.openFiles, 'resourceLimits.openFiles')
  const virtualMemoryKb = positiveInteger(limits.virtualMemoryKb, 'resourceLimits.virtualMemoryKb')

  if (cpuSeconds !== undefined) commands.push(`ulimit -t ${cpuSeconds}`)
  if (fileSizeBlocks !== undefined) commands.push(`ulimit -f ${fileSizeBlocks}`)
  if (maxProcesses !== undefined) commands.push(`ulimit -u ${maxProcesses}`)
  if (openFiles !== undefined) commands.push(`ulimit -n ${openFiles}`)
  if (virtualMemoryKb !== undefined) commands.push(`ulimit -v ${virtualMemoryKb}`)

  return commands
}

function buildCommandArgs(cmd: string, limits: BwrapResourceLimits | undefined): string[] {
  const limitCommands = buildResourceLimitCommands(limits)
  if (limitCommands.length === 0) return ['bash', '-c', cmd]

  return [
    'bash',
    '-c',
    `${limitCommands.join('\n')}\nexec bash -c "$1"`,
    'boring-exec',
    cmd,
  ]
}


export function createBwrapSandbox(opts: CreateBwrapSandboxOptions = {}): Sandbox {
  const sandboxOptions = opts
  let workspace: Workspace | null = null
  let hostWorkspaceRoot = sandboxOptions.hostWorkspaceRoot
  let runtimeContext = sandboxOptions.runtimeContext ?? { runtimeCwd: SANDBOX_HOME }

  return {
    id: 'bwrap',
    placement: 'server',
    provider: 'bwrap',
    capabilities: ['exec'],
    get runtimeContext() {
      return runtimeContext
    },
    async init(ctx) {
      workspace = ctx.workspace
      hostWorkspaceRoot = sandboxOptions.hostWorkspaceRoot ?? getNodeWorkspaceHostRoot(ctx.workspace) ?? ctx.workspace.root
      runtimeContext = sandboxOptions.runtimeContext ?? { runtimeCwd: SANDBOX_HOME }
      await assertBwrapAvailable()
    },
    async exec(cmd, opts) {
      if (!workspace) {
        throw new Error('BwrapSandbox not initialized')
      }

      const start = Date.now()
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
      const workspaceRoot = hostWorkspaceRoot ?? workspace.root
      const sandboxCwd = computeSandboxCwd(workspaceRoot, runtimeContext.runtimeCwd, opts?.cwd)
      const postWorkspaceArgs = await buildGlobalToolMounts(workspaceRoot)
      const baseArgs = buildBwrapArgs(workspaceRoot, {
        postWorkspaceArgs,
        network: sandboxOptions.network,
        dropAllCapabilities: sandboxOptions.dropAllCapabilities,
      })
      const args = [
        ...withSandboxCwd(baseArgs, sandboxCwd),
        ...buildCommandArgs(cmd, sandboxOptions.resourceLimits),
      ]

      return await new Promise((resolve, reject) => {
        const child = spawn('bwrap', args, {
          env: {
            ...withWorkspacePythonEnv({ workspaceRoot, env: opts?.env, sandboxRoot: SANDBOX_HOME }),
            PWD: sandboxCwd,
          },
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
