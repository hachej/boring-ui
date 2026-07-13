import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeAuthContext,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
} from "../../shared/workspace-bridge-rpc"
import type { BridgeAuthPolicy } from "./authPolicy"
import type { WorkspaceBridgeIdempotencyStore } from "./idempotency"
import { runWithWorkspaceBridgeIdempotency } from "./idempotency"
import type { WorkspaceBridgeRegistry } from "./registry"
import { measureJsonBytes } from "./json"
import {
  DEFAULT_WORKSPACE_BRIDGE_RUNTIME_TOKEN_TTL_MS,
  authorizeWorkspaceBridgeRuntimeToken,
  clampWorkspaceBridgeRuntimeTokenTtlMs,
  mintWorkspaceBridgeRuntimeToken,
  verifyWorkspaceBridgeRuntimeRefreshToken,
  verifyWorkspaceBridgeRuntimeToken,
  verifyWorkspaceBridgeRuntimeTokenClaims,
  type VerifiedWorkspaceBridgeRuntimeRefreshToken,
  type VerifiedWorkspaceBridgeRuntimeTokenClaims,
  type WorkspaceBridgeRuntimeRefreshTokenClaims,
  type WorkspaceBridgeRuntimeTokenClaims,
} from "./runtimeToken"
import {
  InMemoryWorkspaceBridgeRuntimeRefreshTokenStore,
  type WorkspaceBridgeRuntimeRefreshTokenStore,
} from "./refreshTokenStore"

const bridgeCallBodySchema = z.object({
  op: z.string().min(1),
  input: z.unknown().default({}),
  requestId: z.string().optional(),
  idempotencyKey: z.string().optional(),
})

export interface WorkspaceBridgeHttpRoutesOptions {
  registry?: WorkspaceBridgeRegistry
  getRegistry?: (request: FastifyRequest, body: WorkspaceBridgeCallRequest) => WorkspaceBridgeRegistry | Promise<WorkspaceBridgeRegistry>
  browserAuthPolicy?: BridgeAuthPolicy
  runtimeTokenSecret?: string
  runtimeRefreshTokenSecret?: string
  runtimeRefreshTokenStore?: WorkspaceBridgeRuntimeRefreshTokenStore
  getRuntimeRefreshTokenStore?: (request: FastifyRequest, claims: WorkspaceBridgeRuntimeRefreshTokenClaims) => WorkspaceBridgeRuntimeRefreshTokenStore | undefined | Promise<WorkspaceBridgeRuntimeRefreshTokenStore | undefined>
  assertRuntimeWorkspaceScope?: (
    request: FastifyRequest,
    claims: WorkspaceBridgeRuntimeTokenClaims | WorkspaceBridgeRuntimeRefreshTokenClaims,
  ) => void | Promise<void>
  refreshTokenRateLimit?: { maxUses?: number; windowMs?: number }
  ownerWorkspaceId?: string
  getOwnerWorkspaceId?: (request: FastifyRequest, body: WorkspaceBridgeCallRequest, auth: BridgeAuthContext) => string | undefined | Promise<string | undefined>
  idempotencyStore?: WorkspaceBridgeIdempotencyStore
  getIdempotencyStore?: (request: FastifyRequest, body: WorkspaceBridgeCallRequest) => WorkspaceBridgeIdempotencyStore | undefined | Promise<WorkspaceBridgeIdempotencyStore | undefined>
  maxBodyBytes?: number
}

const DEFAULT_REFRESH_TOKEN_RATE_LIMIT_MAX_USES = 30
const DEFAULT_REFRESH_TOKEN_RATE_LIMIT_WINDOW_MS = 60_000

