export type OfficeDocumentSubtype = "excel" | "powerpoint"

export interface SharePointDocumentRefCreatedFrom {
  type: "local-import" | "sharepoint"
  /** Workspace-relative source path only. Never store absolute local paths. */
  originalPath?: string
}

export interface SharePointDocumentRef {
  kind: "office-cloud-document"
  provider: "sharepoint"
  version: 1
  name: string
  officeKind: OfficeDocumentSubtype
  mimeType: string
  /** SharePoint open link. Useful for humans, but not durable identity. */
  webUrl: string
  siteId: string
  driveId: string
  driveItemId: string
  createdFrom?: SharePointDocumentRefCreatedFrom
}

export interface LocalOfficeImportTarget {
  siteUrl?: string
  driveId?: string
  folderDriveItemId?: string
  folderWebUrl?: string
}

export interface LocalOfficeImportRequest {
  /** Workspace-relative .xlsx/.pptx source path. Never absolute. */
  sourcePath: string
  /** Opaque upload handle produced by the host/workspace upload staging layer. */
  contentHandle: string
  target: LocalOfficeImportTarget
}

export interface LocalOfficeImportResult {
  ref: SharePointDocumentRef
  cloudRefPath: string
}
