import type { SharePointErrorCode } from "./errors"

export type OfficeDocumentSubtype = "excel" | "powerpoint"
export type OfficePreviewViewer = "office"

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

export type IntegrationAuthState =
  | { status: "connected" }
  | { status: "needs_auth"; authorizationUrl: string }
  | { status: "pending_auth"; authorizationUrl?: string }
  | { status: "admin_consent_required"; message: string }
  | { status: "failed"; code: SharePointErrorCode; message: string }

export interface SharePointProviderContext {
  workspaceId: string
  actorUserId: string
}

export interface ResolveDriveItemInput {
  siteUrl?: string
  webUrl?: string
  driveId?: string
  driveItemId?: string
}

export interface CreateOfficePreviewUrlInput {
  driveId: string
  driveItemId: string
  viewer?: OfficePreviewViewer
}

export interface CreateOfficePreviewUrlResult {
  /** Transient token-bearing iframe URL. Never persist or log. */
  getUrl: string
  expiresAt?: string
}

export type OfficeEditRequest =
  | {
      kind: "excel.add-worksheet"
      worksheetName: string
    }
  | {
      kind: "powerpoint.create-slide"
      title: string
      body?: string
      layout?: "TITLE_AND_CONTENT" | "TITLE_ONLY" | "BLANK" | "TWO_CONTENT"
    }

export type OfficeEditResult =
  | {
      status: "succeeded"
      providerBackend: "arcade" | string
      summary: string
      sessionId?: string
      metadata?: Record<string, unknown>
    }
  | {
      status: "needs_auth"
      authorizationUrl: string
    }
  | {
      status: "conflict"
      code: SharePointErrorCode
      message: string
    }
  | {
      status: "failed"
      code: SharePointErrorCode
      message: string
    }

export interface SharePointProvider {
  getStatus(ctx: SharePointProviderContext): Promise<IntegrationAuthState>
  authorize(ctx: SharePointProviderContext): Promise<IntegrationAuthState>
  resolveDriveItem(input: ResolveDriveItemInput, ctx: SharePointProviderContext): Promise<SharePointDocumentRef>
  createOfficePreviewUrl(ref: SharePointDocumentRef, ctx: SharePointProviderContext): Promise<CreateOfficePreviewUrlResult>
  editOfficeDocument(ref: SharePointDocumentRef, request: OfficeEditRequest, ctx: SharePointProviderContext): Promise<OfficeEditResult>
}
