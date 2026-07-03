import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  SHAREPOINT_ERROR_CODES,
  SharePointRefValidationError,
  assertSharePointDocumentRefSafeForStorage,
  parseSharePointDocumentRef,
  type CreateOfficePreviewUrlInput,
  type CreateOfficePreviewUrlResult,
  type IntegrationAuthState,
  type OfficeEditRequest,
  type OfficeEditResult,
  type ResolveDriveItemInput,
  type SharePointDocumentRef,
  type SharePointProvider,
  type SharePointProviderContext,
} from "../shared"
import { SharePointProviderError, validateOfficeEditRequestForRef } from "./sharePointProvider"

const SHAREPOINT_DURABLE_ID_PATTERN = /^[A-Za-z0-9._~!$'(),;=:@+-]{1,512}$/
const SECRET_LIKE_ID_PATTERN = /([?&#](access_token|refresh_token|id_token|authorization|cookie)=)|Bearer\s+|token|secret|cookie|authorization/i

export const SHAREPOINT_ROUTE_PATHS = {
  status: "/api/sharepoint/status",
  resolve: "/api/sharepoint/resolve",
  preview: "/api/sharepoint/preview",
  edit: "/api/sharepoint/edit",
} as const

export interface SharePointRoutesOptions {
  provider: SharePointProvider
  getContext?: (request: FastifyRequest) => SharePointProviderContext | Promise<SharePointProviderContext>
}

export function sharePointRoutes(app: FastifyInstance, opts: SharePointRoutesOptions, done: (err?: Error) => void): void {
  app.get(SHAREPOINT_ROUTE_PATHS.status, async (request, reply) => {
    try {
      const ctx = await resolveContext(request, opts)
      return { status: safeStatusForRoute(await opts.provider.getStatus(ctx)) }
    } catch (error) {
      return sendSharePointRouteError(reply, error)
    }
  })

  app.post(SHAREPOINT_ROUTE_PATHS.resolve, async (request, reply) => {
    try {
      const input = parseResolveBody(request.body)
      const ctx = await resolveContext(request, opts)
      const ref = parseSharePointDocumentRef(await opts.provider.resolveDriveItem(input, ctx))
      assertSharePointDocumentRefSafeForStorage(ref)
      return { ref }
    } catch (error) {
      return sendSharePointRouteError(reply, error)
    }
  })

  app.post(SHAREPOINT_ROUTE_PATHS.preview, async (request, reply) => {
    try {
      const input = parsePreviewBody(request.body)
      const ctx = await resolveContext(request, opts)
      return safePreviewResultForRoute(await opts.provider.createOfficePreviewUrl(input, ctx))
    } catch (error) {
      return sendSharePointRouteError(reply, error)
    }
  })

  app.post(SHAREPOINT_ROUTE_PATHS.edit, async (request, reply) => {
    try {
      const { ref, editRequest } = parseEditBody(request.body)
      const ctx = await resolveContext(request, opts)
      return safeOfficeEditResultForRoute(await opts.provider.editOfficeDocument(ref, editRequest, ctx))
    } catch (error) {
      return sendSharePointRouteError(reply, error)
    }
  })

  done()
}

function safeStatusForRoute(status: IntegrationAuthState): Record<string, string> {
  if (status.status === "needs_auth") return { status: "needs_auth" }
  if (status.status === "pending_auth") return { status: "pending_auth" }
  return status
}

function safePreviewResultForRoute(result: CreateOfficePreviewUrlResult): CreateOfficePreviewUrlResult {
  if (!isHttpsUrl(result.getUrl)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.PREVIEW_UNAVAILABLE, "SharePoint preview provider returned an invalid preview URL", 502)
  }
  return result.expiresAt ? { getUrl: result.getUrl, expiresAt: result.expiresAt } : { getUrl: result.getUrl }
}

function safeOfficeEditResultForRoute(result: OfficeEditResult): OfficeEditResult {
  if (result.status === "succeeded") {
    return result.sessionId
      ? { status: "succeeded", summary: safeRouteMessage(result.summary, "Office edit succeeded"), sessionId: safeRouteMessage(result.sessionId, "session-redacted") }
      : { status: "succeeded", summary: safeRouteMessage(result.summary, "Office edit succeeded") }
  }
  if (result.status === "needs_auth") {
    return { status: "failed", code: SHAREPOINT_ERROR_CODES.AUTH_REQUIRED, message: "SharePoint authorization is required" }
  }
  return { ...result, message: safeRouteMessage(result.message, "SharePoint Office edit failed") }
}

function parseEditBody(body: unknown): { ref: SharePointDocumentRef; editRequest: OfficeEditRequest } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "edit request body must be an object")
  }
  const candidate = body as Record<string, unknown>
  const ref = parseSharePointDocumentRef(candidate.ref)
  assertSharePointDocumentRefSafeForStorage(ref)
  const editRequest = parseOfficeEditRequest(candidate.request)
  validateOfficeEditRequestForRef(ref, editRequest)
  return { ref, editRequest }
}

