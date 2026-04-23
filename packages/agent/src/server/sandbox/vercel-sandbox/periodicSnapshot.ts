import { getEnv } from '../../config/env'
import type { SandboxHandleStore } from '../../../shared/sandbox-handle-store'

const SNAPSHOT_KEEP_ENV_VAR = 'BORING_AGENT_SNAPSHOT_KEEP'
const DEFAULT_SNAPSHOT_KEEP = 2
const DEFAULT_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000

type EnvGetter = (name: string) => string | undefined

export interface SnapshotHandle {
  snapshotId: string
  delete(opts?: { signal?: AbortSignal }): Promise<void>
}

export interface SnapshotSchedulerSandbox {
  sandboxId: string
  snapshot(opts?: { signal?: AbortSignal }): Promise<{ snapshotId: string }>
}

interface TrackedSnapshotJob {
  timer: ReturnType<typeof setInterval>
  dirty: boolean
  inFlightPromise: Promise<void> | null
  sandbox: SnapshotSchedulerSandbox
  store: SandboxHandleStore
}

export interface PeriodicSnapshotScheduler {
  trackWorkspace(params: {
    workspaceId: string
    sandbox: SnapshotSchedulerSandbox
    store: SandboxHandleStore
  }): void
  markDirty(workspaceId: string): void
  stopWorkspace(workspaceId: string): void
  shutdown(): Promise<void>
}

export interface PeriodicSnapshotSchedulerOptions {
  intervalMs?: number
  now?: () => number
  logger?: {
    warn?: (message: string, meta?: Record<string, unknown>) => void
  }
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

function nowIso(now: () => number): string {
  return new Date(now()).toISOString()
}

async function persistLatestSnapshot(
  workspaceId: string,
  sandbox: SnapshotSchedulerSandbox,
  snapshotId: string,
  store: SandboxHandleStore,
  now: () => number,
): Promise<void> {
  const previous = await store.get(workspaceId)
  const timestamp = nowIso(now)

  await store.put({
    workspaceId,
    sandboxId: sandbox.sandboxId,
    snapshotId,
    createdAt: previous?.createdAt ?? timestamp,
    lastUsedAt: timestamp,
  })
}

export function createPeriodicSnapshotScheduler(
  opts: PeriodicSnapshotSchedulerOptions = {},
): PeriodicSnapshotScheduler {
  const intervalMs = opts.intervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS
  const now = opts.now ?? Date.now
  const jobsByWorkspaceId = new Map<string, TrackedSnapshotJob>()

  function stopWorkspaceInternal(workspaceId: string): void {
    const existing = jobsByWorkspaceId.get(workspaceId)
    if (!existing) return
    clearInterval(existing.timer)
    jobsByWorkspaceId.delete(workspaceId)
  }

  async function tick(workspaceId: string, job: TrackedSnapshotJob): Promise<void> {
    if (job.inFlightPromise || !job.dirty) {
      return
    }

    job.dirty = false
    const inFlight = (async () => {
      try {
        const snapshot = await job.sandbox.snapshot()
        await persistLatestSnapshot(
          workspaceId,
          job.sandbox,
          snapshot.snapshotId,
          job.store,
          now,
        )
      } catch (error) {
        job.dirty = true
        opts.logger?.warn?.('[vercel-sandbox:snapshot-cron] snapshot failed', {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    job.inFlightPromise = inFlight
    try {
      await inFlight
    } finally {
      if (job.inFlightPromise === inFlight) {
        job.inFlightPromise = null
      }
    }
  }

  return {
    trackWorkspace({ workspaceId, sandbox, store }) {
      stopWorkspaceInternal(workspaceId)

      const job: TrackedSnapshotJob = {
        timer: setInterval(() => {
          void tick(workspaceId, job)
        }, intervalMs),
        dirty: false,
        inFlightPromise: null,
        sandbox,
        store,
      }
      const timer = job.timer as NodeJS.Timeout
      timer.unref?.()
      jobsByWorkspaceId.set(workspaceId, job)
    },
    markDirty(workspaceId) {
      const job = jobsByWorkspaceId.get(workspaceId)
      if (!job) return
      job.dirty = true
    },
    stopWorkspace(workspaceId) {
      stopWorkspaceInternal(workspaceId)
    },
    async shutdown() {
      const inFlight: Promise<void>[] = []
      for (const job of jobsByWorkspaceId.values()) {
        clearInterval(job.timer)
        if (job.inFlightPromise) {
          inFlight.push(job.inFlightPromise)
        }
      }
      jobsByWorkspaceId.clear()
      if (inFlight.length > 0) {
        await Promise.allSettled(inFlight)
      }
    },
  }
}