export function workspaceBridgeHttpRoutes(
  app: FastifyInstance,
  opts: WorkspaceBridgeHttpRoutesOptions,
  done: (err?: Error) => void,
): void {
  const defaultRefreshTokenStore = opts.runtimeRefreshTokenStore ?? new InMemoryWorkspaceBridgeRuntimeRefreshTokenStore()
  app.post("/api/v1/workspace-bridge/call", async (request, reply) => {
    reply.header("Cache-Control", "no-store")

    const contentType = String(request.headers["content-type"] ?? "")
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return sendBridgeError(reply, 415, undefined, WorkspaceBridgeErrorCode.InvalidRequest, "WorkspaceBridge transport requires application/json")
    }

    const rawBodySize = measureJsonBytes(request.body)
    if (opts.maxBodyBytes && rawBodySize > opts.maxBodyBytes) {
      return sendBridgeError(reply, 413, undefined, WorkspaceBridgeErrorCode.InputTooLarge, "WorkspaceBridge request body is too large")
    }

    const parsed = bridgeCallBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return sendBridgeError(reply, 400, undefined, WorkspaceBridgeErrorCode.SchemaInvalid, "WorkspaceBridge request body is invalid")
    }
    const body: WorkspaceBridgeCallRequest = { ...parsed.data, input: parsed.data.input ?? {} }
    const authHeader = firstHeader(request.headers.authorization)
    const runtimeToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined
    let verifiedRuntimeToken: VerifiedWorkspaceBridgeRuntimeTokenClaims | undefined

    if (runtimeToken !== undefined && opts.assertRuntimeWorkspaceScope) {
      try {
        verifiedRuntimeToken = resolveRuntimeClaims(runtimeToken, opts)
      } catch (err) {
        const bridgeError = isBridgeError(err)
          ? err
          : createWorkspaceBridgeError(WorkspaceBridgeErrorCode.HandlerFailed, "WorkspaceBridge transport failed")
        return sendBridgeError(reply, statusForBridgeError(bridgeError.code), body.requestId, bridgeError.code, bridgeError.message)
      }
      await opts.assertRuntimeWorkspaceScope(request, verifiedRuntimeToken.claims)
    }

    try {
      const registry = await resolveRegistry(request, body, opts)
      const definition = registry.getDefinition(body.op)
      if (!definition) {
        return sendBridgeError(reply, statusForBridgeError(WorkspaceBridgeErrorCode.OpNotFound), body.requestId, WorkspaceBridgeErrorCode.OpNotFound, "WorkspaceBridge operation is not registered")
      }

      const authContext = runtimeToken !== undefined
        ? resolveRuntimeContext(runtimeToken, opts, definition, verifiedRuntimeToken)
        : await resolveBrowserContext(request, opts, definition, body)
      const idempotencyStore = opts.getIdempotencyStore
        ? await opts.getIdempotencyStore(request, body)
        : opts.idempotencyStore
      const expectedWorkspaceId = opts.getOwnerWorkspaceId
        ? await opts.getOwnerWorkspaceId(request, body, authContext)
        : opts.ownerWorkspaceId

      const response = await runWithWorkspaceBridgeIdempotency(idempotencyStore, {
        definition,
        request: body,
        auth: authContext,
      }, async () => await registry.call(body, authContext, { expectedWorkspaceId }))
      return await sendResponse(reply, response)
    } catch (err) {
      const bridgeError = isBridgeError(err)
        ? err
        : createWorkspaceBridgeError(WorkspaceBridgeErrorCode.HandlerFailed, "WorkspaceBridge transport failed")
      return sendBridgeError(reply, statusForBridgeError(bridgeError.code), body.requestId, bridgeError.code, bridgeError.message)
    }
  })

  app.post("/api/v1/workspace-bridge/token", async (request, reply) => {
    reply.header("Cache-Control", "no-store")

    const authHeader = firstHeader(request.headers.authorization)
    if (!authHeader?.startsWith("Bearer ")) {
      return sendBridgeError(reply, 401, undefined, WorkspaceBridgeErrorCode.AuthRequired, "WorkspaceBridge refresh token is required")
    }
    if (!opts.runtimeTokenSecret || !opts.runtimeRefreshTokenSecret) {
      return sendBridgeError(reply, 401, undefined, WorkspaceBridgeErrorCode.AuthRequired, "WorkspaceBridge token refresh is not configured")
    }

    const nowMs = Date.now()
    let verified: VerifiedWorkspaceBridgeRuntimeRefreshToken
    try {
      verified = verifyWorkspaceBridgeRuntimeRefreshToken(authHeader.slice("Bearer ".length), {
        secret: opts.runtimeRefreshTokenSecret,
        nowMs,
      })
    } catch (err) {
      const bridgeError = isBridgeError(err)
        ? err
        : createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidToken, "WorkspaceBridge refresh token is invalid")
      return sendBridgeError(reply, statusForBridgeError(bridgeError.code), undefined, bridgeError.code, bridgeError.message)
    }
    if (opts.assertRuntimeWorkspaceScope) {
      await opts.assertRuntimeWorkspaceScope(request, verified.claims)
    }

    try {
      const store = opts.getRuntimeRefreshTokenStore
        ? await opts.getRuntimeRefreshTokenStore(request, verified.claims) ?? defaultRefreshTokenStore
        : defaultRefreshTokenStore
      const refreshUse = await store.recordUse({
        jti: verified.claims.jti,
        nowMs,
        maxUses: opts.refreshTokenRateLimit?.maxUses ?? DEFAULT_REFRESH_TOKEN_RATE_LIMIT_MAX_USES,
        windowMs: opts.refreshTokenRateLimit?.windowMs ?? DEFAULT_REFRESH_TOKEN_RATE_LIMIT_WINDOW_MS,
        expiresAtMs: verified.claims.exp * 1000,
      })
      if (!refreshUse.allowed) {
        if (refreshUse.reason === "revoked") {
          return sendBridgeError(reply, 401, undefined, WorkspaceBridgeErrorCode.InvalidToken, "WorkspaceBridge refresh token is revoked")
        }
        reply.header("Retry-After", Math.ceil(refreshUse.retryAfterMs / 1000).toString())
        return sendBridgeError(reply, 429, undefined, WorkspaceBridgeErrorCode.RateLimited, "WorkspaceBridge refresh token rate limit exceeded")
      }
      const ttlMs = refreshMintTtlMs(verified.claims, Date.now())
      if (ttlMs === undefined) {
        return sendBridgeError(reply, 401, undefined, WorkspaceBridgeErrorCode.ExpiredToken, "Runtime bridge refresh token has expired")
      }
      const token = mintWorkspaceBridgeRuntimeToken({
        secret: opts.runtimeTokenSecret,
        workspaceId: verified.claims.workspaceId,
        sessionId: verified.claims.sessionId,
        runtimeId: verified.claims.runtimeId,
        capabilities: verified.claims.capabilities,
        ttlMs,
      })
      return reply.code(200).send({ ok: true, token })
    } catch (err) {
      const bridgeError = isBridgeError(err)
        ? err
        : createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidToken, "WorkspaceBridge refresh token is invalid")
      return sendBridgeError(reply, statusForBridgeError(bridgeError.code), undefined, bridgeError.code, bridgeError.message)
    }
  })
  done()
}

