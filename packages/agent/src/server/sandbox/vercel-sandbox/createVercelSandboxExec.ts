import { posix } from 'node:path'
import { Writable } from 'node:stream'
import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type { ExecResult, Sandbox } from '../../../shared/sandbox'
import {
  invalidateVercelSandboxWorkspaceMetadataCache,
  VERCEL_SANDBOX_RUNTIME_CONTEXT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '../../workspace/createVercelSandboxWorkspace'
import { withWorkspacePythonEnv } from '../workspacePythonEnv'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
const VERCEL_SANDBOX_DEFAULT_PATH = '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/vercel/runtimes/python/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

interface CaptureState {
  totalBytes: number
  maxBytes: number
  truncated: boolean
}

interface StreamCollector {
  chunks: Buffer[]
}

function createStreamWritable(
  collector: StreamCollector,
  shared: CaptureState,
  onChunk?: (chunk: Uint8Array) => void,
): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, cb) {
      const remaining = shared.maxBytes - shared.totalBytes
      if (remaining <= 0) {
        shared.truncated = true
        cb()
        return
      }

      if (chunk.length > remaining) {
        const partial = chunk.subarray(0, remaining)
        collector.chunks.push(partial)
        shared.totalBytes += remaining
        shared.truncated = true
        onChunk?.(new Uint8Array(partial))
        cb()
        return
      }

      collector.chunks.push(chunk)
      shared.totalBytes += chunk.length
      onChunk?.(new Uint8Array(chunk))
      cb()
    },
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

function normalizeVercelCwd(cwd: string | undefined): string {
  const requested = cwd ?? VERCEL_SANDBOX_WORKSPACE_ROOT
  if (!posix.isAbsolute(requested)) throw new Error(`Vercel sandbox cwd must be absolute: ${requested}`)
  const normalized = posix.normalize(requested)
  if (normalized !== VERCEL_SANDBOX_WORKSPACE_ROOT && !normalized.startsWith(`${VERCEL_SANDBOX_WORKSPACE_ROOT}/`)) {
    throw new Error(`Vercel sandbox cwd must stay under ${VERCEL_SANDBOX_WORKSPACE_ROOT}: ${requested}`)
  }
  return normalized
}

function toRemoteEnv(env: Record<string, string> | undefined): Record<string, string> {
  const baseEnv = {
    ...(env ?? {}),
    PATH: env?.PATH ? `${env.PATH}:${VERCEL_SANDBOX_DEFAULT_PATH}` : VERCEL_SANDBOX_DEFAULT_PATH,
  }
  return Object.fromEntries(
    Object.entries(withWorkspacePythonEnv({
      workspaceRoot: VERCEL_SANDBOX_WORKSPACE_ROOT,
      env: baseEnv,
    })).filter((entry): entry is [string, string] => entry[1] != null),
  )
}

export function createVercelSandboxExec(
  sandbox: VercelSandbox,
  execOpts: { onMutation?: () => void } = {},
): Sandbox {
  return {
    id: 'vercel-sandbox',
    placement: 'remote',
    provider: 'vercel-sandbox',
    capabilities: ['exec'],
    runtimeContext: VERCEL_SANDBOX_RUNTIME_CONTEXT,
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

      const captureState: CaptureState = { totalBytes: 0, maxBytes: maxOutputBytes, truncated: false }
      const stdoutCollector: StreamCollector = { chunks: [] }
      const stderrCollector: StreamCollector = { chunks: [] }

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

        const result = await sandbox.runCommand({
          cmd: 'sh',
          args: ['-c', cmd],
          cwd: normalizeVercelCwd(opts?.cwd),
          env: toRemoteEnv(opts?.env),
          signal: controller.signal,
          stdout: createStreamWritable(stdoutCollector, captureState, opts?.onStdout),
          stderr: createStreamWritable(stderrCollector, captureState, opts?.onStderr),
        })

        return {
          stdout: new Uint8Array(Buffer.concat(stdoutCollector.chunks)),
          stderr: new Uint8Array(Buffer.concat(stderrCollector.chunks)),
          exitCode: result.exitCode ?? 1,
          durationMs: Date.now() - start,
          truncated: captureState.truncated,
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
        execOpts.onMutation?.()
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (heartbeatHandle) clearInterval(heartbeatHandle)
        externalSignal?.removeEventListener('abort', abortFromExternalSignal)
      }
    },
  }
}
