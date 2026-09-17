export type AppRunnerKind = "app" | "profile"

export interface AppRunnerVersion {
  version: number
  kind: AppRunnerKind
  sha: string | null
  content_sha?: string
  message?: string
  created_at: string
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

export interface AppRunnerCurrent {
  version: number
  kind: AppRunnerKind
  sha: string | null
  contentSha: string
  manifest: AppRunnerToolManifest
  instructions?: string | null
  mcp?: string | null
}

export interface AppRunnerRecord {
  appName: string
  workspaceId: string
  /** Present only for a per-user profile cell. */
  ownerUserId?: string
  kind: AppRunnerKind
  version: number
  sha: string | null
  url: string
  updatedAt: string
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
  sha: string | null
  contentSha: string
  kind: AppRunnerKind
  activated: boolean
  activationError?: string
}

export interface AppRunnerIdentity {
  id: string
  name: string
  email?: string
}

export interface AppRunnerLogError {
  created_at: string
  path: string
  message: string
}

export interface AppRunnerLogsResponse {
  lines: string[]
  errors: AppRunnerLogError[]
}

export interface AppRunnerUsageResponse {
  last24h: { requests: number; distinctUsers: number }
  last7d: { requests: number; distinctUsers: number }
}
