import {
  EXCEL_MIME_TYPE,
  POWERPOINT_MIME_TYPE,
  SHAREPOINT_ERROR_CODES,
  type IntegrationAuthState,
  type OfficeEditRequest,
  type OfficeEditResult,
  type SharePointDocumentRef,
  type SharePointErrorCode,
  type SharePointProvider,
  type SharePointProviderContext,
  type ResolveDriveItemInput,
  type CreateOfficePreviewUrlResult,
} from "../shared"
import { normalizeArcadeAuthState, normalizeArcadeToolAuthState } from "./authNormalization"
import type { ArcadeJsToolRuntime } from "./arcadeRuntime"

export const ARCADE_SHAREPOINT_TOOL_NAMES = {
  statusProbe: "MicrosoftSharepoint_ListSites",
  getSite: "MicrosoftSharepoint_GetSite",
  getDriveItem: "MicrosoftSharepoint_GetDriveItem",
  getDriveItemByUrl: "MicrosoftSharepoint_GetDriveItemByUrl",
} as const

export interface ArcadeSharePointProviderOptions {
  runtime: Pick<ArcadeJsToolRuntime, "executeTool" | "startAuthorization">
  scopes?: string[]
  tools?: Partial<typeof ARCADE_SHAREPOINT_TOOL_NAMES>
}

export class SharePointProviderError extends Error {
  readonly code: SharePointErrorCode
  readonly statusCode: number

  constructor(code: SharePointErrorCode, message: string, statusCode = 400) {
    super(message)
    this.name = "SharePointProviderError"
    this.code = code
    this.statusCode = statusCode
  }
}

export class ArcadeSharePointProvider implements SharePointProvider {
  private readonly runtime: ArcadeSharePointProviderOptions["runtime"]
  private readonly scopes: string[]
  private readonly tools: typeof ARCADE_SHAREPOINT_TOOL_NAMES

  constructor(options: ArcadeSharePointProviderOptions) {
    this.runtime = options.runtime
    this.scopes = options.scopes ?? ["Sites.Read.All", "Files.Read.All"]
    this.tools = { ...ARCADE_SHAREPOINT_TOOL_NAMES, ...options.tools }
  }

  async getStatus(ctx: SharePointProviderContext): Promise<IntegrationAuthState> {
    try {
      const response = await this.runtime.executeTool({
        toolName: this.tools.statusProbe,
        userId: ctx.actorUserId,
        input: {},
      })
      return normalizeArcadeToolAuthState(response)
    } catch (error) {
      return {
        status: "failed",
        code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: error instanceof Error ? error.message : "SharePoint provider status check failed",
      }
    }
  }

  async authorize(ctx: SharePointProviderContext): Promise<IntegrationAuthState> {
    try {
      return normalizeArcadeAuthState(await this.runtime.startAuthorization({ userId: ctx.actorUserId, scopes: this.scopes }))
    } catch (error) {
      return {
        status: "failed",
        code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE,
        message: error instanceof Error ? error.message : "SharePoint authorization failed",
      }
    }
  }

  async resolveDriveItem(input: ResolveDriveItemInput, ctx: SharePointProviderContext): Promise<SharePointDocumentRef> {
    const site = input.siteUrl ? await this.getSite(input.siteUrl, ctx) : undefined
    const item = input.webUrl
      ? await this.getDriveItemByUrl(input.webUrl, ctx)
      : await this.getDriveItemById(input, ctx)

    return toSharePointDocumentRef({ site, item })
  }

  async createOfficePreviewUrl(): Promise<CreateOfficePreviewUrlResult> {
    throw new SharePointProviderError(
      SHAREPOINT_ERROR_CODES.PREVIEW_UNAVAILABLE,
      "SharePoint Office preview URLs are not implemented in this read-only discovery slice",
      501,
    )
  }

  async editOfficeDocument(_ref: SharePointDocumentRef, _request: OfficeEditRequest): Promise<OfficeEditResult> {
    return {
      status: "failed",
      code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: "SharePoint Office edits are not implemented in this read-only discovery slice",
    }
  }

  private async getSite(siteUrl: string, ctx: SharePointProviderContext): Promise<Record<string, unknown>> {
    const response = await this.runtime.executeTool({
      toolName: this.tools.getSite,
      userId: ctx.actorUserId,
      input: { site: siteUrl },
    })
    return unwrapArcadeValueObject(response, this.tools.getSite)
  }

