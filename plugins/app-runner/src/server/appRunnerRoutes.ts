import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { basename } from "node:path"
import type { AppRunnerClient } from "./appRunnerClient"
import { AppRunnerHttpError } from "./appRunnerClient"
import { sanitizeAppName } from "../shared/sanitize"
import type { AppRunnerRecord } from "../shared/types"
import type { AppRunnerStore } from "./appRunnerStore"
import { isProfileAppName, profileAppName } from "./profileAddress"
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
  if (isProfileAppName(appName)) {
    const identity = identityFromRequest(request)
    if (appName !== profileAppName(identity.id) || !record) {
      reply.code(403).send({ error: "forbidden", message: "profile address does not match the acting user" })
      return undefined
    }
    // Recover old records that predate ownerUserId only after the immutable
    // address has independently proved ownership.
    if (!record.ownerUserId) {
      const recovered = { ...record, kind: "profile" as const, ownerUserId: identity.id }
      await opts.store.upsertApp(recovered)
      return recovered
    }
    if (record.ownerUserId !== identity.id) {
      reply.code(403).send({ error: "forbidden", message: "profile belongs to another user" })
      return undefined
    }
  } else if (record?.kind === "profile") {
    reply.code(403).send({ error: "forbidden", message: "profile record has an invalid address" })
    return undefined
  }
  return record
}

/**
 * Thin HTTP routes over the server-side app runner client + store. The
 * front never talks to the runner directly for authenticated operations —
 * only these routes hold `BORING_APP_RUNNER_TOKEN` and
 * `BORING_APP_RUNNER_AUTH_SECRET`; app pages use signed URLs on another origin.
 */
export function appRunnerRoutes(app: FastifyInstance, opts: AppRunnerRoutesOptions, done: (err?: Error) => void): void {
  app.get("/api/v1/plugins/app-runner/apps", async (request) => {
    const workspaceId = workspaceIdFromRequest(request, opts.workspaceRoot)
    const identity = identityFromRequest(request)
    const permittedProfile = profileAppName(identity.id)
    const apps = (await opts.store.listApps()).filter((record) =>
      record.workspaceId === workspaceId
      && (record.appName === permittedProfile || (!isProfileAppName(record.appName) && record.kind !== "profile")),
    )
    return {
      apps: await Promise.all(apps.map(async (record) => {
        const mounted = await opts.client.current(workspaceId, record.appName, identity)
        const provenance = mounted.sha ? Object.freeze({
          kind: mounted.kind,
          address: `${workspaceId}/${record.appName}`,
          version: mounted.version,
          sha: mounted.sha,
        }) : undefined
        return {
          ...record,
          kind: mounted.kind,
          version: mounted.version,
          sha: mounted.sha,
          toolManifest: mounted.manifest,
          appId: opts.client.appId(workspaceId, record.appName),
          appUrl: await opts.client.signedServingUrl(workspaceId, record.appName, identity),
          toolProvenance: mounted.manifest.tools.flatMap(() => provenance ? [provenance] : []),
        }
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
      const identity = identityFromRequest(request)
      return {
        versions: await Promise.all(versions.map(async (entry) => ({
          ...entry,
          previewUrl: await opts.client.signedServingUrl(workspaceId, request.params.appName, identity, entry.version),
        }))),
        appId: opts.client.appId(workspaceId, request.params.appName),
        appUrl: await opts.client.signedServingUrl(workspaceId, request.params.appName, identity),
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

  done()
}