async function resolveRegistry(
  request: FastifyRequest,
  body: WorkspaceBridgeCallRequest,
  opts: WorkspaceBridgeHttpRoutesOptions,
): Promise<WorkspaceBridgeRegistry> {
  const registry = opts.getRegistry ? await opts.getRegistry(request, body) : opts.registry
  if (!registry) {
    throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.OpNotFound, "WorkspaceBridge registry is not configured")
  }
  return registry
}

function resolveRuntimeContext(
  token: string,
  opts: WorkspaceBridgeHttpRoutesOptions,
  definition: NonNullable<ReturnType<WorkspaceBridgeRegistry["getDefinition"]>>,
  verified?: VerifiedWorkspaceBridgeRuntimeTokenClaims,
) {
  if (verified) {
    return authorizeWorkspaceBridgeRuntimeToken(verified, definition.requiredCapabilities).authContext
  }
  if (!opts.runtimeTokenSecret) {
    throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.AuthRequired, "Runtime bridge token auth is not configured")
  }
  return verifyWorkspaceBridgeRuntimeToken(token, {
    secret: opts.runtimeTokenSecret,
    requiredCapabilities: definition.requiredCapabilities,
  }).authContext
}

function resolveRuntimeClaims(
  token: string,
  opts: WorkspaceBridgeHttpRoutesOptions,
): VerifiedWorkspaceBridgeRuntimeTokenClaims {
  if (!opts.runtimeTokenSecret) {
    throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.AuthRequired, "Runtime bridge token auth is not configured")
  }
  return verifyWorkspaceBridgeRuntimeTokenClaims(token, { secret: opts.runtimeTokenSecret })
}