  private async getDriveItemByUrl(webUrl: string, ctx: SharePointProviderContext): Promise<Record<string, unknown>> {
    const response = await this.runtime.executeTool({
      toolName: this.tools.getDriveItemByUrl,
      userId: ctx.actorUserId,
      input: { web_url: webUrl },
    })
    return unwrapArcadeValueObject(response, this.tools.getDriveItemByUrl)
  }

  private async getDriveItemById(input: ResolveDriveItemInput, ctx: SharePointProviderContext): Promise<Record<string, unknown>> {
    if (!input.driveId || !input.driveItemId) {
      throw new SharePointProviderError(
        SHAREPOINT_ERROR_CODES.INVALID_REF,
        "resolveDriveItem requires either webUrl or driveId + driveItemId",
      )
    }
    const response = await this.runtime.executeTool({
      toolName: this.tools.getDriveItem,
      userId: ctx.actorUserId,
      input: { drive_id: input.driveId, item_id: input.driveItemId },
    })
    return unwrapArcadeValueObject(response, this.tools.getDriveItem)
  }
}

export function toSharePointDocumentRef(input: { site?: Record<string, unknown>; item: Record<string, unknown> }): SharePointDocumentRef {
  const name = requireString(input.item, ["name", "fileName"], "drive item name")
  const mimeType = optionalString(input.item, ["mimeType", "mime_type", "file.mimeType", "file.mime_type"]) ?? mimeTypeFromName(name)
  const officeKind = officeKindFromNameAndMime(name, mimeType)
  if (!officeKind) {
    throw new SharePointProviderError(
      SHAREPOINT_ERROR_CODES.INVALID_REF,
      "Only .xlsx Excel and .pptx PowerPoint SharePoint documents are supported",
    )
  }

  const ref: SharePointDocumentRef = {
    kind: "office-cloud-document",
    provider: "sharepoint",
    version: 1,
    name,
    officeKind,
    mimeType: officeKind === "excel" ? EXCEL_MIME_TYPE : POWERPOINT_MIME_TYPE,
    webUrl: requireString(input.item, ["webUrl", "web_url"], "drive item webUrl"),
    siteId:
      optionalString(input.item, ["siteId", "site_id", "parentReference.siteId", "parent_reference.site_id"]) ??
      optionalString(input.site, ["id", "siteId", "site_id"]) ??
      "",
    driveId: requireString(input.item, ["driveId", "drive_id", "parentReference.driveId", "parent_reference.drive_id"], "drive id"),
    driveItemId: requireString(input.item, ["id", "itemId", "item_id", "driveItemId", "drive_item_id"], "drive item id"),
    createdFrom: { type: "sharepoint" },
  }

  if (!ref.siteId) throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "SharePoint site id is required")
  return ref
}

function unwrapArcadeValueObject(response: unknown, toolName: string): Record<string, unknown> {
  const authState = normalizeArcadeToolAuthState(response)
  if (authState.status !== "connected") {
    throw new SharePointProviderError(
      authState.status === "failed" ? authState.code : SHAREPOINT_ERROR_CODES.AUTH_REQUIRED,
      authState.status === "failed" ? authState.message : "SharePoint authorization is required",
      authState.status === "failed" ? 502 : 401,
    )
  }

  const value = nested(response, ["output", "value"]) ?? nested(response, ["value"]) ?? response
  if (!isObject(value)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.PROVIDER_TOOL_FAILED, `${toolName} did not return an object`, 502)
  }
  return value
}

function officeKindFromNameAndMime(name: string, mimeType: string | undefined): "excel" | "powerpoint" | null {
  if (name.endsWith(".xlsx") || mimeType === EXCEL_MIME_TYPE) return "excel"
  if (name.endsWith(".pptx") || mimeType === POWERPOINT_MIME_TYPE) return "powerpoint"
  return null
}

function mimeTypeFromName(name: string): string | undefined {
  if (name.endsWith(".xlsx")) return EXCEL_MIME_TYPE
  if (name.endsWith(".pptx")) return POWERPOINT_MIME_TYPE
  return undefined
}

function requireString(object: Record<string, unknown> | undefined, paths: string[], label: string): string {
  const value = optionalString(object, paths)
  if (!value) throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, `${label} is required`)
  return value
}

function optionalString(object: Record<string, unknown> | undefined, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = nested(object, path.split("."))
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function nested(object: unknown, path: string[]): unknown {
  let current = object
  for (const segment of path) {
    if (!isObject(current)) return undefined
    current = current[segment]
  }
  return current
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
