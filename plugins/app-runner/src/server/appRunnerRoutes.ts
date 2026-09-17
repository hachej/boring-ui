import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { basename } from "node:path"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import { sanitizeAppName } from "../shared/sanitize"
import type { AppRunnerRecord } from "../shared/types"
import type { AppRunnerStore } from "./appRunnerStore"
import { isProfileAppName } from "./profileAddress"
import { identityFromRequest } from "./resolveIdentity"

export interface AppRunnerRoutesOptions {
  workspaceRoot: string
  client: AppRunnerClient
  store: AppRunnerStore
}

function workspaceIdFromRequest(request: FastifyRequest, workspaceRoot: string): string {
  const trusted = (request as FastifyRequest & { workspaceContext?: { workspaceId?: string } }).workspaceContext?.workspaceId?.trim()
  return sanitizeAppName(trusted || basename(workspaceRoot) || "default")
}

function sendAppRunnerError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AppRunnerHttpError) {
    return reply.code(error.status).send({ error: "app_runner_error", message: error.message })
  }
  const message = error instanceof Error ? error.message : String(error)
  return reply.code(500).send({ error: "app_runner_error", message })
}

async function authorizeAppName(
  opts: AppRunnerRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
  appName: string,
): Promise<AppRunnerRecord | undefined> {
  try {
    sanitizeAppName(appName)
  } catch (error) {
    reply.code(400).send({ error: "invalid_app_name", message: error instanceof Error ? error.message : String(error) })
    return undefined
  }
  const record = (await opts.store.listApps()).find((entry) =>
    entry.workspaceId === workspaceId && entry.appName === appName,
  )
  if (record?.kind === "profile" || isProfileAppName(appName)) {
    const identity = identityFromRequest(request)
    if (!record || record.ownerUserId !== identity.id) {
      reply.code(403).send({ error: "forbidden", message: "profile belongs to another user" })
      return undefined
    }
  }
  return record
}

/**
 * Proxies an iframe request to the runner's public app/preview endpoints
 * with the required auth headers — an iframe `src` can't set custom
 * headers, so this keeps the identity/secret headers server-side while
 * still letting the front just point an <iframe> at a same-origin URL.
 */
function applySandboxCors(request: FastifyRequest, reply: FastifyReply): void {
  if (request.headers.origin !== "null") return
  reply.header("access-control-allow-origin", "null")
  reply.header("vary", "Origin")
  reply.header("access-control-allow-methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
  reply.header("access-control-allow-headers", "Content-Type, Accept")
}

function confinedWildcardPath(rest: string): string | undefined {
  const segments = rest.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\\"))) return undefined
  return segments.map(encodeURIComponent).join("/")
}

async function proxyToRunner(
  opts: AppRunnerRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  runnerPath: string,
): Promise<void> {
  applySandboxCors(request, reply)
  if (request.method === "OPTIONS") {
    reply.code(204).send()
    return
  }
  const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
  const identity = identityFromRequest(request)
  const query = request.raw.url?.includes("?") ? `?${request.raw.url.split("?")[1]}` : ""
  const incomingType = request.headers["content-type"]
  const incomingAccept = request.headers.accept
  const headers: Record<string, string> = {
    ...(typeof incomingType === "string" ? { "content-type": incomingType } : {}),
    ...(typeof incomingAccept === "string" ? { accept: incomingAccept } : {}),
  }
  const body = request.body === undefined || request.method === "GET" || request.method === "HEAD"
    ? undefined
    : Buffer.isBuffer(request.body) || typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body)
  const upstream = await opts.client.fetchServing(`${runnerPath}${query}`, identity, workspaceId, {
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body: body as BodyInit }),
  })
  reply.code(upstream.status)
  const contentType = upstream.headers.get("content-type")
  if (contentType) reply.header("content-type", contentType)
  if (request.method === "HEAD") return void reply.send()
  reply.send(Buffer.from(await upstream.arrayBuffer()))
}

/**
 * Thin HTTP routes over the server-side app runner client + store. The
 * front never talks to the runner directly for authenticated operations —
 * only these routes (and the `/open/*` iframe proxy) hold
 * `BORING_APP_RUNNER_TOKEN`/`BORING_APP_RUNNER_AUTH_SECRET`.
 */
