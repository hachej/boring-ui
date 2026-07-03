import {
  SHAREPOINT_ERROR_CODES,
  SharePointRefValidationError,
  expectedMimeTypeForOfficeKind,
  parseSharePointDocumentRef,
  type CreateOfficePreviewUrlInput,
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
  createPreviewUrl: "BoringSharePoint_CreatePreviewUrl",
  addWorksheet: "MicrosoftSharepoint_AddWorksheet",
  getWorkbookMetadata: "MicrosoftSharepoint_GetWorkbookMetadata",
  createSlide: "MicrosoftSharepoint_CreateSlide",
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

  async createOfficePreviewUrl(input: SharePointDocumentRef | CreateOfficePreviewUrlInput, ctx: SharePointProviderContext): Promise<CreateOfficePreviewUrlResult> {
    const response = await this.runtime.executeTool({
      toolName: this.tools.createPreviewUrl,
      userId: ctx.actorUserId,
      input: {
        drive_id: input.driveId,
        item_id: input.driveItemId,
        viewer: "viewer" in input && input.viewer ? input.viewer : "office",
      },
    })
    return toOfficePreviewUrlResult(response, this.tools.createPreviewUrl)
  }

  async editOfficeDocument(ref: SharePointDocumentRef, request: OfficeEditRequest, ctx: SharePointProviderContext): Promise<OfficeEditResult> {
    validateOfficeEditRequestForRef(ref, request)

    if (request.kind === "excel.add-worksheet") {
      const addResponse = await this.runtime.executeTool({
        toolName: this.tools.addWorksheet,
        userId: ctx.actorUserId,
        input: {
          drive_id: ref.driveId,
          item_id: ref.driveItemId,
          worksheet_name: request.worksheetName,
        },
      })
      const addValue = unwrapArcadeValueObject(addResponse, this.tools.addWorksheet)
      const sessionId = optionalString(addValue, ["sessionId", "session_id", "workbookSessionId", "workbook_session_id"])

      const metadataInput: Record<string, unknown> = {
        drive_id: ref.driveId,
        item_id: ref.driveItemId,
      }
      if (sessionId) metadataInput.session_id = sessionId
      const metadataResponse = await this.runtime.executeTool({
        toolName: this.tools.getWorkbookMetadata,
        userId: ctx.actorUserId,
        input: metadataInput,
      })
      const metadataValue = unwrapArcadeValueObject(metadataResponse, this.tools.getWorkbookMetadata)
      const normalizedSessionId = sessionId ?? optionalString(metadataValue, ["sessionId", "session_id", "workbookSessionId", "workbook_session_id"])

      return normalizedSessionId
        ? { status: "succeeded", summary: `Added worksheet ${request.worksheetName} to ${ref.name}`, sessionId: normalizedSessionId }
        : { status: "succeeded", summary: `Added worksheet ${request.worksheetName} to ${ref.name}` }
    }

    const response = await this.runtime.executeTool({
      toolName: this.tools.createSlide,
      userId: ctx.actorUserId,
      input: {
        drive_id: ref.driveId,
        item_id: ref.driveItemId,
        title: request.title,
        ...(request.body ? { body: request.body } : {}),
        ...(request.layout ? { layout: request.layout } : {}),
      },
    })
    unwrapArcadeValueObject(response, this.tools.createSlide)
    return { status: "succeeded", summary: `Created PowerPoint slide in ${ref.name}` }
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

const EDIT_SECRET_LIKE_PATTERN = /([?&#](access_token|refresh_token|id_token|authorization|cookie)=)|Bearer\s+|token|secret|cookie|authorization/i

export function validateOfficeEditRequestForRef(ref: SharePointDocumentRef, request: OfficeEditRequest): void {
  if (request.kind === "excel.add-worksheet") {
    if (ref.officeKind !== "excel") {
      throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.EDIT_CONFLICT, "Excel edit requests require an Excel SharePoint document ref")
    }
    validateEditText(request.worksheetName, "worksheetName", 31)
    return
  }

  if (ref.officeKind !== "powerpoint") {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.EDIT_CONFLICT, "PowerPoint edit requests require a PowerPoint SharePoint document ref")
  }
  validateEditText(request.title, "title", 200)
  if (request.body !== undefined) validateEditText(request.body, "body", 2_000)
}

function validateEditText(value: string, label: string, maxLength: number): void {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, `${label} must be a non-empty string`)
  }
  if (trimmed.length > maxLength) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, `${label} must be ${maxLength} characters or fewer`)
  }
  if (EDIT_SECRET_LIKE_PATTERN.test(value)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET, `${label} contains forbidden credential-like data`)
  }
}

export function toOfficePreviewUrlResult(response: unknown, toolName = ARCADE_SHAREPOINT_TOOL_NAMES.createPreviewUrl): CreateOfficePreviewUrlResult {
  const value = unwrapArcadeValueObject(response, toolName)
  const getUrl = optionalString(value, ["getUrl", "get_url"])
  if (!getUrl || !isHttpsUrl(getUrl)) {
    throw new SharePointProviderError(
      SHAREPOINT_ERROR_CODES.PREVIEW_UNAVAILABLE,
      `${toolName} did not return a valid HTTPS preview URL`,
      502,
    )
  }
  const expiresAt = optionalString(value, ["expiresAt", "expires_at", "expirationDateTime", "expiration_date_time"])
  return expiresAt ? { getUrl, expiresAt } : { getUrl }
}

export function toSharePointDocumentRef(input: { site?: Record<string, unknown>; item: Record<string, unknown> }): SharePointDocumentRef {
  const name = requireString(input.item, ["name", "fileName"], "drive item name")
  const suppliedMimeType = optionalString(input.item, ["mimeType", "mime_type", "file.mimeType", "file.mime_type"])
  const officeKind = officeKindFromName(name)
  if (!officeKind) {
    throw new SharePointProviderError(
      SHAREPOINT_ERROR_CODES.INVALID_REF,
      "Only .xlsx Excel and .pptx PowerPoint SharePoint documents are supported",
    )
  }
  const expectedMimeType = expectedMimeTypeForOfficeKind(officeKind)
  if (suppliedMimeType && suppliedMimeType !== expectedMimeType) {
    throw new SharePointProviderError(
      SHAREPOINT_ERROR_CODES.INVALID_REF,
      `SharePoint drive item MIME type does not match ${officeKind} file extension`,
    )
  }

  const ref: SharePointDocumentRef = {
    kind: "office-cloud-document",
    provider: "sharepoint",
    version: 1,
    name,
    officeKind,
    mimeType: expectedMimeType,
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
  try {
    return parseSharePointDocumentRef(ref)
  } catch (error) {
    if (error instanceof SharePointRefValidationError) {
      throw new SharePointProviderError(error.code, error.message)
    }
    throw error
  }
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

function officeKindFromName(name: string): "excel" | "powerpoint" | null {
  if (name.endsWith(".xlsx")) return "excel"
  if (name.endsWith(".pptx")) return "powerpoint"
  return null
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
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
