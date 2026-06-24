import { createServerFileSearch } from '../createServerFileSearch'
import type { RuntimeModeAdapter } from '../mode'
import { createRemoteWorkerSandbox } from '../../sandbox/remote-worker/createRemoteWorkerSandbox'
import { RemoteWorkerClient, type RemoteWorkerClientOptions } from '../../sandbox/remote-worker/workerClient'
import { createRemoteWorkerWorkspace } from '../../workspace/createRemoteWorkerWorkspace'
import { REMOTE_WORKER_PROVIDER, REMOTE_WORKER_RUNTIME_CWD } from '../../sandbox/remote-worker/protocol'
import { getEnv } from '../../config/env'

export interface RemoteWorkerModeAdapterOptions {
  baseUrl?: string
  token?: string
  fetchImpl?: RemoteWorkerClientOptions['fetchImpl']
}

function requireOption(value: string | undefined, name: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${name} is required for remote-worker mode`)
  return trimmed
}

export function createRemoteWorkerModeAdapter(opts: RemoteWorkerModeAdapterOptions = {}): RuntimeModeAdapter {
  return {
    id: REMOTE_WORKER_PROVIDER,
    workspaceFsCapability: 'best-effort',
    async create(ctx) {
      const workspaceId = requireOption(ctx.workspaceId ?? ctx.sessionId, 'workspaceId')
      const client = new RemoteWorkerClient({
        baseUrl: requireOption(opts.baseUrl ?? getEnv('BORING_WORKER_BASE_URL'), 'BORING_WORKER_BASE_URL'),
        token: requireOption(opts.token ?? getEnv('BORING_WORKER_INTERNAL_TOKEN'), 'BORING_WORKER_INTERNAL_TOKEN'),
        workspaceId,
        requestId: ctx.requestId,
        fetchImpl: opts.fetchImpl,
      })
      const workspace = createRemoteWorkerWorkspace(client)
      const sandbox = createRemoteWorkerSandbox(client)
      await sandbox.init?.({ workspace, sessionId: ctx.sessionId })
      return {
        runtimeContext: { runtimeCwd: REMOTE_WORKER_RUNTIME_CWD },
        bash: { kind: 'remote' },
        filesystem: { kind: 'remote-workspace' },
        workspace,
        sandbox,
        fileSearch: createServerFileSearch(workspace, sandbox),
      }
    },
  }
}