function parseOfficeEditRequest(value: unknown): OfficeEditRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "edit request must be an object")
  }
  const candidate = value as Record<string, unknown>
  if (candidate.kind === "excel.add-worksheet") {
    return { kind: "excel.add-worksheet", worksheetName: requireBodyString(candidate.worksheetName, "worksheetName") }
  }
  if (candidate.kind === "powerpoint.create-slide") {
    return {
      kind: "powerpoint.create-slide",
      title: requireBodyString(candidate.title, "title"),
      ...(candidate.body !== undefined ? { body: requireBodyString(candidate.body, "body") } : {}),
      ...(candidate.layout !== undefined ? { layout: parsePowerPointLayout(candidate.layout) } : {}),
    }
  }
  throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "unsupported Office edit request kind")
}

function parsePowerPointLayout(value: unknown): "TITLE_AND_CONTENT" | "TITLE_ONLY" | "BLANK" | "TWO_CONTENT" {
  if (value === "TITLE_AND_CONTENT" || value === "TITLE_ONLY" || value === "BLANK" || value === "TWO_CONTENT") return value
  throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "PowerPoint slide layout is not supported")
}

function requireBodyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, `${label} must be a string`)
  }
  return value
}

function safeRouteMessage(value: string, fallback: string): string {
  return SECRET_LIKE_ID_PATTERN.test(value) || /preview|getUrl|access_token|refresh_token|id_token/i.test(value) ? fallback : value
}

function parsePreviewBody(body: unknown): SharePointDocumentRef | CreateOfficePreviewUrlInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "preview request body must be an object")
  }
  const candidate = body as Record<string, unknown>
  if (candidate.ref !== undefined) {
    const ref = parseSharePointDocumentRef(candidate.ref)
    assertSharePointDocumentRefSafeForStorage(ref)
    return ref
  }
  const input = {
    driveId: optionalString(candidate.driveId),
    driveItemId: optionalString(candidate.driveItemId),
    viewer: optionalString(candidate.viewer),
  }
  if (!input.driveId || !input.driveItemId) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "preview requires ref or driveId + driveItemId")
  }
  validateDurablePreviewId(input.driveId, "driveId")
  validateDurablePreviewId(input.driveItemId, "driveItemId")
  if (input.viewer !== undefined && input.viewer !== "office") {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "preview viewer must be office")
  }
  return input.viewer ? { driveId: input.driveId, driveItemId: input.driveItemId, viewer: input.viewer } : { driveId: input.driveId, driveItemId: input.driveItemId }
}

function validateDurablePreviewId(value: string, label: "driveId" | "driveItemId"): void {
  if (SECRET_LIKE_ID_PATTERN.test(value)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET, `${label} contains forbidden credential-like data`)
  }
  if (!SHAREPOINT_DURABLE_ID_PATTERN.test(value)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, `${label} must be a valid SharePoint durable identifier`)
  }
}

function parseResolveBody(body: unknown): ResolveDriveItemInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.INVALID_REF, "resolve request body must be an object")
  }
  const candidate = body as Record<string, unknown>
  return {
    siteUrl: optionalString(candidate.siteUrl),
    webUrl: optionalString(candidate.webUrl),
    driveId: optionalString(candidate.driveId),
    driveItemId: optionalString(candidate.driveItemId),
  }
}

async function resolveContext(request: FastifyRequest, opts: SharePointRoutesOptions): Promise<SharePointProviderContext> {
  if (opts.getContext) return opts.getContext(request)
  return {
    workspaceId: readQueryString(request, "workspaceId") ?? "default",
    actorUserId: readQueryString(request, "actorUserId") ?? "anonymous",
  }
}

function sendSharePointRouteError(reply: FastifyReply, error: unknown) {
  if (error instanceof SharePointProviderError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message })
  }
  if (error instanceof SharePointRefValidationError) {
    return reply.code(400).send({
      error: error.code,
      message: error.code === SHAREPOINT_ERROR_CODES.REF_CONTAINS_SECRET ? "SharePoint request contains forbidden credential-like data" : error.message,
    })
  }
  return reply.code(500).send({ error: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message: "SharePoint provider request failed" })
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readQueryString(request: FastifyRequest, key: string): string | undefined {
  const query = request.query
  if (!query || typeof query !== "object") return undefined
  return optionalString((query as Record<string, unknown>)[key])
}
