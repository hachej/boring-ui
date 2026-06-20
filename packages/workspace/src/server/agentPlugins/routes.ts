import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { BoringPluginRouteManager, BoringPluginEvent, PluginRestartSurface } from "./types"

/**
 * One per plugin whose load event carried a non-empty
 * `requiresRestart` field. Surfaced alongside the /reload response so
 * the agent (and chat UI) can warn the user without subscribing to
 * the SSE event stream.
 */
export interface PluginRestartWarning {
  id: string
  surfaces: PluginRestartSurface[]
  message: string
}

/**
 * Walk a load result's events for boring.plugin.load events that
 * carried `requiresRestart`. Each becomes a human-readable warning
 * with a one-line message — small, surface-aware, formatted for both
 * humans and agents.
 */
export function collectRestartWarnings(events: BoringPluginEvent[]): PluginRestartWarning[] {
  const warnings: PluginRestartWarning[] = []
  for (const event of events) {
    if (event.type !== "boring.plugin.load") continue
    const surfaces = event.requiresRestart
    if (!surfaces || surfaces.length === 0) continue
    warnings.push({
      id: event.id,
      surfaces: [...surfaces],
      message: `${event.id} reloaded — front bundle is live, but server-side ${surfaces.join(" + ")} were wired at boot and still run the old code. Stop and restart the workspace process (Ctrl-C, then re-run your dev command) to pick up changes.`,
    })
  }
  return warnings
}

export type BoringPluginRouteManagerResolver = BoringPluginRouteManager | ((request: FastifyRequest) => BoringPluginRouteManager | Promise<BoringPluginRouteManager>)

export interface BoringPluginRoutesOptions {
  manager: BoringPluginRouteManagerResolver
  iframeDocuments?: boolean
}

async function resolveRouteManager(manager: BoringPluginRouteManagerResolver, request: FastifyRequest): Promise<BoringPluginRouteManager> {
  return typeof manager === "function" ? await manager(request) : manager
}

export async function boringPluginRoutes(app: FastifyInstance, opts: BoringPluginRoutesOptions): Promise<void> {
  const listPlugins = async (request: FastifyRequest) => (await resolveRouteManager(opts.manager, request)).list()
  app.get("/api/v1/agent-plugins", listPlugins)

  const getPluginError = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const manager = await resolveRouteManager(opts.manager, request)
    const error = manager.getError(request.params.id)
    if (error == null) return reply.status(404).send({ error: "not_found" })
    return reply.type("text/plain").send(error)
  }
  app.get<{ Params: { id: string } }>("/api/v1/agent-plugins/:id/error", getPluginError)

  app.get("/api/v1/agent-plugins/events", async (request, reply) => {
    let manager: BoringPluginRouteManager
    try {
      manager = await resolveRouteManager(opts.manager, request)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: "agent_plugin_manager_error", message })
    }
    reply.hijack()
    const res = reply.raw
    res.statusCode = 200
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()

    const write = (eventName: string, payload: Record<string, unknown>) => {
      try {
        res.write(`event: ${eventName}\n`)
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      } catch {
        // client gone
      }
    }

    const liveQueue: Array<{ eventName: string; payload: Record<string, unknown> }> = []
    let replaying = true
    const unsubscribe = manager.subscribe((event) => {
      const payload = { ...event, replay: false }
      if (replaying) {
        liveQueue.push({ eventName: event.type, payload })
        return
      }
      write(event.type, payload)
    })

    for (const plugin of await manager.listExternal()) {
      write("boring.plugin.load", {
        type: "boring.plugin.load",
        id: plugin.id,
        boring: plugin.boring,
        version: plugin.version,
        revision: plugin.revision,
        ...(plugin.frontTarget ? { frontTarget: plugin.frontTarget } : {}),
        replay: true,
      })
    }
    write("boring.plugin.replay-complete", {
      type: "boring.plugin.replay-complete",
      replay: true,
    })
    replaying = false
    for (const event of liveQueue) write(event.eventName, event.payload)
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n") } catch { /* ignore */ }
    }, 25_000)
    request.raw.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  const registerIframeDocumentEndpoint = opts.iframeDocuments ?? (typeof opts.manager !== "function" && typeof opts.manager.getIframeDocument === "function")
  if (registerIframeDocumentEndpoint) {
    app.get<{ Params: { id: string; panelId: string }; Querystring: { nonce?: string } }>(
      "/api/v1/agent-plugins/:id/iframe/:panelId/document",
      async (request, reply) => {
        const manager = await resolveRouteManager(opts.manager, request)
        if (!manager.getIframeDocument) return reply.status(404).send({ error: "not_found" })
        const nonce = typeof request.query.nonce === "string" ? request.query.nonce : ""
        try {
          const document = await manager.getIframeDocument(request.params.id, request.params.panelId, nonce)
          if (!document) return reply.status(404).send({ error: "not_found" })
          return reply.header("Cache-Control", "no-store").send(document)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return reply.status(400).send({ error: "hosted_plugin_document_error", message })
        }
      },
    )
  }
}
