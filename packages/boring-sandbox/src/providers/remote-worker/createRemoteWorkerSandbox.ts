import type { ExecOptions, Sandbox } from '@hachej/boring-agent/shared'
import {
  REMOTE_WORKER_PROVIDER,
  REMOTE_WORKER_RUNTIME_CWD,
  type RemoteWorkerExecRequest,
} from '../../shared/remoteWorkerProtocol'
import type { RemoteWorkerClient } from './workerClient'

function filteredEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export function createRemoteWorkerSandbox(client: RemoteWorkerClient): Sandbox {
  return {
    id: REMOTE_WORKER_PROVIDER,
    placement: 'remote',
    provider: REMOTE_WORKER_PROVIDER,
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: REMOTE_WORKER_RUNTIME_CWD },
    async init() {
      await client.health()
    },
    async exec(cmd: string, opts: ExecOptions = {}) {
      const request: RemoteWorkerExecRequest = {
        cmd,
        cwd: opts.cwd,
        env: filteredEnv(opts.env),
        timeoutMs: opts.timeoutMs,
        maxOutputBytes: opts.maxOutputBytes,
      }
      const startedAt = Date.now()
      const heartbeat = opts.onHeartbeat
        ? setInterval(() => opts.onHeartbeat?.(Date.now() - startedAt), 1_000)
        : null
      try {
        const result = await client.exec(request, { signal: opts.signal })
        opts.onStdout?.(result.stdout)
        opts.onStderr?.(result.stderr)
        return result
      } finally {
        if (heartbeat) clearInterval(heartbeat)
      }
    },
  }
}
