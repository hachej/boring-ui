import type {
  Entry,
  Stat,
  Workspace,
  WorkspaceChangeEvent,
  WorkspaceWatcher,
  WorkspaceWatchSubscribeOptions,
} from '@hachej/boring-agent/shared'
import {
  REMOTE_WORKER_RUNTIME_CWD,
  type RemoteWorkerWorkspaceResult,
} from '../../shared/remoteWorkerProtocol'
import {
  decodeBytesFromWorker,
  encodeBytesForWorker,
  type RemoteWorkerClient,
} from './workerClient'

function expectContent(result: RemoteWorkerWorkspaceResult): string {
  if ('content' in result && typeof result.content === 'string') return result.content
  throw new Error('remote worker returned invalid file content response')
}

function expectData(result: RemoteWorkerWorkspaceResult): Uint8Array {
  if ('dataBase64' in result && typeof result.dataBase64 === 'string') return decodeBytesFromWorker(result.dataBase64)
  throw new Error('remote worker returned invalid binary response')
}

function expectStat(result: RemoteWorkerWorkspaceResult): Stat {
  if ('stat' in result && result.stat) return result.stat
  throw new Error('remote worker returned invalid stat response')
}

function expectEntries(result: RemoteWorkerWorkspaceResult): Entry[] {
  if ('entries' in result && Array.isArray(result.entries)) return result.entries
  throw new Error('remote worker returned invalid readdir response')
}

function createRemoteWatcher(client: RemoteWorkerClient): WorkspaceWatcher {
  const listeners = new Map<(event: WorkspaceChangeEvent) => void, WorkspaceWatchSubscribeOptions | undefined>()
  let stream: { close(): void } | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const clearReconnectTimer = (): void => {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const scheduleReconnect = (): void => {
    if (closed || listeners.size === 0 || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      ensureStream()
    }, 1_000)
  }

  const handleStreamEnd = (): void => {
    stream = null
    for (const options of [...listeners.values()]) {
      try {
        options?.onControlEvent?.({ type: 'resync-required', reason: 'remote_worker_stream_closed' })
      } catch {
        // Ignore listener control-channel errors.
      }
    }
    scheduleReconnect()
  }

  const ensureStream = (): void => {
    if (stream || closed || listeners.size === 0) return
    clearReconnectTimer()
    stream = client.watch((event) => {
      for (const listener of [...listeners.keys()]) {
        try { listener(event) } catch { /* ignore listener errors */ }
      }
    }, handleStreamEnd)
  }

  return {
    subscribe(listener, options) {
      if (closed) return () => {}
      listeners.set(listener, options)
      ensureStream()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          clearReconnectTimer()
          stream?.close()
          stream = null
        }
      }
    },
    close() {
      if (closed) return
      closed = true
      listeners.clear()
      clearReconnectTimer()
      stream?.close()
      stream = null
    },
  }
}

export function createRemoteWorkerWorkspace(client: RemoteWorkerClient): Workspace {
  let watcher: WorkspaceWatcher | null = null
  return {
    root: REMOTE_WORKER_RUNTIME_CWD,
    runtimeContext: { runtimeCwd: REMOTE_WORKER_RUNTIME_CWD },
    fsCapability: 'best-effort',
    watch() {
      watcher ??= createRemoteWatcher(client)
      return watcher
    },
    async readFile(path) {
      return expectContent(await client.workspace({ op: 'readFile', path }))
    },
    async readBinaryFile(path) {
      return expectData(await client.workspace({ op: 'readBinaryFile', path }))
    },
    async writeFile(path, data) {
      await client.workspace({ op: 'writeFile', path, data })
    },
    async writeBinaryFile(path, data) {
      await client.workspace({ op: 'writeBinaryFile', path, dataBase64: encodeBytesForWorker(data) })
    },
    async readFileWithStat(path) {
      const result = await client.workspace({ op: 'readFileWithStat', path })
      if ('content' in result && 'stat' in result) return { content: result.content, stat: result.stat }
      throw new Error('remote worker returned invalid readFileWithStat response')
    },
    async writeFileWithStat(path, data) {
      return expectStat(await client.workspace({ op: 'writeFileWithStat', path, data }))
    },
    async writeBinaryFileWithStat(path, data) {
      return expectStat(await client.workspace({ op: 'writeBinaryFileWithStat', path, dataBase64: encodeBytesForWorker(data) }))
    },
    async unlink(path) {
      await client.workspace({ op: 'unlink', path })
    },
    async readdir(path) {
      return expectEntries(await client.workspace({ op: 'readdir', path }))
    },
    async stat(path) {
      return expectStat(await client.workspace({ op: 'stat', path }))
    },
    async mkdir(path, opts) {
      await client.workspace({ op: 'mkdir', path, recursive: opts?.recursive })
    },
    async rename(from, to) {
      await client.workspace({ op: 'rename', from, to })
    },
  }
}
