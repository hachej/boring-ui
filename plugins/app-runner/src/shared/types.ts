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

export interface AppRunnerRecord {
  appName: string
  version: number
  url: string
  updatedAt: string
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
