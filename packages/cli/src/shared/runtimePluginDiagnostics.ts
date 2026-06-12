import type { ErrorCode } from "@hachej/boring-agent/shared"
import type { BoringPluginFrontTarget } from "@hachej/boring-workspace/server"
import type { PluginFrontRuntimeDiagnostic } from "../server/pluginFrontRuntime"

export interface RuntimePluginHostSnapshot {
  pluginId: string
  workspaceId: string
  revision?: number
  rootDir?: string
  frontEntrySubpath?: string
  entryUrl?: string
  lastRequestedPath?: string
  lastResolvedPath?: string
  lastRequestAt?: number
  lastTransformAt?: number
  lastServeAt?: number
  lastRejectedAt?: number
  lastDisposedAt?: number
  lastTransformDurationMs?: number
  lastServeDurationMs?: number
  lastDiagnostic?: PluginFrontRuntimeDiagnostic
  lastErrorCode?: ErrorCode
  lastErrorMessage?: string
  lastErrorStage?: PluginFrontRuntimeDiagnostic["stage"]
  recent: PluginFrontRuntimeDiagnostic[]
}

export interface RuntimePluginFrontError {
  pluginId: string
  revision: number
  message: string
  url?: string
  reportedAt: number
}

export interface RuntimePluginServerSnapshotEntry {
  id: string
  version?: string
  rootDir?: string
  frontPath?: string
  frontTarget?: BoringPluginFrontTarget
  serverLoadedRevision?: number
  serverError?: string
  frontError?: RuntimePluginFrontError
  host?: RuntimePluginHostSnapshot
}

export interface RuntimePluginDiagnosticsResponse {
  workspaceId: string
  plugins: RuntimePluginServerSnapshotEntry[]
}