async function resolveBrowserContext(
  request: FastifyRequest,
  opts: WorkspaceBridgeHttpRoutesOptions,
  definition: NonNullable<ReturnType<WorkspaceBridgeRegistry["getDefinition"]>>,
  body: z.infer<typeof bridgeCallBodySchema>,
) {
  if (!opts.browserAuthPolicy) {
    throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.AuthRequired, "Browser bridge auth is not configured")
  }
  const workspaceId = firstHeader(request.headers["x-boring-workspace-id"]) ?? "default"
  const sessionId = firstHeader(request.headers["x-boring-session-id"])
  return (await opts.browserAuthPolicy.resolve({
    callerClass: "browser",
    definition,
    workspaceId,
    sessionId,
    request: { headers: request.headers as Record<string, string | string[] | undefined>, method: request.method, user: (request as unknown as { user?: unknown }).user },
    body,
  })).context
}

async function sendResponse<T>(reply: FastifyReply, response: WorkspaceBridgeCallResponse<T>) {
  return reply.code(response.ok ? 200 : statusForBridgeError(response.error.code)).send(response)
}

function refreshMintTtlMs(claims: WorkspaceBridgeRuntimeRefreshTokenClaims, nowMs: number): number | undefined {
  const requested = clampWorkspaceBridgeRuntimeTokenTtlMs(claims.tokenTtlMs) ?? DEFAULT_WORKSPACE_BRIDGE_RUNTIME_TOKEN_TTL_MS
  const remaining = claims.exp * 1000 - nowMs
  if (remaining <= 0) return undefined
  return Math.min(requested, remaining)
}

function sendBridgeError(
  reply: FastifyReply,
  status: number,
  requestId: string | undefined,
  code: WorkspaceBridgeErrorCode,
  message: string,
) {
  reply.header("Cache-Control", "no-store")
  return reply.code(status).send({ ok: false, requestId, error: { code, message } })
}

function statusForBridgeError(code: WorkspaceBridgeErrorCode): number {
  if (code === WorkspaceBridgeErrorCode.AuthRequired || code === WorkspaceBridgeErrorCode.InvalidToken || code === WorkspaceBridgeErrorCode.ExpiredToken) return 401
  if (code === WorkspaceBridgeErrorCode.RateLimited) return 429
  if (code === WorkspaceBridgeErrorCode.CallerNotAllowed || code === WorkspaceBridgeErrorCode.CapabilityDenied || code === WorkspaceBridgeErrorCode.ResourceScopeDenied) return 403
  if (code === WorkspaceBridgeErrorCode.OpNotFound) return 404
  if (code === WorkspaceBridgeErrorCode.InputTooLarge || code === WorkspaceBridgeErrorCode.OutputTooLarge) return 413
  return 400
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isBridgeError(err: unknown): err is { code: WorkspaceBridgeErrorCode; message: string } {
  return !!err && typeof err === "object" && "code" in err && "message" in err
}
