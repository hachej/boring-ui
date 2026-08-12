import type { ExecResult, Sandbox } from '@hachej/boring-agent/shared'
import { withWorkspacePythonEnv } from '../node-workspace/workspacePythonEnv'

import type {
  BlaxelProcessResult,
  BlaxelRemoteSandbox,
} from './client'
import { BLAXEL_WORKSPACE_ROOT } from './config'
import { isBlaxelAlreadyExited, isBlaxelTransient, normalizeBlaxelError } from './errors'
import {
  capUtf8Outputs,
  createBlaxelProcessName,
  normalizeBlaxelCwd,
  shellQuote,
} from './runtimeHelpers'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const POLL_MIN_MS = 50
const POLL_MAX_MS = 1_000
const KILL_GRACE_MS = 5_000
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped'])

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
    code: 'ABORTED',
  })
}

function timeoutResult(durationMs: number): ExecResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 124,
    durationMs,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
  }
}

function isTerminal(process: BlaxelProcessResult): boolean {
  return TERMINAL_STATUSES.has(process.status)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let handle: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        handle = setTimeout(() => resolve(undefined), timeoutMs) as unknown as ReturnType<typeof setTimeout>
      }),
    ])
  } finally {
    if (handle) clearTimeout(handle)
  }
}

function remoteEnv(env: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(withWorkspacePythonEnv({
    workspaceRoot: BLAXEL_WORKSPACE_ROOT,
    env: {
    ...(env ?? {}),
    PATH: env?.PATH ? `${env.PATH}:${DEFAULT_PATH}` : DEFAULT_PATH,
    },
  })).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

export interface BlaxelSandboxExec extends Sandbox {
  dispose(): Promise<void>
}

/**
 * Blaxel 0.3.11 has no server-side output cap and its log stream is line based.
 * Results therefore come from the terminal process record and Boring's one
 * combined byte budget is enforced locally (stdout first, then stderr).
 */
export function createBlaxelSandboxExec(
  remote: BlaxelRemoteSandbox,
  options: {
    onMutation?: () => void
    onDispose?: () => void
  } = {},
): BlaxelSandboxExec {
  const running = new Set<string>()
  let disposed = false

  async function kill(identifier: string): Promise<void> {
    try {
      await remote.process.kill(identifier)
    } catch (error) {
      if (!isBlaxelAlreadyExited(error)) throw normalizeBlaxelError(error)
    }
  }

  return {
    id: remote.name,
    placement: 'remote',
    provider: 'blaxel',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: BLAXEL_WORKSPACE_ROOT },
    async init() {
      // Provider creation already binds this process client to the Workspace.
    },
    async exec(command, opts) {
      if (disposed) throw new Error('Blaxel sandbox adapter is disposed')
      const startedAt = Date.now()
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
      const signal = opts?.signal
      const processName = createBlaxelProcessName()
      let identifier = processName
      let launchSettled = false
      let timedOut = false
      let heartbeat: ReturnType<typeof setInterval> | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      let rejectAbort!: (reason: unknown) => void
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject
      })

      const onAbort = () => {
        rejectAbort(abortReason(signal!))
        if (launchSettled) {
          void settleWithin(kill(identifier), KILL_GRACE_MS).catch(() => {})
        }
      }

      try {
        if (signal?.aborted) throw abortReason(signal)
        signal?.addEventListener('abort', onAbort, { once: true })
        const timedOutPromise = new Promise<'timeout'>((resolve) => {
          timeout = setTimeout(() => {
            timedOut = true
            resolve('timeout')
          }, timeoutMs)
        })
        if (opts?.onHeartbeat) {
          heartbeat = setInterval(() => opts.onHeartbeat?.(Date.now() - startedAt), 1_000)
        }

        const launchedPromise = remote.process.exec({
          name: processName,
          command: `sh -c ${shellQuote(command)}`,
          workingDir: normalizeBlaxelCwd(opts?.cwd),
          env: remoteEnv(opts?.env),
          keepAlive: true,
          timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)),
          waitForCompletion: false,
        })
        running.add(processName)
        void launchedPromise.then(async (launched) => {
          if (signal?.aborted || timedOut || disposed) {
            await settleWithin(kill(launched.pid || launched.name || processName), KILL_GRACE_MS)
          }
        }).catch(() => {})
        const launched = await Promise.race([launchedPromise, timedOutPromise, aborted])
        if (launched === 'timeout') {
          await settleWithin(kill(processName), KILL_GRACE_MS)
          return timeoutResult(Math.max(Date.now() - startedAt, timeoutMs))
        }
        let terminal = launched
        launchSettled = true
        identifier = terminal.pid || terminal.name || processName
        running.add(identifier)
        running.delete(processName)
        if (signal?.aborted) {
          await settleWithin(kill(identifier), KILL_GRACE_MS)
          throw abortReason(signal)
        }

        let intervalMs = POLL_MIN_MS
        while (!isTerminal(terminal)) {
          let next
          try {
            next = await Promise.race([
              wait(intervalMs).then(() => remote.process.get(identifier)),
              timedOutPromise,
              aborted,
            ])
          } catch (error) {
            if (!isBlaxelTransient(error)) throw error
            intervalMs = Math.min(POLL_MAX_MS, intervalMs * 2)
            continue
          }
          if (next === 'timeout') {
            await settleWithin(kill(identifier), KILL_GRACE_MS)
            return timeoutResult(Math.max(Date.now() - startedAt, timeoutMs))
          }
          terminal = next
          intervalMs = Math.min(POLL_MAX_MS, intervalMs * 2)
        }
        if (signal?.aborted) throw abortReason(signal)
        const capped = capUtf8Outputs(terminal.stdout ?? '', terminal.stderr ?? '', maxOutputBytes)
        return {
          ...capped,
          exitCode: terminal.exitCode ?? 1,
          durationMs: Date.now() - startedAt,
          stdoutEncoding: 'utf-8',
          stderrEncoding: 'utf-8',
        }
      } catch (error) {
        if (timedOut) return timeoutResult(Math.max(Date.now() - startedAt, timeoutMs))
        if (signal?.aborted) throw abortReason(signal)
        throw normalizeBlaxelError(error)
      } finally {
        if (heartbeat) clearInterval(heartbeat)
        if (timeout) clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        running.delete(identifier)
        options.onMutation?.()
      }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await Promise.allSettled([...running].map((identifier) => settleWithin(kill(identifier), KILL_GRACE_MS)))
      running.clear()
      options.onDispose?.()
    },
  }
}