export function appRunnerRoutes(app: FastifyInstance, opts: AppRunnerRoutesOptions, done: (err?: Error) => void): void {
  app.get("/api/v1/plugins/app-runner/apps", async (request) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    const identity = identityFromRequest(request)
    const apps = (await opts.store.listApps()).filter((record) =>
      record.workspaceId === workspaceId && (record.kind !== "profile" || record.ownerUserId === identity.id),
    )
    return {
      apps: apps.map((record) => ({
        ...record,
        appId: opts.client.appId(workspaceId, record.appName),
        appUrl: `/api/v1/plugins/app-runner/open/${encodeURIComponent(record.appName)}/`,
      })),
      workspaceId,
    }
  })

  app.get<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/versions", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    await authorizeAppName(opts, request, reply, workspaceId, request.params.appName)
    if (reply.sent) return
    try {
      const versions = await opts.client.listVersions(workspaceId, request.params.appName, identityFromRequest(request))
      return {
        versions: versions.map((entry) => ({
          ...entry,
          previewUrl: `/api/v1/plugins/app-runner/preview/${encodeURIComponent(request.params.appName)}/${entry.version}/`,
        })),
        appId: opts.client.appId(workspaceId, request.params.appName),
        appUrl: `/api/v1/plugins/app-runner/open/${encodeURIComponent(request.params.appName)}/`,
      }
    } catch (error) {
      return sendAppRunnerError(reply, error)
    }
  })

  app.post<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/rollback", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    const identity = identityFromRequest(request)
    const existing = await authorizeAppName(opts, request, reply, workspaceId, request.params.appName)
    if (reply.sent) return
    try {
      await opts.client.rollback(workspaceId, request.params.appName, identity)
      const versions = await opts.client.listVersions(workspaceId, request.params.appName, identity)
      const current = versions.find((entry) => entry.current)
      if (current) {
        const deployed = await opts.client.current(workspaceId, request.params.appName, identity)
        await opts.store.upsertApp({
          appName: request.params.appName,
          workspaceId,
          kind: deployed.kind,
          version: deployed.version,
          sha: deployed.sha,
          url: opts.client.publicAppUrl(workspaceId, request.params.appName),
          updatedAt: new Date().toISOString(),
          toolManifest: deployed.manifest,
          ...(existing?.ownerUserId ? { ownerUserId: existing.ownerUserId } : {}),
        })
      }
      return { ok: true, versions }
    } catch (error) {
      return sendAppRunnerError(reply, error)
    }
  })

  app.post<{ Params: { appName: string }; Body: { version: number } }>(
    "/api/v1/plugins/app-runner/apps/:appName/activate",
    async (request, reply) => {
      const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
      const version = request.body?.version
      if (typeof version !== "number" || !Number.isFinite(version)) {
        return reply.code(400).send({ error: "invalid_request", message: "body.version must be a number" })
      }
      const identity = identityFromRequest(request)
      const existing = await authorizeAppName(opts, request, reply, workspaceId, request.params.appName)
      if (reply.sent) return
      try {
        await opts.client.activate(workspaceId, request.params.appName, version, identity)
        const deployed = await opts.client.current(workspaceId, request.params.appName, identity)
        await opts.store.upsertApp({
          appName: request.params.appName,
          workspaceId,
          kind: deployed.kind,
          version: deployed.version,
          sha: deployed.sha,
          url: opts.client.publicAppUrl(workspaceId, request.params.appName),
          updatedAt: new Date().toISOString(),
          toolManifest: deployed.manifest,
          ...(existing?.ownerUserId ? { ownerUserId: existing.ownerUserId } : {}),
        })
        return { ok: true }
      } catch (error) {
        return sendAppRunnerError(reply, error)
      }
    },
  )

  app.get<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/logs", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    await authorizeAppName(opts, request, reply, workspaceId, request.params.appName)
    if (reply.sent) return
    try {
      return await opts.client.logs(workspaceId, request.params.appName, identityFromRequest(request))
    } catch (error) {
      return sendAppRunnerError(reply, error)
    }
  })

  app.get<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/usage", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    await authorizeAppName(opts, request, reply, workspaceId, request.params.appName)
    if (reply.sent) return
    try {
      return await opts.client.usage(workspaceId, request.params.appName, identityFromRequest(request))
    } catch (error) {
      return sendAppRunnerError(reply, error)
    }
  })

  app.all<{ Params: { appName: string; "*": string } }>("/api/v1/plugins/app-runner/open/:appName/*", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    await authorizeAppName(opts, request, reply, workspaceId, request.params.appName)
    if (reply.sent) return
    const rest = confinedWildcardPath(request.params["*"] ?? "")
    if (rest === undefined) {
      reply.code(403).send({ error: "forbidden", message: "serving path escapes the authorized app" })
      return
    }
    await proxyToRunner(opts, request, reply, `/w/${encodeURIComponent(workspaceId)}/${encodeURIComponent(request.params.appName)}/${rest}`)
  })

  app.all<{ Params: { appName: string; version: string; "*": string } }>(
    "/api/v1/plugins/app-runner/preview/:appName/:version/*",
    async (request, reply) => {
      const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
      await authorizeAppName(opts, request, reply, workspaceId, request.params.appName)
      if (reply.sent) return
      const rest = confinedWildcardPath(request.params["*"] ?? "")
      if (rest === undefined) {
        reply.code(403).send({ error: "forbidden", message: "preview path escapes the authorized app" })
        return
      }
      await proxyToRunner(opts, request, reply, `/w/${encodeURIComponent(workspaceId)}/${encodeURIComponent(request.params.appName)}/preview/${encodeURIComponent(request.params.version)}/${rest}`)
    },
  )

  done()
}
