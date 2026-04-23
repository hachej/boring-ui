import { getEnv } from '../../config/env'

const SNAPSHOT_KEEP_ENV_VAR = 'BORING_AGENT_SNAPSHOT_KEEP'
const DEFAULT_SNAPSHOT_KEEP = 2

type EnvGetter = (name: string) => string | undefined

export interface SnapshotHandle {
  snapshotId: string
  delete(opts?: { signal?: AbortSignal }): Promise<void>
}

function resolveSnapshotKeepCount(getEnvVar: EnvGetter): number {
  const raw = getEnvVar(SNAPSHOT_KEEP_ENV_VAR)?.trim()
  if (!raw) {
    return DEFAULT_SNAPSHOT_KEEP
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_SNAPSHOT_KEEP
  }
  return parsed
}

export async function applySnapshotRetention(
  workspaceId: string,
  latestSnapshot: SnapshotHandle,
  snapshotsByWorkspaceId: Map<string, SnapshotHandle[]>,
  opts: {
    getEnvVar?: EnvGetter
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const keepCount = resolveSnapshotKeepCount(opts.getEnvVar ?? getEnv)
  const existing = snapshotsByWorkspaceId.get(workspaceId) ?? []
  const ordered = [latestSnapshot, ...existing]
  const retained = ordered.slice(0, keepCount)
  const stale = ordered.slice(keepCount)
  const failedDeletes: SnapshotHandle[] = []
  let firstDeleteError: unknown | null = null

  for (const snapshot of stale) {
    try {
      await snapshot.delete({ signal: opts.signal })
    } catch (error) {
      if (firstDeleteError === null) {
        firstDeleteError = error
      }
      failedDeletes.push(snapshot)
    }
  }

  snapshotsByWorkspaceId.set(workspaceId, [...retained, ...failedDeletes])
  if (firstDeleteError !== null) {
    throw firstDeleteError
  }
}
