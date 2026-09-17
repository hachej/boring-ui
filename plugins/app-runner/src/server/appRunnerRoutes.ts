import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { basename } from "node:path"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"
import { identityFromRequest } from "./resolveIdentity"

export interface AppRunnerRoutesOptions {
  workspaceRoot: string
  client: AppRunnerClient
  store: AppRunnerStore
}

function workspaceIdFromRequest(request: FastifyRequest, workspaceRoot: string): string {
  const header = request.headers["x-boring-workspace-id"]
  if (typeof header === "string" && header.trim().length > 0) return header.trim()
  return basename(workspaceRoot) || "default"
}

function sendAppRunnerError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AppRunnerHttpError) {
    return reply.code(error.status).send({ error: "app_runner_error", message: error.message })
  }
  const message = error instanceof Error ? error.message : String(error)
  return reply.code(500).send({ error: "app_runner_error", message })
}

/**
 * Proxies an iframe request to the runner's public app/preview endpoints
 * with the required auth headers — an iframe `src` can't set custom
 * headers, so this keeps the identity/secret headers server-side while
 * still letting the front just point an <iframe> at a same-origin URL.
 */
async function proxyToRunner(
  opts: AppRunnerRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  runnerPath: string,
): Promise<void> {
  const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
  const identity = identityFromRequest(request)
  const upstream = await fetch(`${opts.client.base}${runnerPath}`, {
    headers: opts.client.authHeaders(identity, workspaceId),
  })
  reply.code(upstream.status)
  const contentType = upstream.headers.get("content-type")
  if (contentType) reply.header("content-type", contentType)
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
    const apps = await opts.store.listApps()
    return {
      apps: apps.map((record) => ({
        ...record,
        appId: opts.client.appId(workspaceId, record.appName),
        appUrl: opts.client.publicAppUrl(workspaceId, record.appName),
      })),
      workspaceId,
    }
  })

  app.get<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/versions", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
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
    try {
      await opts.client.rollback(workspaceId, request.params.appName, identity)
      const versions = await opts.client.listVersions(workspaceId, request.params.appName, identity)
      const current = versions.find((entry) => entry.current)
      if (current) {
        await opts.store.upsertApp({
          appName: request.params.appName,
          version: current.version,
          url: opts.client.publicAppUrl(workspaceId, request.params.appName),
          updatedAt: new Date().toISOString(),
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
      try {
        await opts.client.activate(workspaceId, request.params.appName, version, identity)
        await opts.store.upsertApp({
          appName: request.params.appName,
          version,
          url: opts.client.publicAppUrl(workspaceId, request.params.appName),
          updatedAt: new Date().toISOString(),
        })
        return { ok: true }
      } catch (error) {
        return sendAppRunnerError(reply, error)
      }
    },
  )

  app.get<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/logs", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    try {
      return await opts.client.logs(workspaceId, request.params.appName, identityFromRequest(request))
    } catch (error) {
      return sendAppRunnerError(reply, error)
    }
  })

  app.get<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/usage", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    try {
      return await opts.client.usage(workspaceId, request.params.appName, identityFromRequest(request))
    } catch (error) {
      return sendAppRunnerError(reply, error)
    }
  })

  app.get<{ Params: { appName: string; "*": string } }>("/api/v1/plugins/app-runner/open/:appName/*", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    const rest = request.params["*"] ?? ""
    await proxyToRunner(opts, request, reply, `/w/${workspaceId}/${request.params.appName}/${rest}`)
  })

  app.get<{ Params: { appName: string; version: string; "*": string } }>(
    "/api/v1/plugins/app-runner/preview/:appName/:version/*",
    async (request, reply) => {
      const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
      const rest = request.params["*"] ?? ""
      await proxyToRunner(opts, request, reply, `/w/${workspaceId}/${request.params.appName}/preview/${request.params.version}/${rest}`)
    },
  )

  done()
}
