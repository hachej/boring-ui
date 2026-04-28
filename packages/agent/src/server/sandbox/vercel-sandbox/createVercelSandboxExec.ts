import { Writable } from 'node:stream'
import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type { ExecResult, Sandbox } from '../../../shared/sandbox'
import { invalidateVercelSandboxWorkspaceMetadataCache } from '../../workspace/createVercelSandboxWorkspace'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576

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

export function createVercelSandboxExec(sandbox: VercelSandbox): Sandbox {
  return {
    id: 'vercel-sandbox',
    placement: 'remote',
    provider: 'vercel-sandbox',
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
          cwd: opts?.cwd,
          env: opts?.env,
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
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (heartbeatHandle) clearInterval(heartbeatHandle)
        externalSignal?.removeEventListener('abort', abortFromExternalSignal)
      }
    },
  }
}
