import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  SHAREPOINT_ERROR_CODES,
  SharePointRefValidationError,
  assertSharePointDocumentRefSafeForStorage,
  parseSharePointDocumentRef,
  type IntegrationAuthState,
  type ResolveDriveItemInput,
  type SharePointProvider,
  type SharePointProviderContext,
} from "../shared"
import { SharePointProviderError } from "./sharePointProvider"

export const SHAREPOINT_ROUTE_PATHS = {
  status: "/api/sharepoint/status",
  resolve: "/api/sharepoint/resolve",
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

  done()
}

function safeStatusForRoute(status: IntegrationAuthState): Record<string, string> {
  if (status.status === "needs_auth") return { status: "needs_auth" }
  if (status.status === "pending_auth") return { status: "pending_auth" }
  return status
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
    return reply.code(400).send({ error: error.code, message: error.message })
  }
  return reply.code(500).send({ error: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message: "SharePoint provider request failed" })
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readQueryString(request: FastifyRequest, key: string): string | undefined {
  const query = request.query
  if (!query || typeof query !== "object") return undefined
  return optionalString((query as Record<string, unknown>)[key])
}
