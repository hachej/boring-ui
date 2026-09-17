import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { basename } from "node:path"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import type { AppRunnerStore } from "./appRunnerStore"

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
 * Thin HTTP routes over the server-side app runner client + store. The
 * front never talks to the runner directly for authenticated operations —
 * only these routes hold `BORING_APP_RUNNER_TOKEN`. Public GET endpoints
 * (`/u/{app}/app/*`, `/u/{app}/preview/{version}/*`) are safe for the front
 * to iframe directly since the runner serves them without auth.
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
      const versions = await opts.client.listVersions(workspaceId, request.params.appName)
      return {
        versions: versions.map((entry) => ({
          ...entry,
          previewUrl: opts.client.publicPreviewUrl(workspaceId, request.params.appName, entry.version),
        })),
        appId: opts.client.appId(workspaceId, request.params.appName),
        appUrl: opts.client.publicAppUrl(workspaceId, request.params.appName),
      }
    } catch (error) {
      return sendAppRunnerError(reply, error)
    }
  })

  app.post<{ Params: { appName: string } }>("/api/v1/plugins/app-runner/apps/:appName/rollback", async (request, reply) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    try {
      await opts.client.rollback(workspaceId, request.params.appName)
      const versions = await opts.client.listVersions(workspaceId, request.params.appName)
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
      try {
        await opts.client.activate(workspaceId, request.params.appName, version)
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

  done()
}
