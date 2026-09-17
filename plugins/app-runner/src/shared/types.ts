export interface AppRunnerVersion {
  version: number
  created_at: string
  message?: string
  sha256: string
  current: boolean
}

export interface AppRunnerVersionWithPreview extends AppRunnerVersion {
  previewUrl: string
}

export interface AppRunnerToolManifestEntry {
  name: string
  description?: string
  input?: Record<string, unknown>
  route: string
}

export interface AppRunnerToolManifest {
  tools: AppRunnerToolManifestEntry[]
  bindings?: string[]
}

export interface AppRunnerRecord {
  appName: string
  version: number
  url: string
  updatedAt: string
  /** Parsed `app/tools.json` from the most recent successful publish/activate/rollback, if present. */
  toolManifest?: AppRunnerToolManifest
}

export interface AppRunnerRecordWithLinks extends AppRunnerRecord {
  appId: string
  appUrl: string
}

export interface AppRunnerAppsResponse {
  apps: AppRunnerRecordWithLinks[]
  workspaceId: string
}

export interface AppRunnerVersionsResponse {
  versions: AppRunnerVersionWithPreview[]
  appId: string
  appUrl: string
}

export interface AppRunnerPublishResponse {
  version: number
  url: string
  sha256: string
}

export interface AppRunnerIdentity {
  id: string
  name: string
  email?: string
}

export interface AppRunnerLogsResponse {
  lines: string[]
  errors: string[]
}

export interface AppRunnerUsageResponse {
  last24h: { requests: number; distinctUsers: number }
  last7d: { requests: number; distinctUsers: number }
}
