import { ErrorCode } from "@hachej/boring-agent/shared"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { isValidBoringPluginId } from "../../shared/plugins/manifest"
import { RuntimeBackendError, type RuntimeBackendDispatchResponse, type RuntimeBackendRegistry } from "./runtimeBackendRegistry"

export interface RuntimeBackendGatewayOptions {
  registry: RuntimeBackendRegistry
}

type GatewayParams = {
  pluginId: string
  "*"?: string
}

function normalizeGatewayPath(tail: string | undefined): string {
  const path = tail && tail.length > 0
    ? (tail.startsWith("/") ? tail : `/${tail}`)
    : "/"
  if (path.includes("\\")) {
    throw new RuntimeBackendError(
      ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND,
      404,
      "runtime backend route path must not contain backslashes",
    )
  }
  if (path.split("/").includes("..")) {
    throw new RuntimeBackendError(
      ErrorCode.enum.RUNTIME_PLUGIN_ROUTE_NOT_FOUND,
      404,
      "runtime backend route path must not contain .. segments",
    )
  }
  return path
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function headersFromRequest(request: FastifyRequest): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, String(value))
    }
  }
  return headers
}

function loggerFromRequest(request: FastifyRequest) {
  return {
    debug: (arg: Record<string, unknown> | string, message?: string) => {
      if (message === undefined) request.log.debug(arg)
      else request.log.debug(arg, message)
    },
    info: (arg: Record<string, unknown> | string, message?: string) => {
      if (message === undefined) request.log.info(arg)
      else request.log.info(arg, message)
    },
    warn: (arg: Record<string, unknown> | string, message?: string) => {
      if (message === undefined) request.log.warn(arg)
      else request.log.warn(arg, message)
    },
    error: (arg: Record<string, unknown> | string, message?: string) => {
      if (message === undefined) request.log.error(arg)
      else request.log.error(arg, message)
    },
  }
}

function sendDispatchResponse(reply: FastifyReply, response: RuntimeBackendDispatchResponse): FastifyReply {
  reply.status(response.status)
  for (const [name, value] of Object.entries(response.headers)) reply.header(name, value)
  if (response.body === undefined || response.body === null) return reply.send()
  return reply.send(response.body)
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof RuntimeBackendError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    })
  }
  return reply.status(500).send({
    error: {
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: error instanceof Error ? error.message : String(error),
    },
  })
}

export async function runtimeBackendGateway(app: FastifyInstance, opts: RuntimeBackendGatewayOptions): Promise<void> {
  app.all<{ Params: GatewayParams }>("/api/v1/plugins/:pluginId/*", async (request, reply) => {
    const { pluginId } = request.params
    if (!isValidBoringPluginId(pluginId)) {
      return sendError(reply, new RuntimeBackendError(
        ErrorCode.enum.RUNTIME_PLUGIN_NOT_FOUND,
        404,
        "runtime backend plugin not found",
      ))
    }

    let path: string
    try {
      path = normalizeGatewayPath(request.params["*"])
    } catch (error) {
      return sendError(reply, error)
    }

    const abort = new AbortController()
    const close = () => abort.abort()
    request.raw.on("close", close)
    try {
      const response = await opts.registry.dispatch({
        pluginId,
        method: request.method,
        path,
        query: new URLSearchParams(request.query as Record<string, string>),
        headers: headersFromRequest(request),
        signal: abort.signal,
        body: request.body,
        logger: loggerFromRequest(request),
        ...(firstString(request.headers["x-boring-workspace-id"]) ? { workspaceId: firstString(request.headers["x-boring-workspace-id"]) } : {}),
      })
      return sendDispatchResponse(reply, response)
    } catch (error) {
      return sendError(reply, error)
    } finally {
      request.raw.off("close", close)
    }
  })
}
