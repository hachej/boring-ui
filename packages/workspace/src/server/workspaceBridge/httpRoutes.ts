import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
} from "../../shared/workspace-bridge-rpc"
import type { BridgeAuthPolicy } from "./authPolicy"
import type { WorkspaceBridgeIdempotencyStore } from "./idempotency"
import { runWithWorkspaceBridgeIdempotency } from "./idempotency"
import type { WorkspaceBridgeRegistry } from "./registry"
import { verifyWorkspaceBridgeRuntimeToken } from "./runtimeToken"

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
  idempotencyStore?: WorkspaceBridgeIdempotencyStore
  getIdempotencyStore?: (request: FastifyRequest, body: WorkspaceBridgeCallRequest) => WorkspaceBridgeIdempotencyStore | undefined | Promise<WorkspaceBridgeIdempotencyStore | undefined>
  maxBodyBytes?: number
}

export function workspaceBridgeHttpRoutes(
  app: FastifyInstance,
  opts: WorkspaceBridgeHttpRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.post("/api/v1/workspace-bridge/call", async (request, reply) => {
    reply.header("Cache-Control", "no-store")

    const contentType = String(request.headers["content-type"] ?? "")
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return sendBridgeError(reply, 415, undefined, WorkspaceBridgeErrorCode.InvalidRequest, "WorkspaceBridge transport requires application/json")
    }

    const rawBodySize = estimateBodyBytes(request.body)
    if (opts.maxBodyBytes && rawBodySize > opts.maxBodyBytes) {
      return sendBridgeError(reply, 413, undefined, WorkspaceBridgeErrorCode.InputTooLarge, "WorkspaceBridge request body is too large")
    }

    const parsed = bridgeCallBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return sendBridgeError(reply, 400, undefined, WorkspaceBridgeErrorCode.SchemaInvalid, "WorkspaceBridge request body is invalid")
    }
    const body: WorkspaceBridgeCallRequest = { ...parsed.data, input: parsed.data.input ?? {} }

    try {
      const registry = await resolveRegistry(request, body, opts)
      const definition = registry.getDefinition(body.op)
      if (!definition) {
        return sendBridgeError(reply, statusForBridgeError(WorkspaceBridgeErrorCode.OpNotFound), body.requestId, WorkspaceBridgeErrorCode.OpNotFound, "WorkspaceBridge operation is not registered")
      }

      const authHeader = firstHeader(request.headers.authorization)
      const authContext = authHeader?.startsWith("Bearer ")
        ? resolveRuntimeContext(authHeader.slice("Bearer ".length), opts, definition)
        : await resolveBrowserContext(request, opts, definition, body)
      const idempotencyStore = opts.getIdempotencyStore
        ? await opts.getIdempotencyStore(request, body)
        : opts.idempotencyStore

      const response = await runWithWorkspaceBridgeIdempotency(idempotencyStore, {
        definition,
        request: body,
        auth: authContext,
      }, async () => await registry.call(body, authContext))
      return await sendResponse(reply, response)
    } catch (err) {
      const bridgeError = isBridgeError(err)
        ? err
        : createWorkspaceBridgeError(WorkspaceBridgeErrorCode.HandlerFailed, "WorkspaceBridge transport failed")
      return sendBridgeError(reply, statusForBridgeError(bridgeError.code), body.requestId, bridgeError.code, bridgeError.message)
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
) {
  if (!opts.runtimeTokenSecret) {
    throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.AuthRequired, "Runtime bridge token auth is not configured")
  }
  return verifyWorkspaceBridgeRuntimeToken(token, {
    secret: opts.runtimeTokenSecret,
    requiredCapabilities: definition.requiredCapabilities,
  }).authContext
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
  if (code === WorkspaceBridgeErrorCode.CallerNotAllowed || code === WorkspaceBridgeErrorCode.CapabilityDenied || code === WorkspaceBridgeErrorCode.ResourceScopeDenied) return 403
  if (code === WorkspaceBridgeErrorCode.OpNotFound) return 404
  if (code === WorkspaceBridgeErrorCode.InputTooLarge || code === WorkspaceBridgeErrorCode.OutputTooLarge) return 413
  return 400
}

function estimateBodyBytes(body: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(body)).byteLength } catch { return Number.POSITIVE_INFINITY }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isBridgeError(err: unknown): err is { code: WorkspaceBridgeErrorCode; message: string } {
  return !!err && typeof err === "object" && "code" in err && "message" in err
}
