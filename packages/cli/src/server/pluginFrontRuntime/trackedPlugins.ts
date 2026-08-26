import { ErrorCode } from "@hachej/boring-agent/shared"
import { PluginFrontRuntimeError } from "./diagnostics.js"

export interface TrackedPluginRecord {
  workspaceId: string
  pluginId: string
  revision: number
  rootDir: string
  frontEntrySubpath: string
  frontRootDir: string
  sharedRootDir: string
  sourceSnapshot: Map<string, Uint8Array>
}

/**
 * Which plugin revisions the runtime will serve, and which workspaces have
 * been evicted.
 *
 * Two indexes are kept: the current record per plugin (what a workspace is
 * serving now) and every still-tracked revision (older revisions stay
 * resolvable while a browser holds their URLs). Eviction is ordered: the
 * disposal epoch is bumped synchronously before anything is removed, so an
 * in-flight serve() that validated against the pre-eviction state can detect
 * it and discard its result instead of resurrecting a cache entry.
 */
export class TrackedPluginRegistry {
  private readonly current = new Map<string, Map<string, TrackedPluginRecord>>()
  private readonly byRevision = new Map<string, Map<string, Map<number, TrackedPluginRecord>>>()
  private readonly disposalEpochs = new Map<string, number>()
  private readonly disposedWorkspaces = new Set<string>()

  store(record: TrackedPluginRecord): void {
    const workspacePlugins = this.current.get(record.workspaceId) ?? new Map<string, TrackedPluginRecord>()
    this.current.set(record.workspaceId, workspacePlugins)
    workspacePlugins.set(record.pluginId, record)
    const workspaceRevisions = this.byRevision.get(record.workspaceId) ?? new Map<string, Map<number, TrackedPluginRecord>>()
    this.byRevision.set(record.workspaceId, workspaceRevisions)
    const pluginRevisions = workspaceRevisions.get(record.pluginId) ?? new Map<number, TrackedPluginRecord>()
    workspaceRevisions.set(record.pluginId, pluginRevisions)
    pluginRevisions.set(record.revision, record)
  }

  find(workspaceId: string, pluginId: string): TrackedPluginRecord | undefined {
    return this.current.get(workspaceId)?.get(pluginId)
  }

  workspaceRecords(workspaceId: string): TrackedPluginRecord[] {
    return [...(this.current.get(workspaceId)?.values() ?? [])]
  }

  /** Resolves an exact revision, distinguishing "never tracked" from "superseded". */
  requireRevision(workspaceId: string, pluginId: string, revision: number): TrackedPluginRecord {
    const tracked = this.byRevision.get(workspaceId)?.get(pluginId)?.get(revision)
    if (tracked) return tracked
    const current = this.find(workspaceId, pluginId)
    if (!current) {
      throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime record not found", {
        workspaceId,
        pluginId,
        requestedRevision: revision,
      })
    }
    throw new PluginFrontRuntimeError(ErrorCode.enum.PLUGIN_RUNTIME_REVISION_MISMATCH, 409, "validate", "plugin runtime revision is no longer tracked", {
      workspaceId,
      pluginId,
      requestedRevision: revision,
      currentRevision: current.revision,
    })
  }

  untrackPlugin(workspaceId: string, pluginId: string): TrackedPluginRecord | undefined {
    const tracked = this.find(workspaceId, pluginId)
    this.current.get(workspaceId)?.delete(pluginId)
    this.byRevision.get(workspaceId)?.delete(pluginId)
    return tracked
  }

  disposalEpoch(workspaceId: string): number {
    return this.disposalEpochs.get(workspaceId) ?? 0
  }

  isDisposed(workspaceId: string): boolean {
    return this.disposedWorkspaces.has(workspaceId)
  }

  activateWorkspace(workspaceId: string): void {
    this.disposedWorkspaces.delete(workspaceId)
  }

  /** Bumps the epoch first (synchronously) so in-flight serves observe the eviction. */
  disposeWorkspace(workspaceId: string): void {
    this.disposalEpochs.set(workspaceId, this.disposalEpoch(workspaceId) + 1)
    this.disposedWorkspaces.add(workspaceId)
    this.current.delete(workspaceId)
    this.byRevision.delete(workspaceId)
  }

  clear(): void {
    this.current.clear()
    this.byRevision.clear()
    this.disposedWorkspaces.clear()
  }
}
