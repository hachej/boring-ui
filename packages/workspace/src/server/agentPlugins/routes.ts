import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { BoringPluginAssetManager } from "./manager"
import type { BoringPluginEvent, PluginRestartSurface } from "./types"

export interface PluginReloadRebuild {
  ok: boolean
  diagnostics: { source: string; message: string; pluginId?: string }[]
}

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

export interface BoringPluginRoutesOptions {
  manager: BoringPluginAssetManager
  /**
   * Server-side plugin rebuild closure (jiti re-import of dir-source
   * entries). Called AFTER the asset manager scan. Per-plugin failures
   * surface as diagnostics; combined with asset-manager errors into the
   * 422 response body so the agent's /reload UI can show them. Optional —
   * tests that exercise the route in isolation can omit it.
   */
  rebuildPlugins?: () => Promise<PluginReloadRebuild>
  /** Register the developer reload endpoint. Static discovery/listing remains available when false. */
  enableReloadRoute?: boolean
}

export async function boringPluginRoutes(app: FastifyInstance, opts: BoringPluginRoutesOptions): Promise<void> {
  const { manager, rebuildPlugins, enableReloadRoute = true } = opts

  if (enableReloadRoute) {
    app.post("/api/boring.reload", async (_request, reply) => {
      const scan = await manager.load()
      const rebuild = rebuildPlugins ? await rebuildPlugins() : { ok: true, diagnostics: [] }
      const restart_warnings = collectRestartWarnings(scan.events)
      const hasFailures = scan.errors.length > 0 || rebuild.diagnostics.length > 0
      if (hasFailures) {
        return reply.status(422).send({
          ok: false,
          errors: scan.errors,
          diagnostics: rebuild.diagnostics,
          plugins: scan.loaded,
          // Even on failure, emit warnings for plugins that DID reload
          // — partial-failure tolerance means some loaded successfully.
          ...(restart_warnings.length > 0 ? { restart_warnings } : {}),
        })
      }
      return reply.send({
        ok: true,
        plugins: scan.loaded,
        ...(restart_warnings.length > 0 ? { restart_warnings } : {}),
      })
    })
  }

  const listPlugins = async () => manager.list()
  // Canonical versioned route. Keep the unversioned path as a compatibility
  // alias for older clients/tests, but all new callers should use /api/v1.
  app.get("/api/v1/agent-plugins", listPlugins)
  app.get("/api/agent-plugins", listPlugins)

  const getPluginError = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const error = manager.getError(request.params.id)
    if (error == null) return reply.status(404).send({ error: "not_found" })
    return reply.type("text/plain").send(error)
  }
  app.get<{ Params: { id: string } }>("/api/v1/agent-plugins/:id/error", getPluginError)
  app.get<{ Params: { id: string } }>("/api/agent-plugins/:id/error", getPluginError)

  app.get("/api/v1/agent-plugins/events", async (request, reply) => {
    reply.hijack()
    const res = reply.raw
    res.statusCode = 200
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()

    const write = (event: BoringPluginEvent) => {
      try {
        res.write(`event: ${event.type}\n`)
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        // client gone
      }
    }

    for (const plugin of manager.list()) {
      write({
        type: "boring.plugin.load",
        id: plugin.id,
        boring: plugin.boring,
        version: plugin.version,
        revision: plugin.revision,
        ...(plugin.frontUrl ? { frontUrl: plugin.frontUrl } : {}),
      })
    }

    const unsubscribe = manager.subscribe(write)
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n") } catch { /* ignore */ }
    }, 25_000)
    request.raw.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}
