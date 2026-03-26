/**
 * BwrapBackend — sandboxed command execution via bubblewrap.
 *
 * Mirrors Python's exec/service.py bwrap flag construction.
 * Security-critical: exact flags and order matter.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export const BWRAP_TIMEOUT_SECONDS = 60
const KILL_GRACE_SECONDS = 5

// System directories to read-only bind into the sandbox
const RO_BIND_DIRS = ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc'].filter(
  (d) => existsSync(d),
)

/**
 * Build bwrap argument list.
 * The exact flags and order mirror the Python implementation.
 */
export function buildBwrapArgs(
  workspaceRoot: string,
  sandboxHome: string = '/workspace',
  cwd?: string,
): string[] {
  const args: string[] = [
    // Root filesystem
    '--tmpfs', '/',
    // Proc and dev
    '--proc', '/proc',
    '--dev', '/dev',
    // Temp
    '--tmpfs', '/tmp',
  ]

  // Read-only system directories
  for (const dir of RO_BIND_DIRS) {
    args.push('--ro-bind', dir, dir)
  }

  // Workspace (read-write)
  args.push('--bind', workspaceRoot, sandboxHome)

  // Working directory
  if (cwd) {
    args.push('--chdir', cwd)
  } else {
    args.push('--chdir', sandboxHome)
  }

  // Command separator
  args.push('--')

  return args
}

/**
 * Build environment variables for sandbox execution.
 */
export function buildSandboxEnv(
  sandboxHome: string = '/workspace',
): Record<string, string> {
  return {
    HOME: sandboxHome,
    PATH: `${sandboxHome}/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    VIRTUAL_ENV: `${sandboxHome}/.venv`,
    PYTHONUSERBASE: `${sandboxHome}/.local`,
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
  }
}

export interface ExecResult {
  stdout: string
  stderr: string
  exit_code: number
}

function terminateProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Ignore races where the process has already exited.
    }
  }
}

/**
 * Execute a command inside a bwrap sandbox.
 *
 * @param workspaceRoot — Host path to the workspace directory
 * @param command — Shell command to execute
 * @param options — Optional cwd and timeout
 */
export function execInSandbox(
  workspaceRoot: string,
  command: string,
  options: { cwd?: string; timeoutSeconds?: number } = {},
): Promise<ExecResult> {
  const { cwd, timeoutSeconds = BWRAP_TIMEOUT_SECONDS } = options
  const sandboxHome = '/workspace'
  // Replace workspace root PREFIX with sandbox home (not arbitrary occurrences)
  const sandboxCwd = cwd && cwd.startsWith(workspaceRoot)
    ? sandboxHome + cwd.slice(workspaceRoot.length)
    : sandboxHome

  const bwrapArgs = buildBwrapArgs(workspaceRoot, sandboxHome, sandboxCwd)
  const env = buildSandboxEnv(sandboxHome)

  return new Promise((resolve) => {
    const proc = spawn('bwrap', [...bwrapArgs, 'sh', '-c', command], {
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let killed = false
    let forceKillTimeout: NodeJS.Timeout | undefined

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    // Timeout handling
    const timeout = setTimeout(() => {
      killed = true
      terminateProcessGroup(proc.pid, 'SIGTERM')
      // Grace period
      forceKillTimeout = setTimeout(() => {
        terminateProcessGroup(proc.pid, 'SIGKILL')
      }, KILL_GRACE_SECONDS * 1000)
    }, timeoutSeconds * 1000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (forceKillTimeout) clearTimeout(forceKillTimeout)
      if (killed) {
        stderr += `\n[killed: timeout after ${timeoutSeconds}s]`
      }
      resolve({
        stdout,
        stderr,
        exit_code: killed ? -1 : (code ?? -1),
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      if (forceKillTimeout) clearTimeout(forceKillTimeout)
      resolve({
        stdout,
        stderr: stderr + `\n[error: ${err.message}]`,
        exit_code: -1,
      })
    })
  })
}
