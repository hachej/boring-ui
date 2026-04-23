import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type { ExecResult, Sandbox } from '../../../shared/sandbox'
import { invalidateVercelSandboxWorkspaceMetadataCache } from '../../workspace/createVercelSandboxWorkspace'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576

function truncateOutput(
  stdout: Uint8Array,
  stderr: Uint8Array,
  maxOutputBytes: number,
): { stdout: Uint8Array; stderr: Uint8Array; truncated: boolean } {
  if (stdout.length + stderr.length <= maxOutputBytes) {
    return { stdout, stderr, truncated: false }
  }

  let remaining = maxOutputBytes
  const stdoutSlice = stdout.subarray(0, Math.max(0, Math.min(stdout.length, remaining)))
  remaining -= stdoutSlice.length

  const stderrSlice = stderr.subarray(0, Math.max(0, Math.min(stderr.length, remaining)))
  return { stdout: stdoutSlice, stderr: stderrSlice, truncated: true }
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

export function createVercelSandboxExec(sandbox: VercelSandbox): Sandbox {
  return {
    id: 'vercel-sandbox',
    placement: 'server',
    capabilities: ['exec'],
    async init() {
      // Vercel sandbox handle is already established by runtime adapter.
    },
    async exec(cmd, opts) {
      const start = Date.now()
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

      let timedOut = false
      const controller = new AbortController()
      let timeoutHandle: NodeJS.Timeout | null = null
      let heartbeatHandle: NodeJS.Timeout | null = null
      const externalSignal = opts?.signal

      const abortFromExternalSignal = () => {
        controller.abort(externalSignal?.reason)
      }

      try {
        if (externalSignal) {
          if (externalSignal.aborted) {
            abortFromExternalSignal()
          } else {
            externalSignal.addEventListener('abort', abortFromExternalSignal, {
              once: true,
            })
          }
        }

        timeoutHandle = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)

        if (opts?.onHeartbeat) {
          heartbeatHandle = setInterval(() => {
            opts.onHeartbeat?.(Date.now() - start)
          }, 1_000)
        }

        const command = await sandbox.runCommand({
          cmd: 'sh',
          args: ['-c', cmd],
          cwd: opts?.cwd,
          env: opts?.env,
          signal: controller.signal,
        })

        const [stdoutText, stderrText] = await Promise.all([
          command.stdout(),
          command.stderr(),
        ])

        const stdout = new Uint8Array(Buffer.from(stdoutText, 'utf-8'))
        const stderr = new Uint8Array(Buffer.from(stderrText, 'utf-8'))
        const truncated = truncateOutput(stdout, stderr, maxOutputBytes)

        return {
          stdout: truncated.stdout,
          stderr: truncated.stderr,
          exitCode: command.exitCode ?? 1,
          durationMs: Date.now() - start,
          truncated: truncated.truncated,
          stdoutEncoding: 'utf-8',
          stderrEncoding: 'utf-8',
        }
      } catch (error) {
        if (timedOut) {
          return timeoutResult(Date.now() - start)
        }
        throw error
      } finally {
        invalidateVercelSandboxWorkspaceMetadataCache(sandbox)
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (heartbeatHandle) clearInterval(heartbeatHandle)
        externalSignal?.removeEventListener('abort', abortFromExternalSignal)
      }
    },
  }
}
